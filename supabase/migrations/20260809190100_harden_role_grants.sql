-- 20260809190100_harden_role_grants
--
-- The Data API roles were granted more than they need, almost certainly via a blanket
-- GRANT ALL that was later partially walked back with targeted REVOKEs.
--
-- Three of those privileges are not filtered by row-level security:
--
--   TRUNCATE   fires no row triggers and consults no policy. `authenticated` holding it
--              on payments, refunds, stock_movements and audit_log defeats the
--              immutability triggers those tables rely on (Core Rules 7, 8, 9) and
--              would wipe every tenant's ledger, not just the caller's.
--   TRIGGER    lets a client attach its own trigger function to a table it does not own.
--   REFERENCES lets a client create foreign keys that leak existence of other tenants' rows.
--
-- `anon` (unauthenticated) additionally held SELECT/INSERT/UPDATE on the four tables
-- added by 20260809163758. No policy grants anon anything, so RLS was the only thing
-- standing between an unauthenticated caller and the offline-sync tables. anon holds
-- nothing on the other 30 tables, which confirms these four were accidental.

revoke truncate, trigger, references on all tables in schema public from anon, authenticated;

-- anon is unauthenticated and anonymous sign-ins are disabled; it needs nothing here.
revoke all privileges on all tables in schema public from anon;

-- roles is platform reference data: "seeded by migration ... never written at runtime".
revoke insert, update, delete on public.roles from authenticated;

-- Stop the same over-grant reappearing on tables created by future migrations.
alter default privileges for role postgres in schema public
  revoke truncate, trigger, references on tables from anon, authenticated;

alter default privileges for role postgres in schema public
  revoke all on tables from anon;
