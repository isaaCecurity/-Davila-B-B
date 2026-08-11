-- BakeFlow — storage buckets and per-bucket RLS policies
--
-- Implements docs/STORAGE-BUCKETS.md. STATUS: NOT APPLIED, consistent with the other
-- migrations in this directory.
--
-- ---------------------------------------------------------------------------
-- Why this migration exists
-- ---------------------------------------------------------------------------
-- 1. The four buckets and four policies currently live in the project were created
--    out-of-band (dashboard/SQL editor). No migration references the `storage` schema,
--    so the repository cannot reproduce them -- a direct violation of STORAGE-BUCKETS.md
--    section 58. This file makes them reproducible.
--
-- 2. The deployed policies are partitioned by OPERATION (one SELECT policy spanning all
--    four buckets, one INSERT, one UPDATE, one DELETE) rather than by bucket.
--    STORAGE-BUCKETS.md section 18 forbids exactly this: "Never use a single broad rule
--    for all buckets if their data sensitivity differs." Four concrete weaknesses follow
--    from it, all fixed below:
--
--      W1  No branch isolation anywhere. has_branch_access() is never called, so any
--          tenant member reads every branch's delivery proofs and receipts.
--          (sections 4, 18, 77, 79)
--
--      W2  One SELECT rule for all buckets with no role check, so a Driver can download
--          every receipt in the organization -- financial evidence treated as no more
--          sensitive than a product photo. (sections 18, 51, 67, 68)
--
--      W3  UPDATE spans all four buckets with NO role check, while DELETE is correctly
--          restricted to owner/admin/branch_manager on avatars/product-images only.
--          The delete restriction on financial evidence is therefore trivially bypassed:
--          overwrite the receipt with a blank image instead of deleting it.
--          (sections 19, 32, 67, 78 rule 12)
--
--      W4  The UPDATE with_check omits bucket_id, so within the tenant prefix an object
--          can be moved into any bucket, including one added later.
--
--      W5  avatars has no per-user boundary -- any tenant member can overwrite a
--          colleague's avatar. (sections 18, 71)
--
-- 3. Storage currently holds ZERO objects, so the path convention can be fixed at no
--    migration cost. It will never be cheaper. (section 60)
--
-- ---------------------------------------------------------------------------
-- Path convention (section 4)
-- ---------------------------------------------------------------------------
-- Segment 1 is ALWAYS the tenant. Branch-scoped buckets carry the branch in segment 2.
-- The bucket already identifies the domain, so a separate {domain} segment is redundant.
--
--   avatars          {tenant_id}/{user_id}/{object}
--   product-images   {tenant_id}/{product_id}/{object}
--   delivery-proofs  {tenant_id}/{branch_id}/{delivery_id}/{object}
--   receipts         {tenant_id}/{branch_id}/{expense_id}/{object}
--
-- Enforced as far as the policy layer can: segment 1 always, segment 2 for avatars and
-- for the two branch-scoped buckets. Deeper segments remain advisory.
--
-- ---------------------------------------------------------------------------
-- Known limitation, recorded deliberately (section 54 vs 55/56)
-- ---------------------------------------------------------------------------
-- current_tenant_id() and has_role() read JWT claims only and never touch a table, so a
-- user who is removed, suspended, soft-deleted or demoted keeps storage access until
-- their access token expires (3600s per config.toml). has_branch_access() and
-- has_permission() DO query tables, so branch and permission checks below are live.
-- The tenant check is the stale one. This is the deliberate performance trade-off
-- STORAGE-BUCKETS.md sections 55/56 argue for; it is written down here because the
-- document never states the consequence.

