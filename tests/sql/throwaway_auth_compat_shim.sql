-- BakeFlow — throwaway-database platform-schema compatibility shim (auth + storage).
--
-- DO NOT apply this to the live production project (tvfyxpafbpnkneujcnvr) or any other real
-- Supabase-managed database. It exists for exactly one purpose: bringing a FRESH
-- supabase/postgres Docker image's bundled auth/storage schemas up to the minimum parity
-- supabase/migrations/20260809_live_schema.sql needs to apply cleanly (that file's own header
-- explicitly puts auth/storage/vault out of its scope — "provisioned by the Supabase platform
-- itself" — which is true on a real project but not on this stock image, where nothing ever
-- provisions them). On a real Supabase project these objects are already correct and managed
-- by the platform; this file would be redundant there at best.
--
-- WHY THIS IS NEEDED, verified live 2026-09-01 by actually applying the baseline to a fresh
-- container (something BLOCKER-002's earlier verification never did beyond table/constraint/
-- index DDL) and fixing each failure as it surfaced:
--   1. auth: the stock image's auth.uid()/auth.role()/auth.email() only read the legacy
--      per-claim GUC convention (request.jwt.claim.sub etc.), and auth.jwt() doesn't exist at
--      all. The live project's versions (pg_get_functiondef'd directly from tvfyxpafbpnkneujcnvr)
--      also fall back to the newer JSON-blob request.jwt.claims GUC, which is what every
--      tests/sql/*.sql suite actually sets via set_config('request.jwt.claims', ..., true).
--   2. storage: the stock image has an empty `storage` schema (namespace only) — no
--      storage.buckets/storage.objects tables, no storage.foldername(). BakeFlow's baseline
--      inserts bucket rows and creates RLS policies on storage.objects using foldername(), all
--      of which need at least a minimal shape to exist. The stub below is NOT the full real
--      storage schema (versioning, path_tokens, etc.) — just enough for the baseline's own
--      INSERT/POLICY statements to apply, since no tests/sql/*.sql suite exercises storage RLS
--      directly.
--
-- Run this BEFORE supabase/migrations/20260809_live_schema.sql, as a role with CREATE
-- privilege on the auth schema. On the stock image, `postgres` is deliberately NOT a superuser
-- (matching real hosted Supabase, where even the postgres role can't touch auth) — connect as
-- `supabase_admin` (the actual bootstrap superuser) instead:
--
--   PGPASSWORD=... psql -h localhost -U supabase_admin -d postgres -v ON_ERROR_STOP=1 \
--     -f tests/sql/throwaway_auth_compat_shim.sql

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $function$
  select
  coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$function$;

CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $function$
  select
  coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$function$;

CREATE OR REPLACE FUNCTION auth.email() RETURNS text LANGUAGE sql STABLE AS $function$
  select
  coalesce(
    nullif(current_setting('request.jwt.claim.email', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email')
  )::text
$function$;

CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $function$
  select
    coalesce(
        nullif(current_setting('request.jwt.claim', true), ''),
        nullif(current_setting('request.jwt.claims', true), '')
    )::jsonb
$function$;

-- Minimal storage.buckets/storage.objects stub -- not the full real schema, just enough for
-- the baseline's own bucket INSERTs and storage.objects RLS policies (which use
-- storage.foldername()) to apply without error.
CREATE TABLE IF NOT EXISTS storage.buckets (
  id text PRIMARY KEY,
  name text NOT NULL,
  public boolean DEFAULT false,
  file_size_limit bigint,
  allowed_mime_types text[],
  owner uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS storage.objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text REFERENCES storage.buckets(id),
  name text,
  owner uuid,
  metadata jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- CREATE POLICY requires table ownership (GRANT ALL is not sufficient -- Postgres has no
-- separate "policy" privilege). This shim runs as supabase_admin, but the baseline schema
-- applies as `postgres`, which needs to own these stub tables to INSERT the bucket rows and
-- CREATE POLICY on storage.objects.
ALTER TABLE storage.buckets OWNER TO postgres;
ALTER TABLE storage.objects OWNER TO postgres;

-- Real definition, pg_get_functiondef'd directly from the live project.
CREATE OR REPLACE FUNCTION storage.foldername(name text) RETURNS text[]
 LANGUAGE plpgsql IMMUTABLE AS $function$
DECLARE
    _parts text[];
BEGIN
    SELECT string_to_array(name, '/') INTO _parts;
    RETURN _parts[1 : array_length(_parts,1) - 1];
END
$function$;
