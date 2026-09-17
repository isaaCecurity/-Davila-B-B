-- TD-021 — who may replace or delete a stored file (owner decision, 2026-09-17).
--
-- Before this migration `bakeflow_objects_update` allowed any signed-in member of an organization to
-- overwrite ANY object in that organization's folders, in all four buckets — including receipts and
-- delivery proofs, which are evidence. Nothing in the app overwrites files (every upload gets a new
-- name, `upsert: false`), so this only closes the hole.
--
-- Decided:
--   * Replace (UPDATE): only the person who uploaded the file, and only in `avatars` and
--     `product-images`; owner/admin/branch_manager may also replace shared product photos.
--     Receipts and delivery proofs can never be replaced.
--   * Delete (DELETE): owner/admin/branch_manager as before (avatars, product-images), plus anyone
--     may delete a profile photo they uploaded themselves. Receipts and delivery proofs stay
--     undeletable through the API.
--   * Read (SELECT) and upload (INSERT) are unchanged: any member of the organization, inside that
--     organization's folder.
--
-- The UPDATE policy's WITH CHECK now also pins `bucket_id`, so an object cannot be renamed or moved
-- into `receipts` or `delivery-proofs` to dodge the rules above.

drop policy if exists bakeflow_objects_update on storage.objects;

create policy bakeflow_objects_update on storage.objects
  for update to authenticated
  using (
    bucket_id in ('avatars', 'product-images')
    and (storage.foldername(name))[1] = (current_tenant_id())::text
    and (
      owner_id = (auth.uid())::text
      or (bucket_id = 'product-images' and has_role(array['owner', 'admin', 'branch_manager']))
    )
  )
  with check (
    bucket_id in ('avatars', 'product-images')
    and (storage.foldername(name))[1] = (current_tenant_id())::text
    and (
      owner_id = (auth.uid())::text
      or (bucket_id = 'product-images' and has_role(array['owner', 'admin', 'branch_manager']))
    )
  );

drop policy if exists bakeflow_objects_delete on storage.objects;

create policy bakeflow_objects_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id in ('avatars', 'product-images')
    and (storage.foldername(name))[1] = (current_tenant_id())::text
    and (
      has_role(array['owner', 'admin', 'branch_manager'])
      or (bucket_id = 'avatars' and owner_id = (auth.uid())::text)
    )
  );

comment on policy bakeflow_objects_update on storage.objects is
  'TD-021: replace your own upload (avatars, product-images); owner/admin/branch_manager may replace product photos. Receipts and delivery proofs are never replaceable.';
comment on policy bakeflow_objects_delete on storage.objects is
  'TD-021: owner/admin/branch_manager delete avatars and product photos; anyone may delete a profile photo they uploaded. Receipts and delivery proofs are never deletable.';