-- ---------------------------------------------------------------------------
-- Buckets — idempotent, matching the live configuration exactly
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('avatars',         'avatars',         false,  2097152, array['image/jpeg','image/png','image/webp']),
  ('product-images',  'product-images',  false,  5242880, array['image/jpeg','image/png','image/webp']),
  ('delivery-proofs', 'delivery-proofs', false,  5242880, array['image/jpeg','image/png','image/webp']),
  ('receipts',        'receipts',        false, 10485760, array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- No bucket is public. Sensitive organizational files are reached through signed URLs
-- only (sections 1, 12, 13, 53). No SVG anywhere -- it executes script (section 37).

-- ---------------------------------------------------------------------------
-- Path helpers
-- ---------------------------------------------------------------------------
-- Kept as functions so the predicate is written once and a claim-shape change is a
-- one-file edit. Both are STABLE so Postgres evaluates them per statement, not per row.

create or replace function public.storage_path_tenant(p_name text)
returns uuid
language sql
immutable
set search_path = public
as $$
  -- Segment 1, or NULL when absent or not a UUID. Returning NULL rather than raising
  -- keeps the policies fail-closed against a malformed or hand-crafted path.
  select nullif((storage.foldername(p_name))[1], '')::uuid
  where (storage.foldername(p_name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
$$;

create or replace function public.storage_path_segment2(p_name text)
returns uuid
language sql
immutable
set search_path = public
as $$
  select nullif((storage.foldername(p_name))[2], '')::uuid
  where (storage.foldername(p_name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
$$;

comment on function public.storage_path_tenant(text) is
  'Tenant UUID from storage path segment 1, NULL if absent or malformed. STORAGE-BUCKETS.md section 4.';
comment on function public.storage_path_segment2(text) is
  'Second path segment as UUID (branch for delivery-proofs/receipts, user for avatars, product for product-images).';

revoke all on function public.storage_path_tenant(text)   from public, anon;
revoke all on function public.storage_path_segment2(text) from public, anon;
grant execute on function public.storage_path_tenant(text)   to authenticated, service_role;
grant execute on function public.storage_path_segment2(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Replace the operation-partitioned policies with per-bucket policies
-- ---------------------------------------------------------------------------

drop policy if exists bakeflow_objects_select on storage.objects;
drop policy if exists bakeflow_objects_insert on storage.objects;
drop policy if exists bakeflow_objects_update on storage.objects;
drop policy if exists bakeflow_objects_delete on storage.objects;

-- === avatars ===============================================================
-- Readable by colleagues in the same organization; writable only by the owning user.
-- Fixes W5. Deletion stays with owner/admin so a departed employee's avatar can be
-- removed, but branch_manager is dropped: the live policy let a branch manager delete
-- any colleague's avatar tenant-wide, which no section of the document asks for.

create policy avatars_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'avatars'
    and public.storage_path_tenant(name) = public.current_tenant_id()
  );

create policy avatars_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and public.storage_path_tenant(name) = public.current_tenant_id()
    and public.storage_path_segment2(name) = auth.uid()
  );

create policy avatars_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'avatars'
    and public.storage_path_tenant(name) = public.current_tenant_id()
    and public.storage_path_segment2(name) = auth.uid()
  )
  with check (
    bucket_id = 'avatars'
    and public.storage_path_tenant(name) = public.current_tenant_id()
    and public.storage_path_segment2(name) = auth.uid()
  );

create policy avatars_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'avatars'
    and public.storage_path_tenant(name) = public.current_tenant_id()
    and (
      public.storage_path_segment2(name) = auth.uid()
      or public.has_role(array['owner','admin'])
    )
  );

-- === product-images ========================================================
-- Catalog data: readable by every member, writable only with products.manage.
-- Uses the permission catalog rather than a hard-coded role list, per
-- ROLES-AND-PERMISSIONS.md section 4 and RLS-POLICY-PATTERNS.md section 4.

create policy product_images_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'product-images'
    and public.storage_path_tenant(name) = public.current_tenant_id()
  );

create policy product_images_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'product-images'
    and public.storage_path_tenant(name) = public.current_tenant_id()
    and public.has_permission('products.manage', null)
  );

create policy product_images_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'product-images'
    and public.storage_path_tenant(name) = public.current_tenant_id()
    and public.has_permission('products.manage', null)
  )
  with check (
    bucket_id = 'product-images'
    and public.storage_path_tenant(name) = public.current_tenant_id()
  );

create policy product_images_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'product-images'
    and public.storage_path_tenant(name) = public.current_tenant_id()
    and public.has_permission('products.manage', null)
  );

-- === delivery-proofs =======================================================
-- Proof of delivery is evidence. Branch-scoped for read (fixes W1), insert-only for
-- write: NO update policy and NO delete policy, so an uploaded proof is immutable to
-- every client (fixes W3). Correcting a wrong proof means uploading a new object and
-- repointing deliveries.proof_url; the old object is cleaned up by a service-role job.
-- Omitting a policy IS the prohibition -- RLS-POLICY-PATTERNS.md section 1 rule 5.

-- The `segment2 is not null` guard is load-bearing, not belt-and-braces:
-- has_branch_access() returns TRUE for owner/admin regardless of its argument, so
-- without it an object stored at a malformed path (no branch segment) would still be
-- readable by an owner. Requiring the segment makes the path convention mandatory
-- rather than advisory for the two branch-scoped buckets.

create policy delivery_proofs_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'delivery-proofs'
    and public.storage_path_tenant(name) = public.current_tenant_id()
    and public.storage_path_segment2(name) is not null
    and public.has_branch_access(public.storage_path_segment2(name))
  );

create policy delivery_proofs_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'delivery-proofs'
    and public.storage_path_tenant(name) = public.current_tenant_id()
    and public.storage_path_segment2(name) is not null
    and public.has_branch_access(public.storage_path_segment2(name))
  );

-- === receipts ==============================================================
-- The most sensitive bucket: financial evidence, and the only one accepting PDFs.
-- Read requires branch access AND financial.view, so a Driver can no longer download
-- every receipt in the organization (fixes W2). Write requires
-- financial.expense.create. As with delivery proofs there is deliberately no update
-- and no delete policy -- financial evidence is immutable to clients (section 67).

create policy receipts_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'receipts'
    and public.storage_path_tenant(name) = public.current_tenant_id()
    and public.storage_path_segment2(name) is not null
    and public.has_branch_access(public.storage_path_segment2(name))
    and public.has_permission('financial.view', public.storage_path_segment2(name))
  );

create policy receipts_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'receipts'
    and public.storage_path_tenant(name) = public.current_tenant_id()
    and public.storage_path_segment2(name) is not null
    and public.has_branch_access(public.storage_path_segment2(name))
    and public.has_permission('financial.expense.create', public.storage_path_segment2(name))
  );

-- ---------------------------------------------------------------------------
-- Notes on what is deliberately NOT granted
-- ---------------------------------------------------------------------------
-- * anon has no policy on any bucket, so unauthenticated access is impossible.
-- * Every bucket_id above is spelled out in BOTH using and with_check, closing W4 --
--   an object cannot be moved between buckets.
-- * delivery-proofs and receipts have no UPDATE and no DELETE policy at all. Cleanup of
--   orphaned objects runs as service role, which bypasses RLS by design
--   (STORAGE-BUCKETS.md section 52). That job does not exist yet.
-- * A bucket not listed here has no policy and is therefore inaccessible to clients,
--   which is the correct default for any bucket added later.
