-- ============================================================================
-- BakeFlow — Live Schema Baseline (public schema)
-- ============================================================================
--
-- Generated: 2026-08-31
-- Generation method: LIVE SQL INTROSPECTION against the production Supabase
--   project (ref tvfyxpafbpnkneujcnvr), executed via the mcp__supabase__execute_sql
--   tool. This is NOT a `pg_dump` / `supabase db dump` output: the Supabase CLI
--   in this environment cannot reach the network (`supabase projects list` and
--   `supabase db dump --linked` both fail/hang with no network path to
--   api.supabase.com), so a real pg_dump was not available. Instead this file
--   was built by querying Postgres system catalogs directly (pg_class,
--   pg_attribute, pg_constraint, pg_proc, pg_trigger, pg_policies,
--   information_schema, pg_get_functiondef/pg_get_triggerdef/pg_get_indexdef/
--   pg_get_constraintdef) and formatting the results into DDL with templated
--   SQL (string_agg/format()), not by hand-transcribing objects one at a time.
--
-- Why this file exists: this baseline replaces a prior version of this same
-- file (also dated 20260809) which FALSELY claimed to cover "all 37 core
-- tables ... and forced RLS policies" but in reality contained only 23
-- CREATE TABLE statements and ZERO CREATE POLICY / ENABLE ROW LEVEL SECURITY /
-- CREATE FUNCTION / CREATE TRIGGER statements. That false claim stood
-- undetected for roughly 3 weeks (BLOCKER-002). This file was produced with
-- an explicit acceptance-criteria table checked against live COUNT queries
-- both before and after generation (see the reconciliation report in
-- IMPLEMENTATION_LOG.md, 2026-08-31) specifically so that claim of coverage
-- is verifiable rather than asserted.
--
-- VERIFIED OBJECT COUNTS (public schema unless noted), captured live
-- 2026-08-31 and matched exactly by this file's own generated content:
--   Tables                              : 40
--   Columns                             : 527
--   Primary key constraints             : 40
--   Foreign key constraints             : 173
--   Check constraints                   : 138
--   Unique constraints                  : 38
--   Indexes (non constraint-backed)     : 238
--   Views                               : 0   (live public schema currently has none,
--                                               despite a migration file named
--                                               20260810120000_reporting_views.sql —
--                                               see migration-sync gap, PROJECT-OVERVIEW.md §7)
--   Functions (incl. trigger functions) : 97 in public + 1 in private (can_manage_target_role) = 98
--   Triggers                            : 58
--   RLS-enabled tables                  : 40 / 40 (100%), ALL 40 also FORCE ROW LEVEL SECURITY
--   RLS policies                        : 104
--   Sequences                           : 1  (sync_change_seq)
--   Custom types / enums / domains      : 0
--   Extensions                          : 5  (pg_stat_statements, pgcrypto, plpgsql,
--                                              supabase_vault, uuid-ossp)
--   storage.buckets rows                : 4  (avatars, delivery-proofs, product-images, receipts)
--   storage.objects RLS policies        : 4
--
-- FIXED SINCE FIRST GENERATED (2026-09-01): the paragraph that used to be here flagged
-- public.prevent_driver_trip_delete() (plus, found in the same sweep,
-- guard_driver_trip_transition()/guard_ticket_driver_trip_assignment()) as carrying a stray
-- anon/authenticated EXECUTE grant, mirrored as-is rather than fixed. All three were fixed live
-- the same day this file was first generated (migrations harden_prevent_driver_trip_delete_grant
-- and harden_guard_trigger_function_grants) — but this file's own GRANT statements for them
-- were never updated to match, so applying it to a fresh database silently reintroduced the
-- exact bug it had documented. Found by tests/sql/function_privilege_audit.sql itself, run
-- against a throwaway database built from this file (P11.1 validation). All three now correctly
-- show only {postgres, service_role} in this file's FUNCTION EXECUTE GRANTS section, matching
-- live and matching their four correctly-locked-down "prevent_*_delete/mutation" siblings.
--
-- FIXED SINCE FIRST GENERATED (2026-09-04, weak-link remediation pass): four more in-place
-- behavioral patches. (1) authenticated held INSERT/UPDATE grants on
-- document_sequences/product_stock_levels and INSERT on profiles with no matching RLS policy
-- for any of them -- all three tables are RLS-enabled AND forced, so none were ever a live
-- bypass, but all three were unnecessary attack surface; revoked (migration
-- revoke_dead_authenticated_grants_no_matching_policy). (2) enforce_rate_limit() had a
-- check-then-act TOCTOU race (no lock between its SELECT count(*) and its INSERT); fixed with
-- a pg_advisory_xact_lock keyed on (scope, tenant_id) (migration
-- fix_enforce_rate_limit_toctou). (3) create_organization_invite() had no rate limit of its
-- own (only the separate email-dispatch step did); added a 20/hour cap (migration
-- rate_limit_organization_invite_create). (4) process_sync_batch_context_validated() had no
-- cap on operations-per-call; added a 500-operation cap per EB-017's batch-size guidance
-- (migration cap_sync_batch_operation_count). All four are reflected in this file's GRANT
-- section and the three named functions' bodies respectively.
--
-- FIXED SINCE FIRST GENERATED (2026-09-05, SECURITY DEFINER body-review follow-up):
-- ingredient_stock_levels/product_stock_levels are uniquely keyed by (warehouse_id, item_id)
-- only, not tenant_id, and apply_stock_movement() maintains them via
-- `ON CONFLICT (warehouse_id, item_id) DO UPDATE` -- so any function inserting into
-- stock_movements with an unvalidated warehouse_id could silently mutate ANOTHER tenant's
-- actual stock levels. Two layers of fix: (1) new BEFORE INSERT trigger
-- stock_movements_guard_warehouse_tenant/guard_stock_movement_warehouse_tenant() rejects any
-- stock_movements row whose warehouse does not belong to its own tenant_id -- the real,
-- root-cause backstop, covering every caller present and future (migration
-- guard_stock_movement_warehouse_tenant). (2) five RPCs that accepted an optional
-- warehouse-id override but validated it only when the caller left it out (trusting it
-- blindly when supplied) gained their own explicit, friendly validation matching
-- adjust_stock's existing pattern: complete_driver_field_sale, verify_trip_loading,
-- complete_ticket, complete_production_batch (both overloads), fail_production_batch (both
-- overloads) (migrations fix_complete_driver_field_sale_warehouse_validation,
-- fix_verify_trip_loading_warehouse_validation, fix_complete_ticket_warehouse_validation,
-- fix_complete_production_batch_warehouse_validation[_5arg],
-- fix_fail_production_batch_warehouse_validation[_5arg]). adjust_stock, apply_inventory_adjust,
-- apply_inventory_waste and return_driver_trip already validated correctly and needed no
-- change. Regression-tested in tests/sql/stock_movement_warehouse_tenant_guard.sql (new, 10/10)
-- plus zero regression confirmed on driver_field_sale_rls.sql (8/8), driver_trips_rls.sql
-- (20/20), sales_write_rls.sql (26/26), p3_7_production_sync.sql (4/4), and
-- p3_7_production_output_waste_sync.sql (8/8).
--
-- SCOPE: this file targets the `public` schema plus the minimal `storage`
-- objects (bucket rows + storage.objects policies) BakeFlow depends on. It
-- does not attempt to reproduce Supabase-managed schemas (auth, storage's own
-- table DDL, vault, realtime, etc.) — those are provisioned by the Supabase
-- platform itself, not by this repo's migrations, and were not part of the
-- false claim this file corrects.
--
-- VERIFICATION PERFORMED: the CREATE TABLE + constraint + index DDL in this
-- file (the highest-risk, most hand-assembled portion) was applied verbatim
-- (with schema references swapped to a scratch schema) to a scratch schema
-- on this SAME live database and executed with zero errors, then the scratch
-- schema was dropped. See IMPLEMENTATION_LOG.md 2026-08-31 for the transcript.
-- Functions/triggers/policies were extracted via pg_get_functiondef /
-- pg_get_triggerdef / pg_policies formatting, which Postgres itself generated
-- as syntactically valid DDL, so they were not re-run through the scratch-schema
-- test (see rationale in the task instructions this file was produced under).
--
-- MAINTENANCE WARNING: nothing currently enforces that this file stays in
-- sync with the live database. It is accurate as of 2026-08-31 ONLY. Any
-- schema change made directly against the live database (or via a migration
-- not mirrored here) will make this file stale again, silently, exactly as
-- happened before. Regenerate it with this same live-introspection method
-- after any significant schema change, and re-run the acceptance-criteria
-- count comparison before trusting it again.
-- ============================================================================


-- ============================================================
-- SECTION: EXTENSIONS
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_stat_statements WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;


-- ============================================================
-- SECTION: SCHEMAS
-- ============================================================
-- The `private` schema (and its one function, private.can_manage_target_role) was entirely
-- missing from this file until 2026-09-01 despite three RLS policies, a GRANT, and one other
-- function body all referencing it -- the file's own header claimed "1 [function] in private"
-- but never actually created the schema or the function. Found the same way as the has_role
-- ordering bug: applying this file to a genuinely fresh database, which is exactly what BLOCKER
-- -002's earlier verification never did for anything beyond table/constraint/index DDL. See
-- IMPLEMENTATION_LOG.md 2026-09-01.
CREATE SCHEMA IF NOT EXISTS private;


-- ============================================================
-- SECTION: SEQUENCES
-- ============================================================

CREATE SEQUENCE IF NOT EXISTS public.sync_change_seq START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 NO CYCLE;


-- ============================================================
-- SECTION: TABLES (41 total as of 2026-09-02/BLOCKER-025, columns + PK/UNIQUE/CHECK constraints inline)
-- ============================================================

CREATE TABLE public.audit_log (
  id uuid DEFAULT gen_random_uuid() NOT NULL
,  tenant_id uuid NOT NULL
,  actor_id uuid
,  entity_type text NOT NULL
,  entity_id uuid NOT NULL
,  action text NOT NULL
,  before jsonb
,  after jsonb
,  occurred_at timestamp with time zone DEFAULT now() NOT NULL
,  deleted_at timestamp with time zone
,  deleted_by uuid
,  CONSTRAINT audit_log_action_check CHECK ((action = ANY (ARRAY['insert'::text, 'update'::text, 'delete'::text, 'status_change'::text])))
,  CONSTRAINT audit_log_pkey PRIMARY KEY (id)
);

CREATE TABLE public.branch_assignments (
  id uuid DEFAULT gen_random_uuid() NOT NULL
,  tenant_id uuid NOT NULL
,  profile_id uuid NOT NULL
,  branch_id uuid NOT NULL
,  is_default boolean DEFAULT false NOT NULL
,  created_at timestamp with time zone DEFAULT now() NOT NULL
,  updated_at timestamp with time zone DEFAULT now() NOT NULL
,  created_by uuid
,  deleted_at timestamp with time zone
,  deleted_by uuid
,  CONSTRAINT branch_assignments_pkey PRIMARY KEY (id)
,  CONSTRAINT branch_assignments_tenant_profile_branch_key UNIQUE (tenant_id, profile_id, branch_id)
);

CREATE TABLE public.branches (
  id uuid DEFAULT gen_random_uuid() NOT NULL
,  tenant_id uuid NOT NULL
,  name text NOT NULL
,  code text NOT NULL
,  address_line text
,  city text
,  phone text
,  is_primary boolean DEFAULT false NOT NULL
,  status text DEFAULT 'active'::text NOT NULL
,  created_at timestamp with time zone DEFAULT now() NOT NULL
,  updated_at timestamp with time zone DEFAULT now() NOT NULL
,  created_by uuid
,  deleted_at timestamp with time zone
,  deleted_by uuid
,  CONSTRAINT branches_address_length CHECK (((address_line IS NULL) OR (length(address_line) <= 500)))
,  CONSTRAINT branches_city_length CHECK (((city IS NULL) OR (length(city) <= 100)))
,  CONSTRAINT branches_code_check CHECK ((length(btrim(code)) > 0))
,  CONSTRAINT branches_code_length CHECK (((length(btrim(code)) >= 1) AND (length(btrim(code)) <= 30)))
,  CONSTRAINT branches_name_check CHECK ((length(btrim(name)) > 0))
,  CONSTRAINT branches_name_length CHECK (((length(btrim(name)) >= 1) AND (length(btrim(name)) <= 150)))
,  CONSTRAINT branches_phone_length CHECK (((phone IS NULL) OR (length(phone) <= 40)))
,  CONSTRAINT branches_status_check CHECK ((status = ANY (ARRAY['active'::text, 'inactive'::text])))
,  CONSTRAINT branches_pkey PRIMARY KEY (id)
,  CONSTRAINT branches_tenant_code_key UNIQUE (tenant_id, code)
,  CONSTRAINT branches_tenant_id_key UNIQUE (tenant_id, id)
);

CREATE TABLE public.cash_sessions (
  id uuid DEFAULT gen_random_uuid() NOT NULL
,  tenant_id uuid NOT NULL
,  branch_id uuid NOT NULL
,  opened_by uuid NOT NULL
,  closed_by uuid
,  opening_float numeric(19,4) NOT NULL
,  expected_amount numeric(19,4)
,  counted_amount numeric(19,4)
,  variance_amount numeric(19,4) GENERATED ALWAYS AS ((counted_amount - expected_amount)) STORED
,  variance_note text
,  status text DEFAULT 'open'::text NOT NULL
,  opened_at timestamp with time zone DEFAULT now() NOT NULL
,  closed_at timestamp with time zone
,  created_at timestamp with time zone DEFAULT now() NOT NULL
,  updated_at timestamp with time zone DEFAULT now() NOT NULL
,  created_by uuid
,  deleted_at timestamp with time zone
,  deleted_by uuid
,  revision bigint DEFAULT 1 NOT NULL
,  CONSTRAINT cash_sessions_closed_complete CHECK (((status = 'open'::text) OR ((counted_amount IS NOT NULL) AND (expected_amount IS NOT NULL) AND (closed_at IS NOT NULL) AND (closed_by IS NOT NULL))))
,  CONSTRAINT cash_sessions_closed_fields CHECK ((((status = 'open'::text) AND (closed_at IS NULL) AND (closed_by IS NULL)) OR ((status = 'closed'::text) AND (closed_at IS NOT NULL) AND (closed_by IS NOT NULL) AND (counted_amount IS NOT NULL))))
,  CONSTRAINT cash_sessions_opening_float_check CHECK ((opening_float >= (0)::numeric))
,  CONSTRAINT cash_sessions_revision_check CHECK ((revision > 0))
,  CONSTRAINT cash_sessions_status_check CHECK ((status = ANY (ARRAY['open'::text, 'closed'::text])))
,  CONSTRAINT cash_sessions_variance_needs_note CHECK (((status = 'open'::text) OR (counted_amount = expected_amount) OR (COALESCE(btrim(variance_note), ''::text) <> ''::text)))
,  CONSTRAINT cash_sessions_pkey PRIMARY KEY (id)
,  CONSTRAINT cash_sessions_tenant_id_key UNIQUE (tenant_id, id)
);

CREATE TABLE public.customers (
  id uuid DEFAULT gen_random_uuid() NOT NULL
,  tenant_id uuid NOT NULL
,  full_name text NOT NULL
,  phone text
,  email text
,  address_line text
,  notes text
,  is_walk_in boolean DEFAULT false NOT NULL
,  created_at timestamp with time zone DEFAULT now() NOT NULL
,  updated_at timestamp with time zone DEFAULT now() NOT NULL
,  created_by uuid
,  deleted_at timestamp with time zone
,  deleted_by uuid
,  CONSTRAINT customers_email_length CHECK (((email IS NULL) OR (length(email) <= 320)))
,  CONSTRAINT customers_full_name_check CHECK ((length(btrim(full_name)) > 0))
,  CONSTRAINT customers_name_length CHECK (((length(btrim(full_name)) >= 1) AND (length(btrim(full_name)) <= 200)))
,  CONSTRAINT customers_notes_length CHECK (((notes IS NULL) OR (length(notes) <= 2000)))
,  CONSTRAINT customers_phone_length CHECK (((phone IS NULL) OR (length(phone) <= 40)))
,  CONSTRAINT customers_pkey PRIMARY KEY (id)
,  CONSTRAINT customers_tenant_id_key UNIQUE (tenant_id, id)
);

CREATE TABLE public.daily_financial_audits (
  id uuid DEFAULT gen_random_uuid() NOT NULL
,  tenant_id uuid NOT NULL
,  branch_id uuid NOT NULL
,  audit_date date NOT NULL
,  submitted_by uuid NOT NULL
,  device_id uuid
,  status text DEFAULT 'PENDING_SYNC'::text NOT NULL
,  opening_balance numeric(19,4) DEFAULT 0 NOT NULL
,  expected_cash numeric(19,4) DEFAULT 0 NOT NULL
,  physical_cash numeric(19,4) DEFAULT 0 NOT NULL
,  variance numeric(19,4) DEFAULT 0 NOT NULL
,  variance_reason text
,  device_created_at timestamp with time zone DEFAULT now() NOT NULL
,  submitted_at timestamp with time zone
,  confirmed_at timestamp with time zone
,  confirmed_by uuid
,  base_cash_session_revision bigint
,  created_at timestamp with time zone DEFAULT now() NOT NULL
,  updated_at timestamp with time zone DEFAULT now() NOT NULL
,  deleted_at timestamp with time zone
,  deleted_by uuid
,  delete_reason text
,  cash_session_id uuid
,  CONSTRAINT daily_financial_audits_opening_balance_check CHECK ((opening_balance >= (0)::numeric))
,  CONSTRAINT daily_financial_audits_physical_cash_check CHECK ((physical_cash >= (0)::numeric))
,  CONSTRAINT daily_financial_audits_status_check CHECK ((status = ANY (ARRAY['DRAFT'::text, 'PENDING_SYNC'::text, 'REQUIRES_RECONCILIATION'::text, 'CONFIRMED'::text, 'REJECTED'::text])))
,  CONSTRAINT daily_financial_audits_variance_consistent CHECK ((variance = (physical_cash - expected_cash)))
,  CONSTRAINT daily_financial_audits_pkey PRIMARY KEY (id)
,  CONSTRAINT daily_financial_audits_tenant_id_branch_id_audit_date_key UNIQUE (tenant_id, branch_id, audit_date)
);

CREATE TABLE public.deliveries (
  id uuid DEFAULT gen_random_uuid() NOT NULL
,  tenant_id uuid NOT NULL
,  branch_id uuid NOT NULL
,  ticket_id uuid NOT NULL
,  driver_id uuid
,  status text DEFAULT 'pending'::text NOT NULL
,  address_line text NOT NULL
,  contact_phone text
,  scheduled_at timestamp with time zone
,  dispatched_at timestamp with time zone
,  delivered_at timestamp with time zone
,  proof_url text
,  recipient_name text
,  failure_reason text
,  created_at timestamp with time zone DEFAULT now() NOT NULL
,  updated_at timestamp with time zone DEFAULT now() NOT NULL
,  created_by uuid
,  deleted_at timestamp with time zone
,  deleted_by uuid
,  CONSTRAINT deliveries_address_length CHECK (((length(btrim(address_line)) >= 1) AND (length(btrim(address_line)) <= 1000)))
,  CONSTRAINT deliveries_address_line_check CHECK ((length(btrim(address_line)) > 0))
,  CONSTRAINT deliveries_assigned_needs_driver CHECK (((status <> ALL (ARRAY['assigned'::text, 'in_transit'::text])) OR (driver_id IS NOT NULL)))
,  CONSTRAINT deliveries_delivered_needs_proof CHECK (((status <> 'delivered'::text) OR (COALESCE(btrim(proof_url), ''::text) <> ''::text) OR (COALESCE(btrim(recipient_name), ''::text) <> ''::text)))
,  CONSTRAINT deliveries_failed_needs_reason CHECK (((status <> 'failed'::text) OR (COALESCE(btrim(failure_reason), ''::text) <> ''::text)))
,  CONSTRAINT deliveries_failure_reason_length CHECK (((failure_reason IS NULL) OR (length(failure_reason) <= 1000)))
,  CONSTRAINT deliveries_recipient_length CHECK (((recipient_name IS NULL) OR (length(btrim(recipient_name)) <= 200)))
,  CONSTRAINT deliveries_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'assigned'::text, 'in_transit'::text, 'delivered'::text, 'failed'::text, 'returned'::text])))
,  CONSTRAINT deliveries_pkey PRIMARY KEY (id)
,  CONSTRAINT deliveries_tenant_id_key UNIQUE (tenant_id, id)
,  CONSTRAINT deliveries_ticket_id_key UNIQUE (ticket_id)
);

CREATE TABLE public.document_sequences (
  id uuid DEFAULT gen_random_uuid() NOT NULL
,  tenant_id uuid NOT NULL
,  doc_type text NOT NULL
,  prefix text NOT NULL
,  current_value bigint DEFAULT 0 NOT NULL
,  created_at timestamp with time zone DEFAULT now() NOT NULL
,  updated_at timestamp with time zone DEFAULT now() NOT NULL
,  deleted_at timestamp with time zone
,  deleted_by uuid
,  CONSTRAINT document_sequences_current_value_check CHECK ((current_value >= 0))
,  CONSTRAINT document_sequences_doc_type_check CHECK ((doc_type = ANY (ARRAY['ticket'::text, 'invoice'::text, 'production_batch'::text])))
,  CONSTRAINT document_sequences_pkey PRIMARY KEY (id)
,  CONSTRAINT document_sequences_tenant_type_key UNIQUE (tenant_id, doc_type)
);

CREATE TABLE public.driver_trips (
  id uuid DEFAULT gen_random_uuid() NOT NULL
,  tenant_id uuid NOT NULL
,  branch_id uuid NOT NULL
,  driver_id uuid NOT NULL
,  warehouse_id uuid NOT NULL
,  status text DEFAULT 'created'::text NOT NULL
,  loading_verified_by uuid
,  loading_verified_at timestamp with time zone
,  departed_at timestamp with time zone
,  returned_at timestamp with time zone
,  expected_cash numeric(19,4)
,  physical_cash numeric(19,4)
,  cash_variance numeric(19,4)
,  cash_variance_note text
,  settlement_cash_session_id uuid
,  reconciled_by uuid
,  reconciled_at timestamp with time zone
,  reconciliation_note text
,  created_at timestamp with time zone DEFAULT now() NOT NULL
,  updated_at timestamp with time zone DEFAULT now() NOT NULL
,  created_by uuid
,  deleted_at timestamp with time zone
,  deleted_by uuid
,  revision bigint DEFAULT 1 NOT NULL
,  CONSTRAINT driver_trips_cash_variance_consistent CHECK (((expected_cash IS NULL) OR (physical_cash IS NULL) OR (cash_variance = (physical_cash - expected_cash))))
,  CONSTRAINT driver_trips_expected_cash_check CHECK (((expected_cash IS NULL) OR (expected_cash >= (0)::numeric)))
,  CONSTRAINT driver_trips_loading_verified_pair CHECK (((loading_verified_by IS NULL) = (loading_verified_at IS NULL)))
,  CONSTRAINT driver_trips_physical_cash_check CHECK (((physical_cash IS NULL) OR (physical_cash >= (0)::numeric)))
,  CONSTRAINT driver_trips_reconciled_needs_cash CHECK (((status <> ALL (ARRAY['reconciled'::text, 'completed'::text])) OR ((expected_cash IS NOT NULL) AND (physical_cash IS NOT NULL) AND (reconciled_by IS NOT NULL) AND (reconciled_at IS NOT NULL))))
,  CONSTRAINT driver_trips_revision_check CHECK ((revision > 0))
,  CONSTRAINT driver_trips_status_check CHECK ((status = ANY (ARRAY['created'::text, 'loading'::text, 'ready_to_depart'::text, 'in_transit'::text, 'returning'::text, 'reconciled'::text, 'completed'::text])))
,  CONSTRAINT driver_trips_variance_needs_note CHECK (((cash_variance IS NULL) OR (cash_variance = (0)::numeric) OR (COALESCE(btrim(cash_variance_note), ''::text) <> ''::text)))
,  CONSTRAINT driver_trips_pkey PRIMARY KEY (id)
);

CREATE TABLE public.expenses (
  id uuid DEFAULT gen_random_uuid() NOT NULL
,  tenant_id uuid NOT NULL
,  branch_id uuid NOT NULL
,  category text NOT NULL
,  amount numeric(19,4) NOT NULL
,  description text
,  paid_method text
,  cash_session_id uuid
,  incurred_at timestamp with time zone DEFAULT now() NOT NULL
,  receipt_url text
,  created_at timestamp with time zone DEFAULT now() NOT NULL
,  updated_at timestamp with time zone DEFAULT now() NOT NULL
,  created_by uuid
,  deleted_at timestamp with time zone
,  deleted_by uuid
,  CONSTRAINT expenses_amount_check CHECK ((amount > (0)::numeric))
,  CONSTRAINT expenses_cash_needs_session CHECK (((paid_method <> 'cash'::text) OR (cash_session_id IS NOT NULL)))
,  CONSTRAINT expenses_category_check CHECK ((category = ANY (ARRAY['ingredients'::text, 'rent'::text, 'utilities'::text, 'salaries'::text, 'transport'::text, 'other'::text])))
,  CONSTRAINT expenses_description_length CHECK (((description IS NULL) OR (length(description) <= 2000)))
,  CONSTRAINT expenses_paid_method_check CHECK ((paid_method = ANY (ARRAY['cash'::text, 'card'::text, 'transfer'::text, 'pos'::text])))
,  CONSTRAINT expenses_pkey PRIMARY KEY (id)
);

CREATE TABLE public.ingredient_stock_levels (
  id uuid DEFAULT gen_random_uuid() NOT NULL
,  tenant_id uuid NOT NULL
,  branch_id uuid NOT NULL
,  warehouse_id uuid NOT NULL
,  ingredient_id uuid NOT NULL
,  quantity_on_hand numeric(18,4) DEFAULT 0 NOT NULL
,  created_at timestamp with time zone DEFAULT now() NOT NULL
,  updated_at timestamp with time zone DEFAULT now() NOT NULL
,  deleted_at timestamp with time zone
,  deleted_by uuid
,  CONSTRAINT ingredient_stock_levels_pkey PRIMARY KEY (id)
,  CONSTRAINT ingredient_stock_levels_warehouse_item_key UNIQUE (warehouse_id, ingredient_id)
);

CREATE TABLE public.ingredients (
  id uuid DEFAULT gen_random_uuid() NOT NULL
,  tenant_id uuid NOT NULL
,  name text NOT NULL
,  unit_of_measure text NOT NULL
,  reorder_level numeric(18,4) DEFAULT 0 NOT NULL
,  last_unit_cost numeric(19,4)
,  is_active boolean DEFAULT true NOT NULL
,  created_at timestamp with time zone DEFAULT now() NOT NULL
,  updated_at timestamp with time zone DEFAULT now() NOT NULL
,  created_by uuid
,  deleted_at timestamp with time zone
,  deleted_by uuid
,  CONSTRAINT ingredients_last_unit_cost_check CHECK ((last_unit_cost >= (0)::numeric))
,  CONSTRAINT ingredients_name_check CHECK ((length(btrim(name)) > 0))
,  CONSTRAINT ingredients_name_length CHECK (((length(btrim(name)) >= 1) AND (length(btrim(name)) <= 150)))
,  CONSTRAINT ingredients_reorder_level_check CHECK ((reorder_level >= (0)::numeric))
,  CONSTRAINT ingredients_unit_of_measure_check CHECK ((unit_of_measure = ANY (ARRAY['kg'::text, 'g'::text, 'l'::text, 'ml'::text, 'unit'::text])))
,  CONSTRAINT ingredients_pkey PRIMARY KEY (id)
,  CONSTRAINT ingredients_tenant_id_key UNIQUE (tenant_id, id)
);

CREATE TABLE public.invoices (
  id uuid DEFAULT gen_random_uuid() NOT NULL
,  tenant_id uuid NOT NULL
,  branch_id uuid NOT NULL
,  ticket_id uuid NOT NULL
,  invoice_number text NOT NULL
,  issued_at timestamp with time zone DEFAULT now() NOT NULL
,  due_at timestamp with time zone
,  total_amount numeric(19,4) NOT NULL
,  status text DEFAULT 'issued'::text NOT NULL
,  created_at timestamp with time zone DEFAULT now() NOT NULL
,  updated_at timestamp with time zone DEFAULT now() NOT NULL
,  created_by uuid
,  deleted_at timestamp with time zone
,  deleted_by uuid
,  CONSTRAINT invoices_due_after_issue CHECK (((due_at IS NULL) OR (due_at >= issued_at)))
,  CONSTRAINT invoices_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'issued'::text, 'partially_paid'::text, 'paid'::text, 'void'::text])))
,  CONSTRAINT invoices_total_amount_check CHECK ((total_amount >= (0)::numeric))
,  CONSTRAINT invoices_pkey PRIMARY KEY (id)
,  CONSTRAINT invoices_tenant_id_key UNIQUE (tenant_id, id)
,  CONSTRAINT invoices_tenant_number_key UNIQUE (tenant_id, invoice_number)
,  CONSTRAINT invoices_ticket_id_key UNIQUE (ticket_id)
);

CREATE TABLE public.organization_invites (
  id uuid DEFAULT gen_random_uuid() NOT NULL
,  tenant_id uuid NOT NULL
,  email text NOT NULL
,  role_id uuid NOT NULL
,  branch_id uuid
,  token_hash text NOT NULL
,  status text DEFAULT 'pending'::text NOT NULL
,  expires_at timestamp with time zone NOT NULL
,  accepted_by uuid
,  accepted_at timestamp with time zone
,  created_at timestamp with time zone DEFAULT now() NOT NULL
,  updated_at timestamp with time zone DEFAULT now() NOT NULL
,  created_by uuid
,  deleted_at timestamp with time zone
,  deleted_by uuid
,  CONSTRAINT organization_invites_acceptance_fields CHECK ((((status = 'accepted'::text) AND (accepted_by IS NOT NULL) AND (accepted_at IS NOT NULL)) OR (status <> 'accepted'::text)))
,  CONSTRAINT organization_invites_accepted_consistent CHECK (((status = 'accepted'::text) = (accepted_at IS NOT NULL)))
,  CONSTRAINT organization_invites_email_check CHECK ((POSITION(('@'::text) IN (email)) > 1))
,  CONSTRAINT organization_invites_expiry_future CHECK ((expires_at > created_at))
,  CONSTRAINT organization_invites_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'revoked'::text, 'expired'::text])))
,  CONSTRAINT organization_invites_pkey PRIMARY KEY (id)
,  CONSTRAINT organization_invites_token_hash_key UNIQUE (token_hash)
);

CREATE TABLE public.organizations (
  id uuid DEFAULT gen_random_uuid() NOT NULL
,  name text NOT NULL
,  slug text NOT NULL
,  country_code text DEFAULT 'NG'::text NOT NULL
,  currency_code text DEFAULT 'NGN'::text NOT NULL
,  timezone text DEFAULT 'Africa/Lagos'::text NOT NULL
,  status text DEFAULT 'active'::text NOT NULL
,  allow_negative_stock boolean DEFAULT false NOT NULL
,  created_at timestamp with time zone DEFAULT now() NOT NULL
,  updated_at timestamp with time zone DEFAULT now() NOT NULL
,  created_by uuid
,  deleted_at timestamp with time zone
,  deleted_by uuid
,  CONSTRAINT organizations_country_code_check CHECK ((country_code ~ '^[A-Z]{2}$'::text))
,  CONSTRAINT organizations_currency_code_check CHECK ((currency_code ~ '^[A-Z]{3}$'::text))
,  CONSTRAINT organizations_name_check CHECK ((length(btrim(name)) > 0))
,  CONSTRAINT organizations_name_length CHECK (((length(btrim(name)) >= 1) AND (length(btrim(name)) <= 200)))
,  CONSTRAINT organizations_slug_check CHECK ((slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text))
,  CONSTRAINT organizations_status_check CHECK ((status = ANY (ARRAY['active'::text, 'suspended'::text, 'closed'::text])))
,  CONSTRAINT organizations_timezone_length CHECK (((length(timezone) >= 1) AND (length(timezone) <= 100)))
,  CONSTRAINT organizations_pkey PRIMARY KEY (id)
,  CONSTRAINT organizations_slug_key UNIQUE (slug)
);

CREATE TABLE public.payments (
  id uuid DEFAULT gen_random_uuid() NOT NULL
,  tenant_id uuid NOT NULL
,  branch_id uuid NOT NULL
,  ticket_id uuid
,  invoice_id uuid
,  cash_session_id uuid
,  amount numeric(19,4) NOT NULL
,  method text NOT NULL
,  reference text
,  received_at timestamp with time zone DEFAULT now() NOT NULL
,  created_at timestamp with time zone DEFAULT now() NOT NULL
,  updated_at timestamp with time zone DEFAULT now() NOT NULL
,  created_by uuid
,  deleted_at timestamp with time zone
,  deleted_by uuid
,  driver_trip_id uuid
,  CONSTRAINT payments_amount_check CHECK ((amount > (0)::numeric))
,  CONSTRAINT payments_cash_needs_custody_context CHECK (((method <> 'cash'::text) OR (cash_session_id IS NOT NULL) OR (driver_trip_id IS NOT NULL)))
,  CONSTRAINT payments_custody_context_exclusive CHECK (((cash_session_id IS NULL) OR (driver_trip_id IS NULL)))
,  CONSTRAINT payments_method_check CHECK ((method = ANY (ARRAY['cash'::text, 'card'::text, 'transfer'::text, 'pos'::text, 'credit'::text])))
,  CONSTRAINT payments_pkey PRIMARY KEY (id)
);

CREATE TABLE public.permanent_deletion_challenges (
  id uuid DEFAULT gen_random_uuid() NOT NULL
,  tenant_id uuid NOT NULL
,  requested_by uuid NOT NULL
,  target_table text NOT NULL
,  target_id uuid NOT NULL
,  confirmation_phrase_hash text NOT NULL
,  expires_at timestamp with time zone NOT NULL
,  consumed_at timestamp with time zone
,  created_at timestamp with time zone DEFAULT now() NOT NULL
,  CONSTRAINT permanent_delete_target_check CHECK ((target_table = ANY (ARRAY['customers'::text, 'products'::text, 'product_variants'::text])))
,  CONSTRAINT permanent_deletion_challenges_pkey PRIMARY KEY (id)
);

CREATE TABLE public.permissions (
  id uuid DEFAULT gen_random_uuid() NOT NULL
,  key text NOT NULL
,  name text NOT NULL
,  description text
,  deleted_at timestamp with time zone
,  deleted_by uuid
,  created_at timestamp with time zone DEFAULT now() NOT NULL
,  updated_at timestamp with time zone DEFAULT now() NOT NULL
,  CONSTRAINT permissions_key_check CHECK ((key ~ '^[a-z][a-z0-9_:.]{2,100}$'::text))
,  CONSTRAINT permissions_pkey PRIMARY KEY (id)
,  CONSTRAINT permissions_key_key UNIQUE (key)
);

CREATE TABLE public.product_categories (
  id uuid DEFAULT gen_random_uuid() NOT NULL
,  tenant_id uuid NOT NULL
,  name text NOT NULL
,  sort_order smallint DEFAULT 0 NOT NULL
,  created_at timestamp with time zone DEFAULT now() NOT NULL
,  updated_at timestamp with time zone DEFAULT now() NOT NULL
,  created_by uuid
,  deleted_at timestamp with time zone
,  deleted_by uuid
,  CONSTRAINT product_categories_name_check CHECK ((length(btrim(name)) > 0))
,  CONSTRAINT product_categories_pkey PRIMARY KEY (id)
,  CONSTRAINT product_categories_tenant_id_key UNIQUE (tenant_id, id)
);

CREATE TABLE public.product_stock_levels (
  id uuid DEFAULT gen_random_uuid() NOT NULL
,  tenant_id uuid NOT NULL
,  branch_id uuid NOT NULL
,  warehouse_id uuid NOT NULL
,  product_variant_id uuid NOT NULL
,  quantity_on_hand numeric(18,4) DEFAULT 0 NOT NULL
,  created_at timestamp with time zone DEFAULT now() NOT NULL
,  updated_at timestamp with time zone DEFAULT now() NOT NULL
,  deleted_at timestamp with time zone
,  deleted_by uuid
,  CONSTRAINT product_stock_levels_pkey PRIMARY KEY (id)
,  CONSTRAINT product_stock_levels_warehouse_item_key UNIQUE (warehouse_id, product_variant_id)
);

CREATE TABLE public.product_variants (
  id uuid DEFAULT gen_random_uuid() NOT NULL
,  tenant_id uuid NOT NULL
,  product_id uuid NOT NULL
,  name text NOT NULL
,  sku text NOT NULL
,  unit_price numeric(19,4) NOT NULL
,  is_active boolean DEFAULT true NOT NULL
,  created_at timestamp with time zone DEFAULT now() NOT NULL
,  updated_at timestamp with time zone DEFAULT now() NOT NULL
,  created_by uuid
,  deleted_at timestamp with time zone
,  deleted_by uuid
,  CONSTRAINT product_variants_name_check CHECK ((length(btrim(name)) > 0))
,  CONSTRAINT product_variants_name_length CHECK (((length(btrim(name)) >= 1) AND (length(btrim(name)) <= 150)))
,  CONSTRAINT product_variants_sku_check CHECK ((length(btrim(sku)) > 0))
,  CONSTRAINT product_variants_sku_length CHECK (((length(btrim(sku)) >= 1) AND (length(btrim(sku)) <= 80)))
,  CONSTRAINT product_variants_unit_price_check CHECK ((unit_price >= (0)::numeric))
,  CONSTRAINT product_variants_pkey PRIMARY KEY (id)
,  CONSTRAINT product_variants_tenant_id_key UNIQUE (tenant_id, id)
);

CREATE TABLE public.production_batch_ingredients (
  id uuid DEFAULT gen_random_uuid() NOT NULL
,  tenant_id uuid NOT NULL
,  batch_id uuid NOT NULL
,  ingredient_id uuid NOT NULL
,  planned_quantity numeric(18,4) NOT NULL
,  actual_quantity numeric(18,4)
,  waste_quantity numeric(18,4) DEFAULT 0 NOT NULL
,  created_at timestamp with time zone DEFAULT now() NOT NULL
,  updated_at timestamp with time zone DEFAULT now() NOT NULL
,  created_by uuid
,  deleted_at timestamp with time zone
,  deleted_by uuid
,  CONSTRAINT production_batch_ingredients_actual_quantity_check CHECK ((actual_quantity >= (0)::numeric))
,  CONSTRAINT production_batch_ingredients_planned_quantity_check CHECK ((planned_quantity > (0)::numeric))
,  CONSTRAINT production_batch_ingredients_waste_quantity_check CHECK ((waste_quantity >= (0)::numeric))
,  CONSTRAINT production_batch_ingredients_pkey PRIMARY KEY (id)
,  CONSTRAINT production_batch_ingredients_batch_ingredient_key UNIQUE (batch_id, ingredient_id)
);

CREATE TABLE public.production_batches (
  id uuid DEFAULT gen_random_uuid() NOT NULL
,  tenant_id uuid NOT NULL
,  branch_id uuid NOT NULL
,  batch_number text DEFAULT ''::text NOT NULL
,  recipe_id uuid NOT NULL
,  ticket_id uuid
,  planned_quantity numeric(18,4) NOT NULL
,  actual_quantity numeric(18,4)
,  status text DEFAULT 'scheduled'::text NOT NULL
,  started_at timestamp with time zone
,  completed_at timestamp with time zone
,  assigned_to uuid
,  failure_reason text
,  created_at timestamp with time zone DEFAULT now() NOT NULL
,  updated_at timestamp with time zone DEFAULT now() NOT NULL
,  created_by uuid
,  deleted_at timestamp with time zone
,  deleted_by uuid
,  CONSTRAINT production_batches_actual_le_planned CHECK (((actual_quantity IS NULL) OR (actual_quantity <= planned_quantity)))
,  CONSTRAINT production_batches_actual_quantity_check CHECK ((actual_quantity >= (0)::numeric))
,  CONSTRAINT production_batches_completed_fields CHECK ((((status = 'completed'::text) AND (completed_at IS NOT NULL) AND (actual_quantity IS NOT NULL)) OR (status <> 'completed'::text)))
,  CONSTRAINT production_batches_completed_needs_quantity CHECK (((status <> 'completed'::text) OR (actual_quantity IS NOT NULL)))
,  CONSTRAINT production_batches_failed_needs_reason CHECK (((status <> 'failed'::text) OR (COALESCE(btrim(failure_reason), ''::text) <> ''::text)))
,  CONSTRAINT production_batches_planned_quantity_check CHECK ((planned_quantity > (0)::numeric))
,  CONSTRAINT production_batches_status_check CHECK ((status = ANY (ARRAY['scheduled'::text, 'in_progress'::text, 'completed'::text, 'failed'::text, 'cancelled'::text])))
,  CONSTRAINT production_batches_pkey PRIMARY KEY (id)
,  CONSTRAINT production_batches_tenant_id_key UNIQUE (tenant_id, id)
,  CONSTRAINT production_batches_tenant_number_key UNIQUE (tenant_id, batch_number)
);

CREATE TABLE public.products (
  id uuid DEFAULT gen_random_uuid() NOT NULL
,  tenant_id uuid NOT NULL
,  category_id uuid
,  name text NOT NULL
,  description text
,  image_url text
,  is_active boolean DEFAULT true NOT NULL
,  created_at timestamp with time zone DEFAULT now() NOT NULL
,  updated_at timestamp with time zone DEFAULT now() NOT NULL
,  created_by uuid
,  deleted_at timestamp with time zone
,  deleted_by uuid
,  CONSTRAINT products_description_length CHECK (((description IS NULL) OR (length(description) <= 4000)))
,  CONSTRAINT products_name_check CHECK ((length(btrim(name)) > 0))
,  CONSTRAINT products_name_length CHECK (((length(btrim(name)) >= 1) AND (length(btrim(name)) <= 200)))
,  CONSTRAINT products_pkey PRIMARY KEY (id)
,  CONSTRAINT products_tenant_id_key UNIQUE (tenant_id, id)
);

CREATE TABLE public.profiles (
  id uuid NOT NULL
,  tenant_id uuid
,  primary_branch_id uuid
,  full_name text DEFAULT ''::text NOT NULL
,  phone text
,  avatar_url text
,  status text DEFAULT 'active'::text NOT NULL
,  created_at timestamp with time zone DEFAULT now() NOT NULL
,  updated_at timestamp with time zone DEFAULT now() NOT NULL
,  deleted_at timestamp with time zone
,  deleted_by uuid
,  active_tenant_id uuid
,  CONSTRAINT profiles_status_check CHECK ((status = ANY (ARRAY['active'::text, 'suspended'::text])))
,  CONSTRAINT profiles_pkey PRIMARY KEY (id)
);

CREATE TABLE public.rate_limit_events (
  id uuid DEFAULT gen_random_uuid() NOT NULL
,  tenant_id uuid NOT NULL
,  scope text NOT NULL
,  actor_id uuid
,  occurred_at timestamp with time zone DEFAULT now() NOT NULL
,  CONSTRAINT rate_limit_events_pkey PRIMARY KEY (id)
);

CREATE TABLE public.recipe_ingredients (
  id uuid DEFAULT gen_random_uuid() NOT NULL
,  tenant_id uuid NOT NULL
,  recipe_id uuid NOT NULL
,  ingredient_id uuid NOT NULL
,  quantity numeric(18,4) NOT NULL
,  created_at timestamp with time zone DEFAULT now() NOT NULL
,  updated_at timestamp with time zone DEFAULT now() NOT NULL
,  created_by uuid
,  deleted_at timestamp with time zone
,  deleted_by uuid
,  CONSTRAINT recipe_ingredients_quantity_check CHECK ((quantity > (0)::numeric))
,  CONSTRAINT recipe_ingredients_pkey PRIMARY KEY (id)
,  CONSTRAINT recipe_ingredients_recipe_ingredient_key UNIQUE (recipe_id, ingredient_id)
);

CREATE TABLE public.recipes (
  id uuid DEFAULT gen_random_uuid() NOT NULL
,  tenant_id uuid NOT NULL
,  product_variant_id uuid NOT NULL
,  name text NOT NULL
,  yield_quantity numeric(18,4) NOT NULL
,  version integer DEFAULT 1 NOT NULL
,  is_active boolean DEFAULT true NOT NULL
,  created_at timestamp with time zone DEFAULT now() NOT NULL
,  updated_at timestamp with time zone DEFAULT now() NOT NULL
,  created_by uuid
,  deleted_at timestamp with time zone
,  deleted_by uuid
,  CONSTRAINT recipes_name_check CHECK ((length(btrim(name)) > 0))
,  CONSTRAINT recipes_version_check CHECK ((version > 0))
,  CONSTRAINT recipes_yield_quantity_check CHECK ((yield_quantity > (0)::numeric))
,  CONSTRAINT recipes_pkey PRIMARY KEY (id)
,  CONSTRAINT recipes_tenant_id_key UNIQUE (tenant_id, id)
,  CONSTRAINT recipes_variant_version_key UNIQUE (tenant_id, product_variant_id, version)
);

CREATE TABLE public.refunds (
  id uuid DEFAULT gen_random_uuid() NOT NULL
,  tenant_id uuid NOT NULL
,  branch_id uuid NOT NULL
,  payment_id uuid NOT NULL
,  amount numeric(19,4) NOT NULL
,  reason text NOT NULL
,  refunded_at timestamp with time zone DEFAULT now() NOT NULL
,  created_at timestamp with time zone DEFAULT now() NOT NULL
,  updated_at timestamp with time zone DEFAULT now() NOT NULL
,  created_by uuid
,  deleted_at timestamp with time zone
,  deleted_by uuid
,  CONSTRAINT refunds_amount_check CHECK ((amount > (0)::numeric))
,  CONSTRAINT refunds_reason_check CHECK ((length(btrim(reason)) > 0))
,  CONSTRAINT refunds_pkey PRIMARY KEY (id)
);

CREATE TABLE public.role_permissions (
  role_id uuid NOT NULL
,  permission_id uuid NOT NULL
,  created_at timestamp with time zone DEFAULT now() NOT NULL
,  CONSTRAINT role_permissions_pkey PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE public.roles (
  id uuid DEFAULT gen_random_uuid() NOT NULL
,  key text NOT NULL
,  name text NOT NULL
,  rank smallint NOT NULL
,  deleted_at timestamp with time zone
,  deleted_by uuid
,  CONSTRAINT roles_key_check CHECK ((key = ANY (ARRAY['owner'::text, 'admin'::text, 'branch_manager'::text, 'supervisor'::text, 'baker'::text, 'cashier'::text, 'driver'::text, 'accountant'::text])))
,  CONSTRAINT roles_rank_check CHECK ((rank > 0))
,  CONSTRAINT roles_pkey PRIMARY KEY (id)
,  CONSTRAINT roles_key_key UNIQUE (key)
,  CONSTRAINT roles_rank_key UNIQUE (rank)
);

CREATE TABLE public.stock_movements (
  id uuid DEFAULT gen_random_uuid() NOT NULL
,  tenant_id uuid NOT NULL
,  branch_id uuid NOT NULL
,  warehouse_id uuid NOT NULL
,  item_type text NOT NULL
,  ingredient_id uuid
,  product_variant_id uuid
,  quantity_delta numeric(18,4) NOT NULL
,  reason text NOT NULL
,  reference_type text
,  reference_id uuid
,  unit_cost numeric(19,4)
,  note text
,  created_at timestamp with time zone DEFAULT now() NOT NULL
,  updated_at timestamp with time zone DEFAULT now() NOT NULL
,  created_by uuid
,  deleted_at timestamp with time zone
,  deleted_by uuid
,  CONSTRAINT stock_movements_item_consistent CHECK ((((item_type = 'ingredient'::text) AND (ingredient_id IS NOT NULL) AND (product_variant_id IS NULL)) OR ((item_type = 'product'::text) AND (product_variant_id IS NOT NULL) AND (ingredient_id IS NULL))))
,  CONSTRAINT stock_movements_item_exclusivity CHECK ((((item_type = 'ingredient'::text) AND (ingredient_id IS NOT NULL) AND (product_variant_id IS NULL)) OR ((item_type = 'product'::text) AND (product_variant_id IS NOT NULL) AND (ingredient_id IS NULL))))
,  CONSTRAINT stock_movements_item_type_check CHECK ((item_type = ANY (ARRAY['ingredient'::text, 'product'::text])))
,  CONSTRAINT stock_movements_quantity_delta_check CHECK ((quantity_delta <> (0)::numeric))
,  CONSTRAINT stock_movements_reason_check CHECK ((reason = ANY (ARRAY['purchase'::text, 'production_consume'::text, 'production_output'::text, 'sale'::text, 'waste'::text, 'adjustment'::text, 'transfer_in'::text, 'transfer_out'::text, 'opening_balance'::text])))
,  CONSTRAINT stock_movements_reference_consistent CHECK (((reference_type IS NULL) = (reference_id IS NULL)))
,  CONSTRAINT stock_movements_reference_pair CHECK ((((reference_type IS NULL) AND (reference_id IS NULL)) OR ((reference_type IS NOT NULL) AND (reference_id IS NOT NULL))))
,  CONSTRAINT stock_movements_reference_type_check CHECK ((reference_type = ANY (ARRAY['order'::text, 'production_batch'::text, 'purchase'::text, 'delivery'::text, 'manual'::text, 'driver_trip'::text])))
,  CONSTRAINT stock_movements_sign_matches_reason CHECK (
CASE reason
    WHEN 'purchase'::text THEN (quantity_delta > (0)::numeric)
    WHEN 'production_output'::text THEN (quantity_delta > (0)::numeric)
    WHEN 'transfer_in'::text THEN (quantity_delta > (0)::numeric)
    WHEN 'opening_balance'::text THEN (quantity_delta > (0)::numeric)
    WHEN 'production_consume'::text THEN (quantity_delta < (0)::numeric)
    WHEN 'sale'::text THEN (quantity_delta < (0)::numeric)
    WHEN 'waste'::text THEN (quantity_delta < (0)::numeric)
    WHEN 'transfer_out'::text THEN (quantity_delta < (0)::numeric)
    ELSE true
END)
,  CONSTRAINT stock_movements_unit_cost_check CHECK ((unit_cost >= (0)::numeric))
,  CONSTRAINT stock_movements_pkey PRIMARY KEY (id)
);

CREATE TABLE public.sync_changes (
  sequence_id bigint DEFAULT nextval('sync_change_seq'::regclass) NOT NULL
,  tenant_id uuid NOT NULL
,  branch_id uuid
,  entity_type text NOT NULL
,  entity_id uuid NOT NULL
,  operation_type text NOT NULL
,  revision bigint DEFAULT 1 NOT NULL
,  changed_at timestamp with time zone DEFAULT now() NOT NULL
,  changed_by uuid
,  payload jsonb DEFAULT '{}'::jsonb NOT NULL
,  domain_operation text
,  CONSTRAINT sync_changes_domain_operation_check CHECK (((domain_operation IS NULL) OR (domain_operation = ANY (ARRAY['ticket.create'::text, 'ticket.transition'::text, 'ticket.item_update'::text, 'inventory.adjust'::text, 'inventory.waste'::text, 'payment.create'::text, 'payment.reverse'::text, 'expense.create'::text, 'expense.reverse'::text, 'customer.create'::text, 'customer.update'::text]))))
,  CONSTRAINT sync_changes_operation_type_check CHECK ((operation_type = ANY (ARRAY['CREATE'::text, 'UPDATE'::text, 'SOFT_DELETE'::text, 'EVENT'::text, 'COMMAND'::text, 'CORRECTION'::text])))
,  CONSTRAINT sync_changes_revision_check CHECK ((revision > 0))
,  CONSTRAINT sync_changes_pkey PRIMARY KEY (sequence_id)
,  CONSTRAINT sync_changes_entity_id_revision_key UNIQUE (entity_id, revision)
);

CREATE TABLE public.sync_conflicts (
  id uuid DEFAULT gen_random_uuid() NOT NULL
,  tenant_id uuid NOT NULL
,  branch_id uuid
,  entity_type text NOT NULL
,  entity_id uuid NOT NULL
,  operation_id uuid NOT NULL
,  actor_id uuid NOT NULL
,  device_id uuid NOT NULL
,  operation_type text NOT NULL
,  operation_payload jsonb NOT NULL
,  base_revision bigint
,  current_revision bigint
,  conflict_code text NOT NULL
,  conflict_status text DEFAULT 'OPEN'::text NOT NULL
,  created_at timestamp with time zone DEFAULT now() NOT NULL
,  resolved_at timestamp with time zone
,  resolved_by uuid
,  resolution_type text
,  resolution_payload jsonb
,  CONSTRAINT sync_conflicts_conflict_status_check CHECK ((conflict_status = ANY (ARRAY['OPEN'::text, 'RESOLVED'::text, 'DISMISSED'::text])))
,  CONSTRAINT sync_conflicts_resolution_consistency CHECK ((((conflict_status = 'OPEN'::text) AND (resolved_at IS NULL) AND (resolved_by IS NULL) AND (resolution_type IS NULL)) OR ((conflict_status = ANY (ARRAY['RESOLVED'::text, 'DISMISSED'::text])) AND (resolved_at IS NOT NULL) AND (resolved_by IS NOT NULL) AND (resolution_type IS NOT NULL))))
,  CONSTRAINT sync_conflicts_pkey PRIMARY KEY (id)
,  CONSTRAINT sync_conflicts_operation_id_key UNIQUE (operation_id)
);

CREATE TABLE public.sync_devices (
  id uuid DEFAULT gen_random_uuid() NOT NULL
,  user_id uuid NOT NULL
,  device_label text
,  platform text NOT NULL
,  app_version text
,  last_seen_at timestamp with time zone
,  revoked_at timestamp with time zone
,  created_at timestamp with time zone DEFAULT now() NOT NULL
,  updated_at timestamp with time zone DEFAULT now() NOT NULL
,  CONSTRAINT sync_devices_platform_check CHECK ((platform = ANY (ARRAY['android'::text, 'ios'::text, 'web'::text, 'other'::text])))
,  CONSTRAINT sync_devices_pkey PRIMARY KEY (id)
);

CREATE TABLE public.sync_operations (
  id uuid DEFAULT gen_random_uuid() NOT NULL
,  operation_id uuid NOT NULL
,  tenant_id uuid NOT NULL
,  branch_id uuid
,  device_id uuid NOT NULL
,  actor_id uuid NOT NULL
,  entity_type text NOT NULL
,  entity_id uuid NOT NULL
,  operation_type text NOT NULL
,  base_revision bigint
,  device_created_at timestamp with time zone NOT NULL
,  received_at timestamp with time zone DEFAULT now() NOT NULL
,  status text DEFAULT 'PENDING'::text NOT NULL
,  payload jsonb DEFAULT '{}'::jsonb NOT NULL
,  error_code text
,  error_message text
,  applied_sequence_id bigint
,  applied_at timestamp with time zone
,  result jsonb DEFAULT '{}'::jsonb NOT NULL
,  domain_operation text
,  client_sequence bigint
,  CONSTRAINT sync_operations_base_revision_check CHECK (((base_revision IS NULL) OR (base_revision > 0)))
,  CONSTRAINT sync_operations_client_sequence_check CHECK (((client_sequence IS NULL) OR (client_sequence >= 0)))
,  CONSTRAINT sync_operations_domain_operation_check CHECK (((domain_operation IS NULL) OR (domain_operation = ANY (ARRAY['ticket.create'::text, 'ticket.transition'::text, 'ticket.item_update'::text, 'inventory.adjust'::text, 'inventory.waste'::text, 'payment.create'::text, 'payment.reverse'::text, 'expense.create'::text, 'expense.reverse'::text, 'customer.create'::text, 'customer.update'::text]))))
,  CONSTRAINT sync_operations_operation_type_check CHECK ((operation_type = ANY (ARRAY['CREATE'::text, 'UPDATE'::text, 'SOFT_DELETE'::text, 'EVENT'::text, 'COMMAND'::text, 'CORRECTION'::text])))
,  CONSTRAINT sync_operations_status_check CHECK ((status = ANY (ARRAY['PENDING'::text, 'APPLIED'::text, 'REJECTED'::text, 'CONFLICT'::text])))
,  CONSTRAINT sync_operations_pkey PRIMARY KEY (id)
,  CONSTRAINT sync_operations_device_id_operation_id_key UNIQUE (device_id, operation_id)
,  CONSTRAINT sync_operations_operation_id_key UNIQUE (operation_id)
);

CREATE TABLE public.ticket_items (
  id uuid DEFAULT gen_random_uuid() NOT NULL
,  tenant_id uuid NOT NULL
,  ticket_id uuid NOT NULL
,  product_variant_id uuid NOT NULL
,  quantity numeric(18,4) NOT NULL
,  unit_price numeric(19,4) NOT NULL
,  line_total numeric(19,4) GENERATED ALWAYS AS (round((quantity * unit_price), 4)) STORED
,  created_at timestamp with time zone DEFAULT now() NOT NULL
,  updated_at timestamp with time zone DEFAULT now() NOT NULL
,  created_by uuid
,  deleted_at timestamp with time zone
,  deleted_by uuid
,  CONSTRAINT ticket_items_quantity_check CHECK ((quantity > (0)::numeric))
,  CONSTRAINT ticket_items_unit_price_check CHECK ((unit_price >= (0)::numeric))
,  CONSTRAINT ticket_items_pkey PRIMARY KEY (id)
);

CREATE TABLE public.tickets (
  id uuid DEFAULT gen_random_uuid() NOT NULL
,  tenant_id uuid NOT NULL
,  branch_id uuid NOT NULL
,  customer_id uuid
,  ticket_number text DEFAULT ''::text NOT NULL
,  status text DEFAULT 'draft'::text NOT NULL
,  fulfilment_type text NOT NULL
,  due_at timestamp with time zone
,  subtotal_amount numeric(19,4) DEFAULT 0 NOT NULL
,  discount_amount numeric(19,4) DEFAULT 0 NOT NULL
,  tax_amount numeric(19,4) DEFAULT 0 NOT NULL
,  total_amount numeric(19,4) GENERATED ALWAYS AS (((subtotal_amount - discount_amount) + tax_amount)) STORED
,  amount_paid numeric(19,4) DEFAULT 0 NOT NULL
,  cancelled_reason text
,  created_at timestamp with time zone DEFAULT now() NOT NULL
,  updated_at timestamp with time zone DEFAULT now() NOT NULL
,  created_by uuid
,  deleted_at timestamp with time zone
,  deleted_by uuid
,  assigned_to uuid
,  correction_of_ticket_id uuid
,  device_created_at timestamp with time zone
,  server_received_at timestamp with time zone
,  revision bigint DEFAULT 1 NOT NULL
,  sale_customer_type text DEFAULT 'REGISTERED'::text NOT NULL
,  archived_at timestamp with time zone
,  archived_by uuid
,  archive_reason text
,  driver_trip_id uuid
,  completed_at timestamp with time zone
,  CONSTRAINT tickets_amount_paid_check CHECK ((amount_paid >= (0)::numeric))
,  CONSTRAINT tickets_amount_paid_nonnegative CHECK ((amount_paid >= (0)::numeric))
,  CONSTRAINT tickets_cancel_reason_required CHECK (((status <> 'cancelled'::text) OR (length(btrim(COALESCE(cancelled_reason, ''::text))) > 0)))
,  CONSTRAINT tickets_cancelled_needs_reason CHECK (((status <> 'cancelled'::text) OR (COALESCE(btrim(cancelled_reason), ''::text) <> ''::text)))
,  CONSTRAINT tickets_discount_amount_check CHECK ((discount_amount >= (0)::numeric))
,  CONSTRAINT tickets_discount_not_over_subtotal CHECK ((discount_amount <= subtotal_amount))
,  CONSTRAINT tickets_discount_within_subtotal CHECK ((discount_amount <= subtotal_amount))
,  CONSTRAINT tickets_fulfilment_type_check CHECK ((fulfilment_type = ANY (ARRAY['pickup'::text, 'delivery'::text])))
,  CONSTRAINT tickets_revision_check CHECK ((revision > 0))
,  CONSTRAINT tickets_sale_customer_type_check CHECK ((sale_customer_type = ANY (ARRAY['REGISTERED'::text, 'ROADSIDE'::text])))
,  CONSTRAINT tickets_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'submitted'::text, 'confirmed'::text, 'scheduled'::text, 'in_production'::text, 'ready'::text, 'delivered'::text, 'completed'::text, 'cancelled'::text, 'archived'::text])))
,  CONSTRAINT tickets_subtotal_amount_check CHECK ((subtotal_amount >= (0)::numeric))
,  CONSTRAINT tickets_tax_amount_check CHECK ((tax_amount >= (0)::numeric))
,  CONSTRAINT tickets_pkey PRIMARY KEY (id)
,  CONSTRAINT tickets_tenant_id_key UNIQUE (tenant_id, id)
,  CONSTRAINT tickets_tenant_number_key UNIQUE (tenant_id, ticket_number)
);

CREATE TABLE public.user_roles (
  id uuid DEFAULT gen_random_uuid() NOT NULL
,  tenant_id uuid NOT NULL
,  profile_id uuid NOT NULL
,  role_id uuid NOT NULL
,  branch_id uuid
,  created_at timestamp with time zone DEFAULT now() NOT NULL
,  updated_at timestamp with time zone DEFAULT now() NOT NULL
,  created_by uuid
,  deleted_at timestamp with time zone
,  deleted_by uuid
,  CONSTRAINT user_roles_pkey PRIMARY KEY (id)
);

CREATE TABLE public.warehouses (
  id uuid DEFAULT gen_random_uuid() NOT NULL
,  tenant_id uuid NOT NULL
,  branch_id uuid NOT NULL
,  name text NOT NULL
,  is_default boolean DEFAULT false NOT NULL
,  created_at timestamp with time zone DEFAULT now() NOT NULL
,  updated_at timestamp with time zone DEFAULT now() NOT NULL
,  created_by uuid
,  deleted_at timestamp with time zone
,  deleted_by uuid
,  CONSTRAINT warehouses_name_check CHECK ((length(btrim(name)) > 0))
,  CONSTRAINT warehouses_pkey PRIMARY KEY (id)
,  CONSTRAINT warehouses_tenant_branch_id_key UNIQUE (tenant_id, branch_id, id)
,  CONSTRAINT warehouses_tenant_branch_name_key UNIQUE (tenant_id, branch_id, name)
,  CONSTRAINT warehouses_tenant_id_key UNIQUE (tenant_id, id)
);

-- Added 2026-09-02 (migration add_supervisor_permission_overrides, BLOCKER-025). Placed
-- at the end of this section (after all 40 original tables) so its inline REFERENCES to
-- organizations/profiles/permissions never forward-reference a not-yet-created table.
CREATE TABLE public.user_permission_overrides
(  id uuid DEFAULT gen_random_uuid() NOT NULL
,  tenant_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT
,  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE
,  permission_id uuid NOT NULL REFERENCES public.permissions(id) ON DELETE RESTRICT
,  granted boolean NOT NULL
,  created_at timestamp with time zone DEFAULT now() NOT NULL
,  updated_at timestamp with time zone DEFAULT now() NOT NULL
,  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL
,  deleted_at timestamp with time zone
,  deleted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL
,  CONSTRAINT user_permission_overrides_pkey PRIMARY KEY (id)
);

COMMENT ON TABLE public.user_permission_overrides IS
  'Per-profile permission overrides, set by a Branch Manager for an individual Supervisor. '
  'granted=true raises, granted=false lowers/revokes, absence (soft-deleted or no row) means '
  'the role default from role_permissions applies. See BLOCKER-025.';


-- ============================================================
-- SECTION: INDEXES (non-constraint-backed, 243 total as of 2026-09-03 future-cost audit:
-- +3 new FK-usage indexes, -1 duplicate dropped)
-- ============================================================

CREATE INDEX idx_audit_log_actor ON public.audit_log USING btree (actor_id);
CREATE INDEX idx_audit_log_deleted_by ON public.audit_log USING btree (deleted_by) WHERE (deleted_by IS NOT NULL);
-- idx_audit_log_entity dropped 2026-09-03 (future-cost audit) -- byte-for-byte duplicate of
-- idx_audit_log_tenant_entity_time below, pure write/storage cost with zero read benefit.
CREATE INDEX idx_audit_log_tenant_entity_time ON public.audit_log USING btree (tenant_id, entity_type, entity_id, occurred_at DESC);
CREATE INDEX idx_audit_log_tenant_time ON public.audit_log USING btree (tenant_id, occurred_at DESC);
CREATE UNIQUE INDEX branch_assignments_one_default_per_profile ON public.branch_assignments USING btree (tenant_id, profile_id) WHERE is_default;
CREATE INDEX idx_branch_assignments_branch ON public.branch_assignments USING btree (branch_id);
CREATE INDEX idx_branch_assignments_branch_fkey ON public.branch_assignments USING btree (tenant_id, branch_id);
CREATE INDEX idx_branch_assignments_created_by ON public.branch_assignments USING btree (created_by);
CREATE INDEX idx_branch_assignments_deleted_by ON public.branch_assignments USING btree (deleted_by) WHERE (deleted_by IS NOT NULL);
CREATE INDEX idx_branch_assignments_profile ON public.branch_assignments USING btree (profile_id);
CREATE INDEX idx_branch_assignments_tenant ON public.branch_assignments USING btree (tenant_id);
CREATE UNIQUE INDEX branches_one_primary_per_tenant ON public.branches USING btree (tenant_id) WHERE is_primary;
CREATE INDEX idx_branches_created_by ON public.branches USING btree (created_by);
CREATE INDEX idx_branches_deleted_by ON public.branches USING btree (deleted_by) WHERE (deleted_by IS NOT NULL);
CREATE INDEX idx_branches_tenant ON public.branches USING btree (tenant_id);
CREATE UNIQUE INDEX cash_sessions_one_open_per_branch ON public.cash_sessions USING btree (branch_id) WHERE (status = 'open'::text);
CREATE INDEX idx_cash_sessions_branch ON public.cash_sessions USING btree (branch_id);
CREATE INDEX idx_cash_sessions_branch_fkey ON public.cash_sessions USING btree (tenant_id, branch_id);
CREATE INDEX idx_cash_sessions_closed_by ON public.cash_sessions USING btree (closed_by);
CREATE INDEX idx_cash_sessions_created_by ON public.cash_sessions USING btree (created_by);
CREATE INDEX idx_cash_sessions_deleted_by ON public.cash_sessions USING btree (deleted_by) WHERE (deleted_by IS NOT NULL);
CREATE INDEX idx_cash_sessions_opened_by ON public.cash_sessions USING btree (opened_by);
CREATE INDEX idx_cash_sessions_tenant ON public.cash_sessions USING btree (tenant_id);
CREATE INDEX idx_customers_created_by ON public.customers USING btree (created_by);
CREATE INDEX idx_customers_deleted_by ON public.customers USING btree (deleted_by) WHERE (deleted_by IS NOT NULL);
CREATE INDEX idx_customers_tenant ON public.customers USING btree (tenant_id);
CREATE INDEX idx_customers_tenant_name ON public.customers USING btree (tenant_id, lower(full_name));
CREATE INDEX idx_customers_tenant_phone ON public.customers USING btree (tenant_id, phone);
CREATE INDEX idx_daily_audits_branch_date ON public.daily_financial_audits USING btree (branch_id, audit_date DESC);
CREATE INDEX idx_daily_audits_status ON public.daily_financial_audits USING btree (tenant_id, status);
CREATE INDEX idx_daily_financial_audits_cash_session ON public.daily_financial_audits USING btree (cash_session_id);
CREATE INDEX idx_daily_financial_audits_confirmed_by ON public.daily_financial_audits USING btree (confirmed_by);
CREATE INDEX idx_daily_financial_audits_deleted_by ON public.daily_financial_audits USING btree (deleted_by) WHERE (deleted_by IS NOT NULL);
CREATE INDEX idx_daily_financial_audits_device_id ON public.daily_financial_audits USING btree (device_id);
CREATE INDEX idx_daily_financial_audits_submitted_by ON public.daily_financial_audits USING btree (submitted_by);
CREATE INDEX idx_deliveries_board ON public.deliveries USING btree (tenant_id, branch_id, status);
CREATE INDEX idx_deliveries_branch ON public.deliveries USING btree (branch_id);
CREATE INDEX idx_deliveries_created_by ON public.deliveries USING btree (created_by);
CREATE INDEX idx_deliveries_deleted_by ON public.deliveries USING btree (deleted_by) WHERE (deleted_by IS NOT NULL);
CREATE INDEX idx_deliveries_driver ON public.deliveries USING btree (driver_id);
CREATE INDEX idx_deliveries_driver_status_scheduled ON public.deliveries USING btree (tenant_id, driver_id, status, scheduled_at) WHERE ((deleted_at IS NULL) AND (driver_id IS NOT NULL));
CREATE INDEX idx_deliveries_tenant ON public.deliveries USING btree (tenant_id);
CREATE INDEX idx_deliveries_ticket ON public.deliveries USING btree (ticket_id);
CREATE INDEX idx_deliveries_ticket_fkey ON public.deliveries USING btree (tenant_id, ticket_id);
CREATE INDEX idx_document_sequences_deleted_by ON public.document_sequences USING btree (deleted_by) WHERE (deleted_by IS NOT NULL);
CREATE INDEX idx_document_sequences_tenant ON public.document_sequences USING btree (tenant_id);
CREATE UNIQUE INDEX driver_trips_one_active_per_driver ON public.driver_trips USING btree (tenant_id, driver_id) WHERE ((status <> 'completed'::text) AND (deleted_at IS NULL));
CREATE INDEX idx_driver_trips_branch ON public.driver_trips USING btree (tenant_id, branch_id);
CREATE INDEX idx_driver_trips_deleted_by ON public.driver_trips USING btree (deleted_by) WHERE (deleted_by IS NOT NULL);
CREATE INDEX idx_driver_trips_driver_status ON public.driver_trips USING btree (tenant_id, driver_id, status) WHERE (deleted_at IS NULL);
CREATE INDEX idx_driver_trips_settlement_session ON public.driver_trips USING btree (settlement_cash_session_id) WHERE (settlement_cash_session_id IS NOT NULL);
CREATE INDEX idx_driver_trips_tenant ON public.driver_trips USING btree (tenant_id);
CREATE INDEX idx_driver_trips_warehouse ON public.driver_trips USING btree (tenant_id, warehouse_id);
CREATE INDEX idx_expenses_branch ON public.expenses USING btree (branch_id);
CREATE INDEX idx_expenses_cash_session ON public.expenses USING btree (cash_session_id);
CREATE INDEX idx_expenses_cash_session_fkey ON public.expenses USING btree (tenant_id, cash_session_id);
CREATE INDEX idx_expenses_created_by ON public.expenses USING btree (created_by);
CREATE INDEX idx_expenses_deleted_by ON public.expenses USING btree (deleted_by) WHERE (deleted_by IS NOT NULL);
CREATE INDEX idx_expenses_period ON public.expenses USING btree (tenant_id, branch_id, incurred_at DESC);
CREATE INDEX idx_expenses_tenant ON public.expenses USING btree (tenant_id);
CREATE INDEX idx_ingredient_stock_levels_branch ON public.ingredient_stock_levels USING btree (branch_id);
CREATE INDEX idx_ingredient_stock_levels_deleted_by ON public.ingredient_stock_levels USING btree (deleted_by) WHERE (deleted_by IS NOT NULL);
CREATE INDEX idx_ingredient_stock_levels_ingredient ON public.ingredient_stock_levels USING btree (ingredient_id);
CREATE INDEX idx_ingredient_stock_levels_ingredient_fkey ON public.ingredient_stock_levels USING btree (tenant_id, ingredient_id);
CREATE INDEX idx_ingredient_stock_levels_tenant ON public.ingredient_stock_levels USING btree (tenant_id);
CREATE INDEX idx_ingredient_stock_levels_warehouse ON public.ingredient_stock_levels USING btree (warehouse_id);
CREATE INDEX idx_ingredient_stock_levels_warehouse_fkey ON public.ingredient_stock_levels USING btree (tenant_id, branch_id, warehouse_id);
CREATE INDEX idx_ingredients_created_by ON public.ingredients USING btree (created_by);
CREATE INDEX idx_ingredients_deleted_by ON public.ingredients USING btree (deleted_by) WHERE (deleted_by IS NOT NULL);
CREATE INDEX idx_ingredients_tenant ON public.ingredients USING btree (tenant_id);
CREATE UNIQUE INDEX ingredients_tenant_name_key ON public.ingredients USING btree (tenant_id, name) WHERE (deleted_at IS NULL);
CREATE INDEX idx_invoices_branch ON public.invoices USING btree (branch_id);
CREATE INDEX idx_invoices_branch_fkey ON public.invoices USING btree (tenant_id, branch_id);
CREATE INDEX idx_invoices_created_by ON public.invoices USING btree (created_by);
CREATE INDEX idx_invoices_deleted_by ON public.invoices USING btree (deleted_by) WHERE (deleted_by IS NOT NULL);
CREATE INDEX idx_invoices_tenant ON public.invoices USING btree (tenant_id);
CREATE INDEX idx_invoices_ticket ON public.invoices USING btree (ticket_id);
CREATE INDEX idx_invoices_ticket_fkey ON public.invoices USING btree (tenant_id, ticket_id);
CREATE INDEX idx_organization_invites_accepted_by ON public.organization_invites USING btree (accepted_by);
CREATE INDEX idx_organization_invites_branch ON public.organization_invites USING btree (branch_id);
CREATE INDEX idx_organization_invites_branch_fkey ON public.organization_invites USING btree (tenant_id, branch_id);
CREATE INDEX idx_organization_invites_created_by ON public.organization_invites USING btree (created_by);
CREATE INDEX idx_organization_invites_deleted_by ON public.organization_invites USING btree (deleted_by) WHERE (deleted_by IS NOT NULL);
CREATE INDEX idx_organization_invites_email ON public.organization_invites USING btree (tenant_id, lower(email));
CREATE INDEX idx_organization_invites_role ON public.organization_invites USING btree (role_id);
CREATE INDEX idx_organization_invites_tenant ON public.organization_invites USING btree (tenant_id);
CREATE UNIQUE INDEX organization_invites_one_pending_per_email ON public.organization_invites USING btree (tenant_id, lower(email)) WHERE (status = 'pending'::text);
CREATE INDEX idx_organizations_created_by ON public.organizations USING btree (created_by);
CREATE INDEX idx_organizations_deleted_by ON public.organizations USING btree (deleted_by) WHERE (deleted_by IS NOT NULL);
CREATE INDEX idx_payments_branch ON public.payments USING btree (branch_id);
CREATE INDEX idx_payments_branch_fkey ON public.payments USING btree (tenant_id, branch_id);
CREATE INDEX idx_payments_cash_session ON public.payments USING btree (cash_session_id);
CREATE INDEX idx_payments_cash_session_fkey ON public.payments USING btree (tenant_id, cash_session_id);
CREATE INDEX idx_payments_created_by ON public.payments USING btree (created_by);
CREATE INDEX idx_payments_deleted_by ON public.payments USING btree (deleted_by) WHERE (deleted_by IS NOT NULL);
CREATE INDEX idx_payments_driver_trip ON public.payments USING btree (tenant_id, driver_trip_id) WHERE (driver_trip_id IS NOT NULL);
CREATE INDEX idx_payments_invoice ON public.payments USING btree (invoice_id);
CREATE INDEX idx_payments_invoice_fkey ON public.payments USING btree (tenant_id, invoice_id);
CREATE INDEX idx_payments_tenant ON public.payments USING btree (tenant_id);
CREATE INDEX idx_payments_tenant_received_at ON public.payments USING btree (tenant_id, received_at DESC);
CREATE INDEX idx_payments_ticket ON public.payments USING btree (ticket_id);
CREATE INDEX idx_payments_ticket_fkey ON public.payments USING btree (tenant_id, ticket_id);
CREATE INDEX idx_payments_ticket_received_at ON public.payments USING btree (tenant_id, ticket_id, received_at DESC);
CREATE INDEX idx_permanent_deletion_challenges_tenant_id ON public.permanent_deletion_challenges USING btree (tenant_id);
-- Added 2026-09-03 (future-cost audit) -- permanent_deletion_challenges_owner RLS filters
-- requested_by = auth.uid() AND tenant_id = current_tenant_id() directly on this table.
CREATE INDEX permanent_deletion_challenges_tenant_requested_by_idx ON public.permanent_deletion_challenges USING btree (tenant_id, requested_by);
CREATE INDEX idx_product_categories_created_by ON public.product_categories USING btree (created_by);
CREATE INDEX idx_product_categories_deleted_by ON public.product_categories USING btree (deleted_by) WHERE (deleted_by IS NOT NULL);
CREATE INDEX idx_product_categories_tenant ON public.product_categories USING btree (tenant_id);
CREATE UNIQUE INDEX product_categories_tenant_name_key ON public.product_categories USING btree (tenant_id, name) WHERE (deleted_at IS NULL);
CREATE INDEX idx_product_stock_levels_branch ON public.product_stock_levels USING btree (branch_id);
CREATE INDEX idx_product_stock_levels_deleted_by ON public.product_stock_levels USING btree (deleted_by) WHERE (deleted_by IS NOT NULL);
CREATE INDEX idx_product_stock_levels_tenant ON public.product_stock_levels USING btree (tenant_id);
CREATE INDEX idx_product_stock_levels_variant ON public.product_stock_levels USING btree (product_variant_id);
CREATE INDEX idx_product_stock_levels_variant_fkey ON public.product_stock_levels USING btree (tenant_id, product_variant_id);
CREATE INDEX idx_product_stock_levels_warehouse ON public.product_stock_levels USING btree (warehouse_id);
CREATE INDEX idx_product_stock_levels_warehouse_fkey ON public.product_stock_levels USING btree (tenant_id, branch_id, warehouse_id);
CREATE INDEX idx_product_variants_created_by ON public.product_variants USING btree (created_by);
CREATE INDEX idx_product_variants_deleted_by ON public.product_variants USING btree (deleted_by) WHERE (deleted_by IS NOT NULL);
CREATE INDEX idx_product_variants_product ON public.product_variants USING btree (product_id);
CREATE INDEX idx_product_variants_product_fkey ON public.product_variants USING btree (tenant_id, product_id);
CREATE INDEX idx_product_variants_tenant ON public.product_variants USING btree (tenant_id);
CREATE UNIQUE INDEX product_variants_tenant_sku_key ON public.product_variants USING btree (tenant_id, sku) WHERE (deleted_at IS NULL);
CREATE INDEX idx_pbi_batch ON public.production_batch_ingredients USING btree (batch_id);
CREATE INDEX idx_pbi_created_by ON public.production_batch_ingredients USING btree (created_by);
CREATE INDEX idx_pbi_ingredient ON public.production_batch_ingredients USING btree (ingredient_id);
CREATE INDEX idx_pbi_tenant ON public.production_batch_ingredients USING btree (tenant_id);
CREATE INDEX idx_production_batch_ingredients_batch_fkey ON public.production_batch_ingredients USING btree (tenant_id, batch_id);
CREATE INDEX idx_production_batch_ingredients_deleted_by ON public.production_batch_ingredients USING btree (deleted_by) WHERE (deleted_by IS NOT NULL);
CREATE INDEX idx_production_batch_ingredients_ingredient_fkey ON public.production_batch_ingredients USING btree (tenant_id, ingredient_id);
CREATE INDEX idx_production_batches_assigned ON public.production_batches USING btree (assigned_to);
CREATE INDEX idx_production_batches_board ON public.production_batches USING btree (tenant_id, branch_id, status, created_at DESC);
CREATE INDEX idx_production_batches_branch ON public.production_batches USING btree (branch_id);
CREATE INDEX idx_production_batches_created_by ON public.production_batches USING btree (created_by);
CREATE INDEX idx_production_batches_deleted_by ON public.production_batches USING btree (deleted_by) WHERE (deleted_by IS NOT NULL);
CREATE INDEX idx_production_batches_recipe ON public.production_batches USING btree (recipe_id);
CREATE INDEX idx_production_batches_recipe_fkey ON public.production_batches USING btree (tenant_id, recipe_id);
CREATE INDEX idx_production_batches_tenant ON public.production_batches USING btree (tenant_id);
CREATE INDEX idx_production_batches_ticket ON public.production_batches USING btree (ticket_id);
CREATE INDEX idx_production_batches_ticket_fkey ON public.production_batches USING btree (tenant_id, ticket_id);
CREATE INDEX idx_products_category ON public.products USING btree (category_id);
CREATE INDEX idx_products_category_fkey ON public.products USING btree (tenant_id, category_id);
CREATE INDEX idx_products_created_by ON public.products USING btree (created_by);
CREATE INDEX idx_products_deleted_by ON public.products USING btree (deleted_by) WHERE (deleted_by IS NOT NULL);
CREATE INDEX idx_products_tenant ON public.products USING btree (tenant_id);
CREATE INDEX idx_products_tenant_active ON public.products USING btree (tenant_id) WHERE is_active;
CREATE UNIQUE INDEX products_tenant_name_key ON public.products USING btree (tenant_id, name) WHERE (deleted_at IS NULL);
CREATE INDEX idx_profiles_active_tenant ON public.profiles USING btree (active_tenant_id);
CREATE INDEX idx_profiles_deleted_by ON public.profiles USING btree (deleted_by) WHERE (deleted_by IS NOT NULL);
CREATE INDEX idx_profiles_primary_branch ON public.profiles USING btree (primary_branch_id);
CREATE INDEX idx_profiles_tenant ON public.profiles USING btree (tenant_id);
CREATE INDEX rate_limit_events_scope_tenant_occurred_idx ON public.rate_limit_events USING btree (scope, tenant_id, occurred_at DESC);
CREATE INDEX idx_recipe_ingredients_created_by ON public.recipe_ingredients USING btree (created_by);
CREATE INDEX idx_recipe_ingredients_deleted_by ON public.recipe_ingredients USING btree (deleted_by) WHERE (deleted_by IS NOT NULL);
CREATE INDEX idx_recipe_ingredients_ingredient ON public.recipe_ingredients USING btree (ingredient_id);
CREATE INDEX idx_recipe_ingredients_ingredient_fkey ON public.recipe_ingredients USING btree (tenant_id, ingredient_id);
CREATE INDEX idx_recipe_ingredients_recipe ON public.recipe_ingredients USING btree (recipe_id);
CREATE INDEX idx_recipe_ingredients_recipe_fkey ON public.recipe_ingredients USING btree (tenant_id, recipe_id);
CREATE INDEX idx_recipe_ingredients_tenant ON public.recipe_ingredients USING btree (tenant_id);
CREATE INDEX idx_recipes_created_by ON public.recipes USING btree (created_by);
CREATE INDEX idx_recipes_deleted_by ON public.recipes USING btree (deleted_by) WHERE (deleted_by IS NOT NULL);
CREATE INDEX idx_recipes_tenant ON public.recipes USING btree (tenant_id);
CREATE INDEX idx_recipes_variant ON public.recipes USING btree (product_variant_id);
CREATE UNIQUE INDEX recipes_one_active_per_variant ON public.recipes USING btree (tenant_id, product_variant_id) WHERE (is_active AND (deleted_at IS NULL));
CREATE INDEX idx_refunds_branch ON public.refunds USING btree (branch_id);
CREATE INDEX idx_refunds_branch_fkey ON public.refunds USING btree (tenant_id, branch_id);
CREATE INDEX idx_refunds_created_by ON public.refunds USING btree (created_by);
CREATE INDEX idx_refunds_deleted_by ON public.refunds USING btree (deleted_by) WHERE (deleted_by IS NOT NULL);
CREATE INDEX idx_refunds_payment ON public.refunds USING btree (payment_id);
CREATE INDEX idx_refunds_tenant ON public.refunds USING btree (tenant_id);
CREATE INDEX idx_refunds_tenant_created_at ON public.refunds USING btree (tenant_id, refunded_at DESC);
CREATE INDEX idx_role_permissions_permission ON public.role_permissions USING btree (permission_id);
CREATE INDEX idx_roles_deleted_by ON public.roles USING btree (deleted_by) WHERE (deleted_by IS NOT NULL);
CREATE INDEX idx_stock_movements_branch ON public.stock_movements USING btree (branch_id);
CREATE INDEX idx_stock_movements_created_by ON public.stock_movements USING btree (created_by);
CREATE INDEX idx_stock_movements_deleted_by ON public.stock_movements USING btree (deleted_by) WHERE (deleted_by IS NOT NULL);
CREATE INDEX idx_stock_movements_ingredient ON public.stock_movements USING btree (ingredient_id);
CREATE INDEX idx_stock_movements_ingredient_fkey ON public.stock_movements USING btree (tenant_id, ingredient_id);
CREATE INDEX idx_stock_movements_item_created_at ON public.stock_movements USING btree (tenant_id, warehouse_id, item_type, created_at DESC);
CREATE INDEX idx_stock_movements_ledger ON public.stock_movements USING btree (tenant_id, warehouse_id, created_at DESC);
CREATE INDEX idx_stock_movements_reference ON public.stock_movements USING btree (reference_type, reference_id);
CREATE INDEX idx_stock_movements_tenant ON public.stock_movements USING btree (tenant_id);
CREATE INDEX idx_stock_movements_tenant_item_created ON public.stock_movements USING btree (tenant_id, item_type, created_at DESC);
CREATE INDEX idx_stock_movements_variant ON public.stock_movements USING btree (product_variant_id);
CREATE INDEX idx_stock_movements_variant_fkey ON public.stock_movements USING btree (tenant_id, product_variant_id);
CREATE INDEX idx_stock_movements_warehouse ON public.stock_movements USING btree (warehouse_id);
CREATE INDEX idx_stock_movements_warehouse_fkey ON public.stock_movements USING btree (tenant_id, branch_id, warehouse_id);
CREATE INDEX idx_sync_changes_branch_id ON public.sync_changes USING btree (branch_id);
CREATE INDEX idx_sync_changes_changed_by ON public.sync_changes USING btree (changed_by);
CREATE INDEX idx_sync_changes_entity ON public.sync_changes USING btree (entity_type, entity_id, revision);
CREATE INDEX idx_sync_changes_org_branch_sequence ON public.sync_changes USING btree (tenant_id, branch_id, sequence_id);
CREATE INDEX idx_sync_changes_org_sequence ON public.sync_changes USING btree (tenant_id, sequence_id);
CREATE INDEX sync_conflicts_entity_idx ON public.sync_conflicts USING btree (entity_type, entity_id);
CREATE INDEX sync_conflicts_tenant_status_idx ON public.sync_conflicts USING btree (tenant_id, conflict_status);
-- Added 2026-09-03 (future-cost audit) -- sync_conflicts_select's own-actor RLS branch
-- filters actor_id = auth.uid() directly with no other predicate on this table in that
-- branch (the tenant check is in a subquery against user_roles).
CREATE INDEX sync_conflicts_actor_id_idx ON public.sync_conflicts USING btree (actor_id);
CREATE INDEX idx_sync_devices_user_active ON public.sync_devices USING btree (user_id) WHERE (revoked_at IS NULL);
CREATE INDEX idx_sync_devices_user_id ON public.sync_devices USING btree (user_id);
CREATE INDEX idx_sync_operations_actor_id ON public.sync_operations USING btree (actor_id);
CREATE INDEX idx_sync_operations_applied_sequence_id ON public.sync_operations USING btree (applied_sequence_id);
CREATE INDEX idx_sync_operations_branch_id ON public.sync_operations USING btree (branch_id);
CREATE INDEX idx_sync_operations_device_status ON public.sync_operations USING btree (device_id, status, received_at);
CREATE INDEX idx_sync_operations_entity ON public.sync_operations USING btree (entity_type, entity_id, received_at);
CREATE INDEX idx_sync_operations_org_status ON public.sync_operations USING btree (tenant_id, status, received_at);
CREATE INDEX idx_ticket_items_created_by ON public.ticket_items USING btree (created_by);
CREATE INDEX idx_ticket_items_deleted_by ON public.ticket_items USING btree (deleted_by) WHERE (deleted_by IS NOT NULL);
CREATE INDEX idx_ticket_items_tenant ON public.ticket_items USING btree (tenant_id);
CREATE INDEX idx_ticket_items_ticket ON public.ticket_items USING btree (ticket_id);
CREATE INDEX idx_ticket_items_ticket_fkey ON public.ticket_items USING btree (tenant_id, ticket_id);
CREATE INDEX idx_ticket_items_variant ON public.ticket_items USING btree (product_variant_id);
CREATE INDEX idx_ticket_items_variant_fkey ON public.ticket_items USING btree (tenant_id, product_variant_id);
CREATE INDEX idx_tickets_active_not_archived ON public.tickets USING btree (tenant_id, branch_id, created_at DESC) WHERE ((deleted_at IS NULL) AND (archived_at IS NULL));
CREATE INDEX idx_tickets_archived ON public.tickets USING btree (tenant_id, branch_id, archived_at DESC) WHERE (archived_at IS NOT NULL);
CREATE INDEX idx_tickets_assigned_status_due_at ON public.tickets USING btree (tenant_id, assigned_to, status, due_at) WHERE ((deleted_at IS NULL) AND (assigned_to IS NOT NULL));
CREATE INDEX idx_tickets_assigned_to ON public.tickets USING btree (tenant_id, assigned_to) WHERE (deleted_at IS NULL);
CREATE INDEX idx_tickets_board ON public.tickets USING btree (tenant_id, branch_id, created_at DESC);
CREATE INDEX idx_tickets_branch ON public.tickets USING btree (branch_id);
CREATE INDEX idx_tickets_branch_due_at ON public.tickets USING btree (tenant_id, branch_id, due_at) WHERE (deleted_at IS NULL);
CREATE INDEX idx_tickets_correction_of ON public.tickets USING btree (correction_of_ticket_id);
CREATE INDEX idx_tickets_created_by ON public.tickets USING btree (created_by);
CREATE INDEX idx_tickets_customer ON public.tickets USING btree (customer_id);
CREATE INDEX idx_tickets_customer_fkey ON public.tickets USING btree (tenant_id, customer_id);
CREATE INDEX idx_tickets_deleted_by ON public.tickets USING btree (deleted_by) WHERE (deleted_by IS NOT NULL);
CREATE INDEX idx_tickets_driver_trip ON public.tickets USING btree (tenant_id, driver_trip_id) WHERE (driver_trip_id IS NOT NULL);
CREATE INDEX idx_tickets_revision ON public.tickets USING btree (id, revision);
CREATE INDEX idx_tickets_status ON public.tickets USING btree (tenant_id, branch_id, status);
CREATE INDEX idx_tickets_tenant ON public.tickets USING btree (tenant_id);
CREATE INDEX idx_user_roles_branch ON public.user_roles USING btree (branch_id);
CREATE INDEX idx_user_roles_branch_fkey ON public.user_roles USING btree (tenant_id, branch_id);
CREATE INDEX idx_user_roles_created_by ON public.user_roles USING btree (created_by);
CREATE INDEX idx_user_roles_deleted_by ON public.user_roles USING btree (deleted_by) WHERE (deleted_by IS NOT NULL);
CREATE INDEX idx_user_roles_profile ON public.user_roles USING btree (profile_id);
CREATE INDEX idx_user_roles_role ON public.user_roles USING btree (role_id);
CREATE INDEX idx_user_roles_tenant ON public.user_roles USING btree (tenant_id);
CREATE UNIQUE INDEX user_roles_unique_branch_scoped ON public.user_roles USING btree (tenant_id, profile_id, role_id, branch_id) WHERE (branch_id IS NOT NULL);
CREATE UNIQUE INDEX user_roles_unique_org_wide ON public.user_roles USING btree (tenant_id, profile_id, role_id) WHERE (branch_id IS NULL);
CREATE INDEX idx_warehouses_branch ON public.warehouses USING btree (branch_id);
CREATE INDEX idx_warehouses_created_by ON public.warehouses USING btree (created_by);
CREATE INDEX idx_warehouses_deleted_by ON public.warehouses USING btree (deleted_by) WHERE (deleted_by IS NOT NULL);
CREATE INDEX idx_warehouses_tenant ON public.warehouses USING btree (tenant_id);
CREATE UNIQUE INDEX warehouses_one_default_per_branch ON public.warehouses USING btree (tenant_id, branch_id) WHERE is_default;

-- Added 2026-09-02 (migration add_supervisor_permission_overrides / index_user_permission_overrides_permission_fk, BLOCKER-025).
CREATE UNIQUE INDEX user_permission_overrides_active_uq ON public.user_permission_overrides USING btree (tenant_id, profile_id, permission_id) WHERE (deleted_at IS NULL);
CREATE INDEX user_permission_overrides_profile_idx ON public.user_permission_overrides USING btree (tenant_id, profile_id) WHERE (deleted_at IS NULL);
CREATE INDEX user_permission_overrides_permission_id_idx ON public.user_permission_overrides USING btree (permission_id);
-- Added 2026-09-03 (future-cost audit) -- user_permission_overrides_select's own-profile
-- RLS branch filters profile_id = auth.uid() with no tenant_id in that branch; the
-- existing (tenant_id, profile_id) composite index above doesn't help it.
CREATE INDEX user_permission_overrides_profile_id_idx ON public.user_permission_overrides USING btree (profile_id) WHERE (deleted_at IS NULL);


-- ============================================================
-- SECTION: FOREIGN KEYS (173 total, added after all tables exist)
-- ============================================================

ALTER TABLE public.audit_log ADD CONSTRAINT audit_log_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.audit_log ADD CONSTRAINT audit_log_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.audit_log ADD CONSTRAINT audit_log_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE public.branch_assignments ADD CONSTRAINT branch_assignments_branch_fkey FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id) ON DELETE RESTRICT;
ALTER TABLE public.branch_assignments ADD CONSTRAINT branch_assignments_created_by_fkey FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.branch_assignments ADD CONSTRAINT branch_assignments_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.branch_assignments ADD CONSTRAINT branch_assignments_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public.branch_assignments ADD CONSTRAINT branch_assignments_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE public.branches ADD CONSTRAINT branches_created_by_fkey FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.branches ADD CONSTRAINT branches_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.branches ADD CONSTRAINT branches_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE public.cash_sessions ADD CONSTRAINT cash_sessions_branch_fkey FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id) ON DELETE RESTRICT;
ALTER TABLE public.cash_sessions ADD CONSTRAINT cash_sessions_closed_by_fkey FOREIGN KEY (closed_by) REFERENCES profiles(id) ON DELETE RESTRICT;
ALTER TABLE public.cash_sessions ADD CONSTRAINT cash_sessions_created_by_fkey FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.cash_sessions ADD CONSTRAINT cash_sessions_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.cash_sessions ADD CONSTRAINT cash_sessions_opened_by_fkey FOREIGN KEY (opened_by) REFERENCES profiles(id) ON DELETE RESTRICT;
ALTER TABLE public.cash_sessions ADD CONSTRAINT cash_sessions_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE public.customers ADD CONSTRAINT customers_created_by_fkey FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.customers ADD CONSTRAINT customers_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.customers ADD CONSTRAINT customers_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE public.daily_financial_audits ADD CONSTRAINT daily_financial_audits_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE RESTRICT;
ALTER TABLE public.daily_financial_audits ADD CONSTRAINT daily_financial_audits_cash_session_id_fkey FOREIGN KEY (cash_session_id) REFERENCES cash_sessions(id) ON DELETE RESTRICT;
ALTER TABLE public.daily_financial_audits ADD CONSTRAINT daily_financial_audits_confirmed_by_fkey FOREIGN KEY (confirmed_by) REFERENCES auth.users(id) ON DELETE RESTRICT;
ALTER TABLE public.daily_financial_audits ADD CONSTRAINT daily_financial_audits_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES auth.users(id) ON DELETE RESTRICT;
ALTER TABLE public.daily_financial_audits ADD CONSTRAINT daily_financial_audits_device_id_fkey FOREIGN KEY (device_id) REFERENCES sync_devices(id) ON DELETE RESTRICT;
ALTER TABLE public.daily_financial_audits ADD CONSTRAINT daily_financial_audits_organization_id_fkey FOREIGN KEY (tenant_id) REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE public.daily_financial_audits ADD CONSTRAINT daily_financial_audits_submitted_by_fkey FOREIGN KEY (submitted_by) REFERENCES auth.users(id) ON DELETE RESTRICT;
ALTER TABLE public.deliveries ADD CONSTRAINT deliveries_branch_fkey FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id) ON DELETE RESTRICT;
ALTER TABLE public.deliveries ADD CONSTRAINT deliveries_created_by_fkey FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.deliveries ADD CONSTRAINT deliveries_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.deliveries ADD CONSTRAINT deliveries_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.deliveries ADD CONSTRAINT deliveries_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE public.deliveries ADD CONSTRAINT deliveries_ticket_fkey FOREIGN KEY (tenant_id, ticket_id) REFERENCES tickets(tenant_id, id) ON DELETE RESTRICT;
ALTER TABLE public.document_sequences ADD CONSTRAINT document_sequences_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.document_sequences ADD CONSTRAINT document_sequences_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE public.driver_trips ADD CONSTRAINT driver_trips_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES branches(id);
ALTER TABLE public.driver_trips ADD CONSTRAINT driver_trips_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES profiles(id);
ALTER TABLE public.driver_trips ADD CONSTRAINT driver_trips_loading_verified_by_fkey FOREIGN KEY (loading_verified_by) REFERENCES profiles(id);
ALTER TABLE public.driver_trips ADD CONSTRAINT driver_trips_reconciled_by_fkey FOREIGN KEY (reconciled_by) REFERENCES profiles(id);
ALTER TABLE public.driver_trips ADD CONSTRAINT driver_trips_settlement_cash_session_id_fkey FOREIGN KEY (settlement_cash_session_id) REFERENCES cash_sessions(id);
ALTER TABLE public.driver_trips ADD CONSTRAINT driver_trips_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE public.driver_trips ADD CONSTRAINT driver_trips_warehouse_id_fkey FOREIGN KEY (warehouse_id) REFERENCES warehouses(id);
ALTER TABLE public.expenses ADD CONSTRAINT expenses_branch_fkey FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id) ON DELETE RESTRICT;
ALTER TABLE public.expenses ADD CONSTRAINT expenses_cash_session_fkey FOREIGN KEY (tenant_id, cash_session_id) REFERENCES cash_sessions(tenant_id, id) ON DELETE RESTRICT;
ALTER TABLE public.expenses ADD CONSTRAINT expenses_created_by_fkey FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.expenses ADD CONSTRAINT expenses_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.expenses ADD CONSTRAINT expenses_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE public.ingredient_stock_levels ADD CONSTRAINT ingredient_stock_levels_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.ingredient_stock_levels ADD CONSTRAINT ingredient_stock_levels_ingredient_fkey FOREIGN KEY (tenant_id, ingredient_id) REFERENCES ingredients(tenant_id, id) ON DELETE RESTRICT;
ALTER TABLE public.ingredient_stock_levels ADD CONSTRAINT ingredient_stock_levels_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE public.ingredient_stock_levels ADD CONSTRAINT ingredient_stock_levels_warehouse_fkey FOREIGN KEY (tenant_id, branch_id, warehouse_id) REFERENCES warehouses(tenant_id, branch_id, id) ON DELETE RESTRICT;
ALTER TABLE public.ingredients ADD CONSTRAINT ingredients_created_by_fkey FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.ingredients ADD CONSTRAINT ingredients_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.ingredients ADD CONSTRAINT ingredients_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE public.invoices ADD CONSTRAINT invoices_branch_fkey FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id) ON DELETE RESTRICT;
ALTER TABLE public.invoices ADD CONSTRAINT invoices_created_by_fkey FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.invoices ADD CONSTRAINT invoices_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.invoices ADD CONSTRAINT invoices_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE public.invoices ADD CONSTRAINT invoices_ticket_fkey FOREIGN KEY (tenant_id, ticket_id) REFERENCES tickets(tenant_id, id) ON DELETE RESTRICT;
ALTER TABLE public.organization_invites ADD CONSTRAINT organization_invites_accepted_by_fkey FOREIGN KEY (accepted_by) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.organization_invites ADD CONSTRAINT organization_invites_branch_fkey FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id) ON DELETE RESTRICT;
ALTER TABLE public.organization_invites ADD CONSTRAINT organization_invites_created_by_fkey FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.organization_invites ADD CONSTRAINT organization_invites_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.organization_invites ADD CONSTRAINT organization_invites_role_id_fkey FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE RESTRICT;
ALTER TABLE public.organization_invites ADD CONSTRAINT organization_invites_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE public.organizations ADD CONSTRAINT organizations_created_by_fkey FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.organizations ADD CONSTRAINT organizations_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.payments ADD CONSTRAINT payments_branch_fkey FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id) ON DELETE RESTRICT;
ALTER TABLE public.payments ADD CONSTRAINT payments_cash_session_fkey FOREIGN KEY (tenant_id, cash_session_id) REFERENCES cash_sessions(tenant_id, id) ON DELETE RESTRICT;
ALTER TABLE public.payments ADD CONSTRAINT payments_created_by_fkey FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.payments ADD CONSTRAINT payments_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.payments ADD CONSTRAINT payments_driver_trip_id_fkey FOREIGN KEY (driver_trip_id) REFERENCES driver_trips(id);
ALTER TABLE public.payments ADD CONSTRAINT payments_invoice_fkey FOREIGN KEY (tenant_id, invoice_id) REFERENCES invoices(tenant_id, id) ON DELETE RESTRICT;
ALTER TABLE public.payments ADD CONSTRAINT payments_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE public.payments ADD CONSTRAINT payments_ticket_fkey FOREIGN KEY (tenant_id, ticket_id) REFERENCES tickets(tenant_id, id) ON DELETE RESTRICT;
ALTER TABLE public.permanent_deletion_challenges ADD CONSTRAINT permanent_deletion_challenges_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES auth.users(id) ON DELETE RESTRICT;
ALTER TABLE public.permanent_deletion_challenges ADD CONSTRAINT permanent_deletion_challenges_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE public.permissions ADD CONSTRAINT permissions_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES auth.users(id) ON DELETE RESTRICT;
ALTER TABLE public.product_categories ADD CONSTRAINT product_categories_created_by_fkey FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.product_categories ADD CONSTRAINT product_categories_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.product_categories ADD CONSTRAINT product_categories_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE public.product_stock_levels ADD CONSTRAINT product_stock_levels_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.product_stock_levels ADD CONSTRAINT product_stock_levels_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE public.product_stock_levels ADD CONSTRAINT product_stock_levels_variant_fkey FOREIGN KEY (tenant_id, product_variant_id) REFERENCES product_variants(tenant_id, id) ON DELETE RESTRICT;
ALTER TABLE public.product_stock_levels ADD CONSTRAINT product_stock_levels_warehouse_fkey FOREIGN KEY (tenant_id, branch_id, warehouse_id) REFERENCES warehouses(tenant_id, branch_id, id) ON DELETE RESTRICT;
ALTER TABLE public.product_variants ADD CONSTRAINT product_variants_created_by_fkey FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.product_variants ADD CONSTRAINT product_variants_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.product_variants ADD CONSTRAINT product_variants_product_fkey FOREIGN KEY (tenant_id, product_id) REFERENCES products(tenant_id, id) ON DELETE CASCADE;
ALTER TABLE public.product_variants ADD CONSTRAINT product_variants_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE public.production_batch_ingredients ADD CONSTRAINT production_batch_ingredients_batch_fkey FOREIGN KEY (tenant_id, batch_id) REFERENCES production_batches(tenant_id, id) ON DELETE CASCADE;
ALTER TABLE public.production_batch_ingredients ADD CONSTRAINT production_batch_ingredients_created_by_fkey FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.production_batch_ingredients ADD CONSTRAINT production_batch_ingredients_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.production_batch_ingredients ADD CONSTRAINT production_batch_ingredients_ingredient_fkey FOREIGN KEY (tenant_id, ingredient_id) REFERENCES ingredients(tenant_id, id) ON DELETE RESTRICT;
ALTER TABLE public.production_batch_ingredients ADD CONSTRAINT production_batch_ingredients_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE public.production_batches ADD CONSTRAINT production_batches_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.production_batches ADD CONSTRAINT production_batches_branch_fkey FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id) ON DELETE RESTRICT;
ALTER TABLE public.production_batches ADD CONSTRAINT production_batches_created_by_fkey FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.production_batches ADD CONSTRAINT production_batches_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.production_batches ADD CONSTRAINT production_batches_recipe_fkey FOREIGN KEY (tenant_id, recipe_id) REFERENCES recipes(tenant_id, id) ON DELETE RESTRICT;
ALTER TABLE public.production_batches ADD CONSTRAINT production_batches_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE public.production_batches ADD CONSTRAINT production_batches_ticket_fkey FOREIGN KEY (tenant_id, ticket_id) REFERENCES tickets(tenant_id, id) ON DELETE RESTRICT;
ALTER TABLE public.products ADD CONSTRAINT products_category_fkey FOREIGN KEY (tenant_id, category_id) REFERENCES product_categories(tenant_id, id) ON DELETE RESTRICT;
ALTER TABLE public.products ADD CONSTRAINT products_created_by_fkey FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.products ADD CONSTRAINT products_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.products ADD CONSTRAINT products_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_active_tenant_id_fkey FOREIGN KEY (active_tenant_id) REFERENCES organizations(id) ON DELETE SET NULL;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_primary_branch_id_fkey FOREIGN KEY (primary_branch_id) REFERENCES branches(id) ON DELETE SET NULL;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE public.rate_limit_events ADD CONSTRAINT rate_limit_events_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES organizations(id);
ALTER TABLE public.recipe_ingredients ADD CONSTRAINT recipe_ingredients_created_by_fkey FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.recipe_ingredients ADD CONSTRAINT recipe_ingredients_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.recipe_ingredients ADD CONSTRAINT recipe_ingredients_ingredient_fkey FOREIGN KEY (tenant_id, ingredient_id) REFERENCES ingredients(tenant_id, id) ON DELETE RESTRICT;
ALTER TABLE public.recipe_ingredients ADD CONSTRAINT recipe_ingredients_recipe_fkey FOREIGN KEY (tenant_id, recipe_id) REFERENCES recipes(tenant_id, id) ON DELETE CASCADE;
ALTER TABLE public.recipe_ingredients ADD CONSTRAINT recipe_ingredients_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE public.recipes ADD CONSTRAINT recipes_created_by_fkey FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.recipes ADD CONSTRAINT recipes_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.recipes ADD CONSTRAINT recipes_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE public.recipes ADD CONSTRAINT recipes_variant_fkey FOREIGN KEY (tenant_id, product_variant_id) REFERENCES product_variants(tenant_id, id) ON DELETE RESTRICT;
ALTER TABLE public.refunds ADD CONSTRAINT refunds_branch_fkey FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id) ON DELETE RESTRICT;
ALTER TABLE public.refunds ADD CONSTRAINT refunds_created_by_fkey FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.refunds ADD CONSTRAINT refunds_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.refunds ADD CONSTRAINT refunds_payment_fkey FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE RESTRICT;
ALTER TABLE public.refunds ADD CONSTRAINT refunds_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE public.role_permissions ADD CONSTRAINT role_permissions_permission_id_fkey FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE RESTRICT;
ALTER TABLE public.role_permissions ADD CONSTRAINT role_permissions_role_id_fkey FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE RESTRICT;
ALTER TABLE public.roles ADD CONSTRAINT roles_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.stock_movements ADD CONSTRAINT stock_movements_created_by_fkey FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.stock_movements ADD CONSTRAINT stock_movements_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.stock_movements ADD CONSTRAINT stock_movements_ingredient_fkey FOREIGN KEY (tenant_id, ingredient_id) REFERENCES ingredients(tenant_id, id) ON DELETE RESTRICT;
ALTER TABLE public.stock_movements ADD CONSTRAINT stock_movements_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE public.stock_movements ADD CONSTRAINT stock_movements_variant_fkey FOREIGN KEY (tenant_id, product_variant_id) REFERENCES product_variants(tenant_id, id) ON DELETE RESTRICT;
ALTER TABLE public.stock_movements ADD CONSTRAINT stock_movements_warehouse_fkey FOREIGN KEY (tenant_id, branch_id, warehouse_id) REFERENCES warehouses(tenant_id, branch_id, id) ON DELETE RESTRICT;
ALTER TABLE public.sync_changes ADD CONSTRAINT sync_changes_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE RESTRICT;
ALTER TABLE public.sync_changes ADD CONSTRAINT sync_changes_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES auth.users(id) ON DELETE RESTRICT;
ALTER TABLE public.sync_changes ADD CONSTRAINT sync_changes_organization_id_fkey FOREIGN KEY (tenant_id) REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE public.sync_conflicts ADD CONSTRAINT sync_conflicts_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE RESTRICT;
ALTER TABLE public.sync_conflicts ADD CONSTRAINT sync_conflicts_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE RESTRICT;
ALTER TABLE public.sync_conflicts ADD CONSTRAINT sync_conflicts_device_id_fkey FOREIGN KEY (device_id) REFERENCES sync_devices(id) ON DELETE RESTRICT;
ALTER TABLE public.sync_conflicts ADD CONSTRAINT sync_conflicts_operation_id_fkey FOREIGN KEY (operation_id) REFERENCES sync_operations(operation_id) ON DELETE RESTRICT;
ALTER TABLE public.sync_conflicts ADD CONSTRAINT sync_conflicts_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES auth.users(id) ON DELETE RESTRICT;
ALTER TABLE public.sync_conflicts ADD CONSTRAINT sync_conflicts_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE public.sync_devices ADD CONSTRAINT sync_devices_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE RESTRICT;
ALTER TABLE public.sync_operations ADD CONSTRAINT sync_operations_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE RESTRICT;
ALTER TABLE public.sync_operations ADD CONSTRAINT sync_operations_applied_sequence_id_fkey FOREIGN KEY (applied_sequence_id) REFERENCES sync_changes(sequence_id) ON DELETE RESTRICT;
ALTER TABLE public.sync_operations ADD CONSTRAINT sync_operations_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE RESTRICT;
ALTER TABLE public.sync_operations ADD CONSTRAINT sync_operations_device_id_fkey FOREIGN KEY (device_id) REFERENCES sync_devices(id) ON DELETE RESTRICT;
ALTER TABLE public.sync_operations ADD CONSTRAINT sync_operations_organization_id_fkey FOREIGN KEY (tenant_id) REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE public.ticket_items ADD CONSTRAINT ticket_items_created_by_fkey FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.ticket_items ADD CONSTRAINT ticket_items_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.ticket_items ADD CONSTRAINT ticket_items_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE public.ticket_items ADD CONSTRAINT ticket_items_ticket_fkey FOREIGN KEY (tenant_id, ticket_id) REFERENCES tickets(tenant_id, id) ON DELETE CASCADE;
ALTER TABLE public.ticket_items ADD CONSTRAINT ticket_items_variant_fkey FOREIGN KEY (tenant_id, product_variant_id) REFERENCES product_variants(tenant_id, id) ON DELETE RESTRICT;
ALTER TABLE public.tickets ADD CONSTRAINT tickets_archived_by_fkey FOREIGN KEY (archived_by) REFERENCES auth.users(id) ON DELETE RESTRICT;
ALTER TABLE public.tickets ADD CONSTRAINT tickets_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES profiles(id);
ALTER TABLE public.tickets ADD CONSTRAINT tickets_branch_fkey FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id) ON DELETE RESTRICT;
ALTER TABLE public.tickets ADD CONSTRAINT tickets_correction_of_ticket_id_fkey FOREIGN KEY (correction_of_ticket_id) REFERENCES tickets(id) ON DELETE RESTRICT;
ALTER TABLE public.tickets ADD CONSTRAINT tickets_created_by_fkey FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.tickets ADD CONSTRAINT tickets_customer_fkey FOREIGN KEY (tenant_id, customer_id) REFERENCES customers(tenant_id, id) ON DELETE RESTRICT;
ALTER TABLE public.tickets ADD CONSTRAINT tickets_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.tickets ADD CONSTRAINT tickets_driver_trip_id_fkey FOREIGN KEY (driver_trip_id) REFERENCES driver_trips(id);
ALTER TABLE public.tickets ADD CONSTRAINT tickets_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE public.user_roles ADD CONSTRAINT user_roles_branch_fkey FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id) ON DELETE RESTRICT;
ALTER TABLE public.user_roles ADD CONSTRAINT user_roles_created_by_fkey FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.user_roles ADD CONSTRAINT user_roles_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.user_roles ADD CONSTRAINT user_roles_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public.user_roles ADD CONSTRAINT user_roles_role_id_fkey FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE RESTRICT;
ALTER TABLE public.user_roles ADD CONSTRAINT user_roles_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE public.warehouses ADD CONSTRAINT warehouses_branch_fkey FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id) ON DELETE RESTRICT;
ALTER TABLE public.warehouses ADD CONSTRAINT warehouses_created_by_fkey FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.warehouses ADD CONSTRAINT warehouses_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.warehouses ADD CONSTRAINT warehouses_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES organizations(id) ON DELETE RESTRICT;


-- ============================================================
-- SECTION: FUNCTIONS (98 total as of 2026-09-02/BLOCKER-025, ordered by name)
-- ============================================================

CREATE OR REPLACE FUNCTION public.accept_organization_invite(p_raw_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_user    uuid := auth.uid();
  v_invite  public.organization_invites;
  v_profile public.profiles;
  v_org     public.organizations;
  v_role    public.roles;
begin
  if v_user is null then
    raise exception 'authentication required'
      using errcode = 'P0001',
            detail = json_build_object('code', 'insufficient_role')::text;
  end if;

  select * into v_invite
  from public.organization_invites
  where token_hash = encode(extensions.digest(p_raw_token, 'sha256'), 'hex')
  for update;

  if v_invite.id is null then
    raise exception 'invite not found'
      using errcode = 'P0001',
            detail = json_build_object('code', 'invalid_transition', 'reason', 'unknown_token')::text;
  end if;

  if v_invite.status <> 'pending' then
    raise exception 'invite is already %', v_invite.status
      using errcode = 'P0001',
            detail = json_build_object('code', 'invalid_transition', 'status', v_invite.status)::text;
  end if;

  if v_invite.expires_at <= now() then
    update public.organization_invites set status = 'expired' where id = v_invite.id;
    raise exception 'invite has expired'
      using errcode = 'P0001',
            detail = json_build_object('code', 'invalid_transition', 'status', 'expired')::text;
  end if;

  select * into v_profile from public.profiles where id = v_user for update;

  if v_profile.id is null then
    raise exception 'profile not found'
      using errcode = 'P0001',
            detail = json_build_object('code', 'insufficient_role')::text;
  end if;

  -- Membership in another organization is expected and must not block acceptance.
  -- Seed the home organization only on the very first acceptance.
  if v_profile.tenant_id is null then
    update public.profiles
       set tenant_id         = v_invite.tenant_id,
           primary_branch_id = coalesce(primary_branch_id, v_invite.branch_id)
     where id = v_user
    returning * into v_profile;
  end if;

  insert into public.user_roles (tenant_id, profile_id, role_id, branch_id, created_by)
  values (v_invite.tenant_id, v_user, v_invite.role_id, v_invite.branch_id, v_invite.created_by)
  on conflict do nothing;

  if v_invite.branch_id is not null then
    insert into public.branch_assignments (tenant_id, profile_id, branch_id, is_default, created_by)
    values (v_invite.tenant_id, v_user, v_invite.branch_id,
            not exists (select 1 from public.branch_assignments ba
                        where ba.tenant_id = v_invite.tenant_id and ba.profile_id = v_user),
            v_invite.created_by)
    on conflict (tenant_id, profile_id, branch_id) do nothing;
  end if;

  -- Only adopt the invited organization as the active one when the user has none.
  if v_profile.active_tenant_id is null then
    update public.profiles
       set active_tenant_id = v_invite.tenant_id
     where id = v_user
    returning * into v_profile;
  end if;

  update public.organization_invites
     set status = 'accepted', accepted_by = v_user, accepted_at = now()
   where id = v_invite.id
  returning * into v_invite;

  select * into v_org  from public.organizations where id = v_invite.tenant_id;
  select * into v_role from public.roles         where id = v_invite.role_id;

  perform public.log_audit_event(
    v_invite.tenant_id, 'organization_invite', v_invite.id, 'status_change',
    jsonb_build_object('status', 'pending'),
    jsonb_build_object('status', 'accepted', 'accepted_by', v_user));

  return jsonb_build_object(
    'organization',    to_jsonb(v_org),
    'role',            to_jsonb(v_role),
    'profile',         to_jsonb(v_profile),
    'refresh_session', true
  );
end $function$;

CREATE OR REPLACE FUNCTION public.adjust_stock(p_warehouse_id uuid, p_item_type text, p_item_id uuid, p_new_quantity numeric, p_reason text DEFAULT 'adjustment'::text, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_wh public.warehouses;
  v_current numeric(18,4);
  v_delta numeric(18,4);
  v_movement public.stock_movements;
BEGIN
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'authentication required'
      USING errcode = 'P0001', detail = json_build_object('code', 'session_expired')::text;
  END IF;

  -- Ingredient tracking is deactivated for MVP (AD-022): only finished-product stock is
  -- adjustable through this RPC. The 'ingredient' branch below is left intact, not
  -- deleted, so v2 can re-enable it by reverting this one check.
  IF p_item_type <> 'product' THEN
    RAISE EXCEPTION 'invalid item_type: % (ingredient tracking is not available in this version)',p_item_type
      USING errcode = 'P0001', detail = json_build_object('code', 'invalid_request')::text;
  END IF;

  IF p_reason NOT IN ('adjustment','waste','opening_balance') THEN
    RAISE EXCEPTION 'invalid stock adjustment reason'
      USING errcode = 'P0001', detail = json_build_object('code', 'invalid_request')::text;
  END IF;

  IF p_new_quantity < 0 THEN
    RAISE EXCEPTION 'target quantity cannot be negative'
      USING errcode = 'P0001', detail = json_build_object('code', 'invalid_request')::text;
  END IF;

  IF p_reason IN ('adjustment','opening_balance')
     AND NOT public.has_role(ARRAY['owner','admin','branch_manager']) THEN
    RAISE EXCEPTION 'insufficient_role: management approval is required for this stock adjustment'
      USING errcode = 'P0001', detail = json_build_object('code', 'insufficient_role')::text;
  END IF;

  IF p_reason = 'waste'
     AND NOT public.has_role(ARRAY['owner','admin','branch_manager','baker']) THEN
    RAISE EXCEPTION 'insufficient_role: only production staff or management may record waste'
      USING errcode = 'P0001', detail = json_build_object('code', 'insufficient_role')::text;
  END IF;

  SELECT * INTO v_wh
  FROM public.warehouses
  WHERE id=p_warehouse_id AND tenant_id=v_tenant;

  IF v_wh.id IS NULL OR NOT public.has_branch_access(v_wh.branch_id) THEN
    RAISE EXCEPTION 'warehouse not found or branch access denied'
      USING errcode = 'P0001', detail = json_build_object('code', 'insufficient_role')::text;
  END IF;

  IF p_item_type='ingredient' THEN
    SELECT quantity_on_hand INTO v_current
    FROM public.ingredient_stock_levels
    WHERE warehouse_id=p_warehouse_id AND ingredient_id=p_item_id
    FOR UPDATE;
  ELSE
    SELECT quantity_on_hand INTO v_current
    FROM public.product_stock_levels
    WHERE warehouse_id=p_warehouse_id AND product_variant_id=p_item_id
    FOR UPDATE;
  END IF;

  v_current := coalesce(v_current,0);
  v_delta := p_new_quantity-v_current;

  IF v_delta=0 THEN
    RETURN jsonb_build_object('movement',NULL,'quantity_on_hand',v_current,'unchanged',true);
  END IF;

  IF p_reason='waste' AND v_delta>0 THEN
    RAISE EXCEPTION 'an increase cannot be recorded as waste'
      USING errcode = 'P0001', detail = json_build_object('code', 'invalid_request')::text;
  END IF;

  INSERT INTO public.stock_movements(
    tenant_id,branch_id,warehouse_id,item_type,ingredient_id,product_variant_id,
    quantity_delta,reason,reference_type,reference_id,note,created_by
  ) VALUES (
    v_tenant,v_wh.branch_id,p_warehouse_id,p_item_type,
    CASE WHEN p_item_type='ingredient' THEN p_item_id END,
    CASE WHEN p_item_type='product' THEN p_item_id END,
    v_delta,p_reason,'manual',p_warehouse_id,p_note,auth.uid()
  ) RETURNING * INTO v_movement;

  PERFORM public.log_audit_event(
    v_tenant,'stock_movement',v_movement.id,'insert',NULL,
    jsonb_build_object('reason',p_reason,'delta',v_delta,'from',v_current,'to',p_new_quantity)
  );

  RETURN jsonb_build_object(
    'movement',to_jsonb(v_movement),
    'quantity_on_hand',p_new_quantity,
    'previous',v_current
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.apply_customer_create(p_operation sync_operations)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_payload    jsonb := p_operation.payload;
  v_full_name  text  := nullif(btrim(v_payload ->> 'full_name'), '');
  v_phone      text  := nullif(v_payload ->> 'phone', '');
  v_email      text  := nullif(v_payload ->> 'email', '');
  v_address    text  := nullif(v_payload ->> 'address_line', '');
  v_notes      text  := nullif(v_payload ->> 'notes', '');
  v_is_walk_in boolean;
  v_customer   public.customers;
BEGIN
  IF v_full_name IS NULL OR length(v_full_name) > 200 THEN
    RAISE EXCEPTION 'customer.create payload requires full_name (1-200 characters)'
      USING errcode = '22023', detail = json_build_object('code','invalid_request')::text;
  END IF;
  IF v_phone IS NOT NULL AND length(v_phone) > 40 THEN
    RAISE EXCEPTION 'customer.create payload phone must be 40 characters or fewer'
      USING errcode = '22023', detail = json_build_object('code','invalid_request')::text;
  END IF;
  IF v_email IS NOT NULL AND length(v_email) > 320 THEN
    RAISE EXCEPTION 'customer.create payload email must be 320 characters or fewer'
      USING errcode = '22023', detail = json_build_object('code','invalid_request')::text;
  END IF;
  IF v_notes IS NOT NULL AND length(v_notes) > 2000 THEN
    RAISE EXCEPTION 'customer.create payload notes must be 2000 characters or fewer'
      USING errcode = '22023', detail = json_build_object('code','invalid_request')::text;
  END IF;
  IF v_payload ? 'is_walk_in' AND jsonb_typeof(v_payload -> 'is_walk_in') <> 'boolean' THEN
    RAISE EXCEPTION 'customer.create payload is_walk_in must be a boolean'
      USING errcode = '22023', detail = json_build_object('code','invalid_request')::text;
  END IF;
  v_is_walk_in := coalesce((v_payload ->> 'is_walk_in')::boolean, false);

  -- Role eligibility per docs/ROLES-AND-PERMISSIONS.md "Live grants by role" for
  -- customers.create: owner, admin, branch_manager, supervisor, cashier, driver. That doc
  -- states explicitly (point 3 in its "surprising things" list, re: an analogous tickets.create
  -- gap) that the live grants table -- not a hand-maintained RLS array -- "reflects current
  -- intent." customers_insert/customers_update RLS on the raw table predates this and omits
  -- driver/supervisor; see IMPLEMENTATION_LOG.md 2026-08-29 for the full trace. This handler
  -- follows the permissions catalog, matching the apply_ticket_create precedent of using
  -- has_role_in() rather than has_permission() for handler-level authorization.
  IF NOT public.has_role_in(p_operation.actor_id, p_operation.tenant_id,
       ARRAY['owner','admin','branch_manager','supervisor','cashier','driver']) THEN
    RAISE EXCEPTION 'insufficient_role: actor may not create customers in this organization'
      USING errcode = '42501', detail = json_build_object('code','insufficient_role')::text;
  END IF;

  INSERT INTO public.customers (
    tenant_id, full_name, phone, email, address_line, notes, is_walk_in, created_by
  ) VALUES (
    p_operation.tenant_id, v_full_name, v_phone, v_email, v_address, v_notes, v_is_walk_in,
    p_operation.actor_id
  )
  RETURNING * INTO v_customer;

  INSERT INTO public.sync_changes (tenant_id, branch_id, entity_type, entity_id,
    operation_type, domain_operation, revision, changed_by, payload)
  VALUES (v_customer.tenant_id, p_operation.branch_id, 'customers', v_customer.id,
    'CREATE', 'customer.create', 1, p_operation.actor_id, to_jsonb(v_customer));

  RETURN jsonb_build_object('customer_id', v_customer.id, 'full_name', v_customer.full_name,
    'revision', 1);
END; $function$;

CREATE OR REPLACE FUNCTION public.apply_customer_update(p_operation sync_operations)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_payload     jsonb := p_operation.payload;
  v_customer_id uuid  := nullif(v_payload ->> 'customer_id', '')::uuid;
  v_full_name   text  := nullif(btrim(v_payload ->> 'full_name'), '');
  v_phone       text  := nullif(v_payload ->> 'phone', '');
  v_email       text  := nullif(v_payload ->> 'email', '');
  v_address     text  := nullif(v_payload ->> 'address_line', '');
  v_notes       text  := nullif(v_payload ->> 'notes', '');
  v_is_walk_in  boolean;
  v_customer    public.customers;
  v_new_rev     bigint;
BEGIN
  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION 'customer.update payload requires customer_id'
      USING errcode = '22023', detail = json_build_object('code','invalid_request')::text;
  END IF;
  IF v_customer_id IS DISTINCT FROM p_operation.entity_id THEN
    RAISE EXCEPTION 'customer.update payload customer_id must match the operation entity_id'
      USING errcode = '22023', detail = json_build_object('code','invalid_request')::text;
  END IF;
  IF v_full_name IS NULL OR length(v_full_name) > 200 THEN
    RAISE EXCEPTION 'customer.update payload requires full_name (1-200 characters)'
      USING errcode = '22023', detail = json_build_object('code','invalid_request')::text;
  END IF;
  IF v_phone IS NOT NULL AND length(v_phone) > 40 THEN
    RAISE EXCEPTION 'customer.update payload phone must be 40 characters or fewer'
      USING errcode = '22023', detail = json_build_object('code','invalid_request')::text;
  END IF;
  IF v_email IS NOT NULL AND length(v_email) > 320 THEN
    RAISE EXCEPTION 'customer.update payload email must be 320 characters or fewer'
      USING errcode = '22023', detail = json_build_object('code','invalid_request')::text;
  END IF;
  IF v_notes IS NOT NULL AND length(v_notes) > 2000 THEN
    RAISE EXCEPTION 'customer.update payload notes must be 2000 characters or fewer'
      USING errcode = '22023', detail = json_build_object('code','invalid_request')::text;
  END IF;
  IF v_payload ? 'is_walk_in' AND jsonb_typeof(v_payload -> 'is_walk_in') <> 'boolean' THEN
    RAISE EXCEPTION 'customer.update payload is_walk_in must be a boolean'
      USING errcode = '22023', detail = json_build_object('code','invalid_request')::text;
  END IF;
  v_is_walk_in := coalesce((v_payload ->> 'is_walk_in')::boolean, false);

  SELECT * INTO v_customer FROM public.customers
   WHERE id = v_customer_id AND tenant_id = p_operation.tenant_id AND deleted_at IS NULL;
  IF v_customer.id IS NULL THEN
    RAISE EXCEPTION 'customer not found in this organization'
      USING errcode = 'P0001', detail = json_build_object('code','invalid_request')::text;
  END IF;

  -- Role eligibility, per explicit product decision 2026-08-29 (see BLOCKERS.md BLOCKER-024,
  -- resolved): owner, admin, and branch_manager may always edit an existing customer.
  -- supervisor may edit only while the supervisor role itself is held in this tenant --
  -- today that is an all-or-nothing per-bakery toggle already controlled by the branch
  -- manager (docs/ROLES-AND-PERMISSIONS.md), not a per-supervisor grant; a finer,
  -- per-supervisor manager-configurable override was explicitly requested but has no
  -- backing schema anywhere in this codebase yet -- see BLOCKER-025, opened rather than
  -- invented. driver and cashier, which customer.create still grants, are deliberately
  -- EXCLUDED here -- this is narrower than customer.create's role set on purpose.
  IF NOT public.has_role_in(p_operation.actor_id, p_operation.tenant_id,
       ARRAY['owner','admin','branch_manager','supervisor']) THEN
    RAISE EXCEPTION 'insufficient_role: actor may not update customers in this organization'
      USING errcode = '42501', detail = json_build_object('code','insufficient_role')::text;
  END IF;

  -- Full-value replacement, not a field-level merge, per OFFLINE-SYNC-MODEL.md's stated
  -- no-field-level-merge principle -- every mutable column is set from the payload each time.
  UPDATE public.customers
     SET full_name = v_full_name, phone = v_phone, email = v_email,
         address_line = v_address, notes = v_notes, is_walk_in = v_is_walk_in
   WHERE id = v_customer_id
  RETURNING * INTO v_customer;

  SELECT coalesce(max(revision), 0) + 1 INTO v_new_rev
    FROM public.sync_changes WHERE entity_id = v_customer_id;

  INSERT INTO public.sync_changes (tenant_id, branch_id, entity_type, entity_id,
    operation_type, domain_operation, revision, changed_by, payload)
  VALUES (v_customer.tenant_id, p_operation.branch_id, 'customers', v_customer.id,
    'UPDATE', 'customer.update', v_new_rev, p_operation.actor_id, to_jsonb(v_customer));

  RETURN jsonb_build_object('customer_id', v_customer.id, 'full_name', v_customer.full_name,
    'revision', v_new_rev);
END; $function$;

CREATE OR REPLACE FUNCTION public.apply_expense_create(p_operation sync_operations)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_payload    jsonb := p_operation.payload;
  v_category   text := nullif(v_payload ->> 'category', '');
  v_amount     numeric := nullif(v_payload ->> 'amount', '')::numeric;
  v_description text := nullif(v_payload ->> 'description', '');
  v_paid_method text := nullif(v_payload ->> 'paid_method', '');
  v_cash_session_id uuid := nullif(v_payload ->> 'cash_session_id', '')::uuid;
  v_incurred_at timestamptz := nullif(v_payload ->> 'incurred_at', '')::timestamptz;
  v_receipt_url text := nullif(v_payload ->> 'receipt_url', '');
  v_expense    public.expenses;
BEGIN
  IF p_operation.branch_id IS NULL THEN
    RAISE EXCEPTION 'expense.create requires a branch-scoped operation'
      USING errcode = '22023', detail = json_build_object('code','invalid_request')::text;
  END IF;
  IF v_category IS NULL OR v_category NOT IN ('ingredients','rent','utilities','salaries','transport','other') THEN
    RAISE EXCEPTION 'expense.create payload requires a valid category'
      USING errcode = '22023', detail = json_build_object('code','invalid_request')::text;
  END IF;
  IF v_amount IS NULL OR v_amount <= 0 THEN
    RAISE EXCEPTION 'expense.create payload requires amount greater than zero'
      USING errcode = '22023', detail = json_build_object('code','invalid_request')::text;
  END IF;
  IF v_description IS NOT NULL AND length(v_description) > 2000 THEN
    RAISE EXCEPTION 'expense.create payload description must be 2000 characters or fewer'
      USING errcode = '22023', detail = json_build_object('code','invalid_request')::text;
  END IF;
  IF v_paid_method IS NOT NULL AND v_paid_method NOT IN ('cash','card','transfer','pos') THEN
    RAISE EXCEPTION 'expense.create payload paid_method must be cash, card, transfer, or pos'
      USING errcode = '22023', detail = json_build_object('code','invalid_request')::text;
  END IF;
  IF v_paid_method = 'cash' AND v_cash_session_id IS NULL THEN
    RAISE EXCEPTION 'expense.create payload requires cash_session_id for cash expenses'
      USING errcode = '22023', detail = json_build_object('code','invalid_request')::text;
  END IF;
  IF v_paid_method IS DISTINCT FROM 'cash' AND v_cash_session_id IS NOT NULL THEN
    RAISE EXCEPTION 'cash session can only be attached to cash expenses'
      USING errcode = '22023', detail = json_build_object('code','invalid_request')::text;
  END IF;

  IF NOT public.has_role_in(p_operation.actor_id, p_operation.tenant_id,
       ARRAY['owner','admin','branch_manager','cashier','accountant']) THEN
    RAISE EXCEPTION 'insufficient_role: actor may not record expenses in this organization'
      USING errcode = '42501', detail = json_build_object('code','insufficient_role')::text;
  END IF;

  IF v_cash_session_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.cash_sessions
       WHERE id = v_cash_session_id AND tenant_id = p_operation.tenant_id
         AND branch_id = p_operation.branch_id
    ) THEN
      RAISE EXCEPTION 'cash session not found at the operation branch'
        USING errcode = 'P0001', detail = json_build_object('code','invalid_request')::text;
    END IF;
  END IF;

  INSERT INTO public.expenses
    (tenant_id, branch_id, category, amount, description, paid_method, cash_session_id,
     incurred_at, receipt_url, created_by)
  VALUES
    (p_operation.tenant_id, p_operation.branch_id, v_category, v_amount, v_description,
     v_paid_method, v_cash_session_id, coalesce(v_incurred_at, now()), v_receipt_url,
     p_operation.actor_id)
  RETURNING * INTO v_expense;

  INSERT INTO public.sync_changes (tenant_id, branch_id, entity_type, entity_id,
    operation_type, domain_operation, revision, changed_by, payload)
  VALUES (v_expense.tenant_id, v_expense.branch_id, 'expenses', v_expense.id,
    'CREATE', 'expense.create', 1, p_operation.actor_id, to_jsonb(v_expense));

  RETURN jsonb_build_object('expense_id', v_expense.id, 'category', v_expense.category,
    'amount', v_expense.amount, 'revision', 1);
END;
$function$;

CREATE OR REPLACE FUNCTION public.apply_inventory_adjust(p_operation sync_operations)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_payload        jsonb := p_operation.payload;
  v_warehouse_id   uuid  := nullif(v_payload ->> 'warehouse_id', '')::uuid;
  v_item_type      text  := nullif(v_payload ->> 'item_type', '');
  v_item_id        uuid  := nullif(v_payload ->> 'item_id', '')::uuid;
  v_quantity_delta numeric(18,4);
  v_note           text  := nullif(v_payload ->> 'note', '');
  v_warehouse      public.warehouses;
  v_current        numeric(18,4);
  v_new            numeric(18,4);
  v_movement       public.stock_movements;
BEGIN
  IF v_warehouse_id IS NULL THEN
    RAISE EXCEPTION 'inventory.adjust payload requires warehouse_id'
      USING errcode = '22023', detail = json_build_object('code','invalid_request')::text;
  END IF;
  -- Ingredient tracking is deactivated for MVP (AD-022). Left as a value check, not
  -- removed, so v2 can re-enable ingredient support with a one-line revert.
  IF v_item_type IS NULL OR v_item_type <> 'product' THEN
    RAISE EXCEPTION 'inventory.adjust payload item_type must be product (ingredient tracking is not available in this version)'
      USING errcode = '22023', detail = json_build_object('code','invalid_request')::text;
  END IF;
  IF v_item_id IS NULL THEN
    RAISE EXCEPTION 'inventory.adjust payload requires item_id'
      USING errcode = '22023', detail = json_build_object('code','invalid_request')::text;
  END IF;
  IF NOT (v_payload ? 'quantity_delta') THEN
    RAISE EXCEPTION 'inventory.adjust payload requires quantity_delta'
      USING errcode = '22023', detail = json_build_object('code','invalid_request')::text;
  END IF;
  BEGIN
    v_quantity_delta := (v_payload ->> 'quantity_delta')::numeric(18,4);
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'inventory.adjust payload quantity_delta must be numeric'
      USING errcode = '22023', detail = json_build_object('code','invalid_request')::text;
  END;
  IF v_quantity_delta = 0 THEN
    RAISE EXCEPTION 'inventory.adjust payload quantity_delta must not be zero'
      USING errcode = '22023', detail = json_build_object('code','invalid_request')::text;
  END IF;
  IF v_note IS NOT NULL AND length(v_note) > 2000 THEN
    RAISE EXCEPTION 'inventory.adjust payload note must be 2000 characters or fewer'
      USING errcode = '22023', detail = json_build_object('code','invalid_request')::text;
  END IF;

  -- Role eligibility mirrors the live adjust_stock() RPC's own gate for reason='adjustment'
  -- verbatim (owner/admin/branch_manager) -- the existing, human-approved rule for this exact
  -- class of write, not invented for this handler. See IMPLEMENTATION_LOG.md 2026-08-30.
  IF NOT public.has_role_in(p_operation.actor_id, p_operation.tenant_id,
       ARRAY['owner','admin','branch_manager']) THEN
    RAISE EXCEPTION 'insufficient_role: management approval is required for this stock adjustment'
      USING errcode = '42501', detail = json_build_object('code','insufficient_role')::text;
  END IF;

  SELECT * INTO v_warehouse FROM public.warehouses
   WHERE id = v_warehouse_id AND tenant_id = p_operation.tenant_id;
  IF v_warehouse.id IS NULL THEN
    RAISE EXCEPTION 'warehouse not found in this organization'
      USING errcode = 'P0001', detail = json_build_object('code','invalid_request')::text;
  END IF;
  -- The operation's branch was already authorized by the gateway (is_authorized_for_branch,
  -- in process_sync_batch_context_validated); this confirms the payload's own warehouse
  -- actually belongs to that authorized branch, not a different branch the actor also
  -- happens to see -- same consistency-guard shape as apply_customer_update's customer_id
  -- check.
  IF v_warehouse.branch_id IS DISTINCT FROM p_operation.branch_id THEN
    RAISE EXCEPTION 'warehouse does not belong to the operation branch'
      USING errcode = '22023', detail = json_build_object('code','invalid_request')::text;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.product_variants WHERE id = v_item_id AND tenant_id = p_operation.tenant_id) THEN
    RAISE EXCEPTION 'product variant not found in this organization'
      USING errcode = 'P0001', detail = json_build_object('code','invalid_request')::text;
  END IF;
  SELECT quantity_on_hand INTO v_current FROM public.product_stock_levels
   WHERE warehouse_id = v_warehouse_id AND product_variant_id = v_item_id;

  v_current := coalesce(v_current, 0);
  v_new := v_current + v_quantity_delta;

  -- AD-021: inventory operations are append-only; concurrent legitimate adjustments both
  -- apply. Only a server-side rule violation -- resulting negative stock -- is rejected.
  IF v_new < 0 THEN
    RAISE EXCEPTION 'adjustment would leave % on hand, which is negative', v_new
      USING errcode = 'P0001', detail = json_build_object('code','negative_stock_rejected')::text;
  END IF;

  INSERT INTO public.stock_movements (
    tenant_id, branch_id, warehouse_id, item_type, ingredient_id, product_variant_id,
    quantity_delta, reason, reference_type, reference_id, note, created_by
  ) VALUES (
    p_operation.tenant_id, v_warehouse.branch_id, v_warehouse_id, v_item_type,
    NULL,
    v_item_id,
    v_quantity_delta, 'adjustment', 'manual', v_warehouse_id, v_note, p_operation.actor_id
  ) RETURNING * INTO v_movement;

  INSERT INTO public.sync_changes (tenant_id, branch_id, entity_type, entity_id,
    operation_type, domain_operation, revision, changed_by, payload)
  VALUES (v_movement.tenant_id, v_movement.branch_id, 'stock_movements', v_movement.id,
    'EVENT', 'inventory.adjust', 1, p_operation.actor_id, to_jsonb(v_movement));

  RETURN jsonb_build_object('movement_id', v_movement.id, 'quantity_on_hand', v_new,
    'previous', v_current, 'revision', 1);
END; $function$;

CREATE OR REPLACE FUNCTION public.apply_inventory_waste(p_operation sync_operations)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_payload        jsonb := p_operation.payload;
  v_warehouse_id   uuid  := nullif(v_payload ->> 'warehouse_id', '')::uuid;
  v_item_type      text  := nullif(v_payload ->> 'item_type', '');
  v_item_id        uuid  := nullif(v_payload ->> 'item_id', '')::uuid;
  v_quantity_delta numeric(18,4);
  v_note           text  := nullif(v_payload ->> 'note', '');
  v_warehouse      public.warehouses;
  v_current        numeric(18,4);
  v_new            numeric(18,4);
  v_movement       public.stock_movements;
BEGIN
  IF v_warehouse_id IS NULL THEN
    RAISE EXCEPTION 'inventory.waste payload requires warehouse_id'
      USING errcode = '22023', detail = json_build_object('code','invalid_request')::text;
  END IF;
  -- Ingredient tracking is deactivated for MVP (AD-022). Left as a value check, not
  -- removed, so v2 can re-enable ingredient support with a one-line revert.
  IF v_item_type IS NULL OR v_item_type <> 'product' THEN
    RAISE EXCEPTION 'inventory.waste payload item_type must be product (ingredient tracking is not available in this version)'
      USING errcode = '22023', detail = json_build_object('code','invalid_request')::text;
  END IF;
  IF v_item_id IS NULL THEN
    RAISE EXCEPTION 'inventory.waste payload requires item_id'
      USING errcode = '22023', detail = json_build_object('code','invalid_request')::text;
  END IF;
  IF NOT (v_payload ? 'quantity_delta') THEN
    RAISE EXCEPTION 'inventory.waste payload requires quantity_delta'
      USING errcode = '22023', detail = json_build_object('code','invalid_request')::text;
  END IF;
  BEGIN
    v_quantity_delta := (v_payload ->> 'quantity_delta')::numeric(18,4);
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'inventory.waste payload quantity_delta must be numeric'
      USING errcode = '22023', detail = json_build_object('code','invalid_request')::text;
  END;
  IF v_quantity_delta >= 0 THEN
    RAISE EXCEPTION 'inventory.waste payload quantity_delta must be negative'
      USING errcode = '22023', detail = json_build_object('code','invalid_request')::text;
  END IF;
  IF v_note IS NOT NULL AND length(v_note) > 2000 THEN
    RAISE EXCEPTION 'inventory.waste payload note must be 2000 characters or fewer'
      USING errcode = '22023', detail = json_build_object('code','invalid_request')::text;
  END IF;

  -- Role eligibility mirrors the live adjust_stock() RPC's own gate for reason='waste'
  -- verbatim (owner/admin/branch_manager/baker).
  IF NOT public.has_role_in(p_operation.actor_id, p_operation.tenant_id,
       ARRAY['owner','admin','branch_manager','baker']) THEN
    RAISE EXCEPTION 'insufficient_role: only production staff or management may record waste'
      USING errcode = '42501', detail = json_build_object('code','insufficient_role')::text;
  END IF;

  SELECT * INTO v_warehouse FROM public.warehouses
   WHERE id = v_warehouse_id AND tenant_id = p_operation.tenant_id;
  IF v_warehouse.id IS NULL THEN
    RAISE EXCEPTION 'warehouse not found in this organization'
      USING errcode = 'P0001', detail = json_build_object('code','invalid_request')::text;
  END IF;
  IF v_warehouse.branch_id IS DISTINCT FROM p_operation.branch_id THEN
    RAISE EXCEPTION 'warehouse does not belong to the operation branch'
      USING errcode = '22023', detail = json_build_object('code','invalid_request')::text;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.product_variants WHERE id = v_item_id AND tenant_id = p_operation.tenant_id) THEN
    RAISE EXCEPTION 'product variant not found in this organization'
      USING errcode = 'P0001', detail = json_build_object('code','invalid_request')::text;
  END IF;
  SELECT quantity_on_hand INTO v_current FROM public.product_stock_levels
   WHERE warehouse_id = v_warehouse_id AND product_variant_id = v_item_id;

  v_current := coalesce(v_current, 0);
  v_new := v_current + v_quantity_delta;

  IF v_new < 0 THEN
    RAISE EXCEPTION 'waste would leave % on hand, which is negative', v_new
      USING errcode = 'P0001', detail = json_build_object('code','negative_stock_rejected')::text;
  END IF;

  INSERT INTO public.stock_movements (
    tenant_id, branch_id, warehouse_id, item_type, ingredient_id, product_variant_id,
    quantity_delta, reason, reference_type, reference_id, note, created_by
  ) VALUES (
    p_operation.tenant_id, v_warehouse.branch_id, v_warehouse_id, v_item_type,
    NULL,
    v_item_id,
    v_quantity_delta, 'waste', 'manual', v_warehouse_id, v_note, p_operation.actor_id
  ) RETURNING * INTO v_movement;

  INSERT INTO public.sync_changes (tenant_id, branch_id, entity_type, entity_id,
    operation_type, domain_operation, revision, changed_by, payload)
  VALUES (v_movement.tenant_id, v_movement.branch_id, 'stock_movements', v_movement.id,
    'EVENT', 'inventory.waste', 1, p_operation.actor_id, to_jsonb(v_movement));

  RETURN jsonb_build_object('movement_id', v_movement.id, 'quantity_on_hand', v_new,
    'previous', v_current, 'revision', 1);
END; $function$;

CREATE OR REPLACE FUNCTION public.apply_payment_create(p_operation sync_operations)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_payload    jsonb := p_operation.payload;
  v_ticket_id  uuid  := nullif(v_payload ->> 'ticket_id', '')::uuid;
  v_amount     numeric := nullif(v_payload ->> 'amount', '')::numeric;
  v_method     text  := nullif(v_payload ->> 'method', '');
  v_reference  text  := nullif(v_payload ->> 'reference', '');
  v_cash_session_id uuid := nullif(v_payload ->> 'cash_session_id', '')::uuid;
  v_driver_trip_id  uuid := nullif(v_payload ->> 'driver_trip_id', '')::uuid;
  v_order      public.tickets;
  v_session    public.cash_sessions;
  v_trip       public.driver_trips;
  v_invoice    uuid;
  v_payment    public.payments;
BEGIN
  IF v_ticket_id IS NULL THEN
    RAISE EXCEPTION 'payment.create payload requires ticket_id'
      USING errcode = '22023', detail = json_build_object('code','invalid_request')::text;
  END IF;
  IF v_amount IS NULL OR v_amount <= 0 THEN
    RAISE EXCEPTION 'payment.create payload requires amount greater than zero'
      USING errcode = '22023', detail = json_build_object('code','invalid_request')::text;
  END IF;
  IF v_method IS NULL OR v_method NOT IN ('cash','card','transfer','pos') THEN
    RAISE EXCEPTION 'payment.create payload requires a valid method (cash, card, transfer, pos)'
      USING errcode = '22023', detail = json_build_object('code','invalid_request')::text;
  END IF;
  IF v_cash_session_id IS NOT NULL AND v_driver_trip_id IS NOT NULL THEN
    RAISE EXCEPTION 'a payment cannot reference both a till session and a driver trip'
      USING errcode = '22023', detail = json_build_object('code','invalid_request')::text;
  END IF;
  IF v_cash_session_id IS NOT NULL AND v_method <> 'cash' THEN
    RAISE EXCEPTION 'cash session can only be attached to cash payments'
      USING errcode = '22023', detail = json_build_object('code','invalid_request')::text;
  END IF;

  -- Role eligibility mirrors record_payment()'s own actor list verbatim (owner/admin/
  -- branch_manager/cashier/driver) -- there is no financial.payment.* key in the
  -- permissions catalog (docs/ROLES-AND-PERMISSIONS.md only covers financial.expense.*
  -- and financial.audit.*), so the RPC's own has_role() check is the only live rule to
  -- mirror. Tenant-scoped per AD-006 rather than record_payment()'s session-based has_role().
  IF NOT public.has_role_in(p_operation.actor_id, p_operation.tenant_id,
       ARRAY['owner','admin','branch_manager','cashier','driver']) THEN
    RAISE EXCEPTION 'insufficient_role: actor may not record payments in this organization'
      USING errcode = '42501', detail = json_build_object('code','insufficient_role')::text;
  END IF;

  SELECT * INTO v_order FROM public.tickets
   WHERE id = v_ticket_id AND tenant_id = p_operation.tenant_id
   FOR UPDATE;
  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'ticket not found in this organization'
      USING errcode = 'P0001', detail = json_build_object('code','invalid_request')::text;
  END IF;
  IF v_order.branch_id IS DISTINCT FROM p_operation.branch_id THEN
    RAISE EXCEPTION 'ticket does not belong to the operation branch'
      USING errcode = '22023', detail = json_build_object('code','invalid_request')::text;
  END IF;
  IF v_order.status = 'cancelled' THEN
    RAISE EXCEPTION 'invalid_transition: cannot take payment on a cancelled ticket'
      USING errcode = 'P0001', detail = json_build_object('code','invalid_transition')::text;
  END IF;

  IF v_driver_trip_id IS NOT NULL THEN
    SELECT * INTO v_trip FROM public.driver_trips
     WHERE id = v_driver_trip_id AND tenant_id = p_operation.tenant_id
     FOR UPDATE;
    IF v_trip.id IS NULL THEN
      RAISE EXCEPTION 'driver trip not found in this organization'
        USING errcode = 'P0001', detail = json_build_object('code','invalid_request')::text;
    END IF;
    IF v_trip.status <> 'in_transit' THEN
      RAISE EXCEPTION 'invalid_transition: driver trip is not in transit'
        USING errcode = 'P0001', detail = json_build_object('code','invalid_transition','from',v_trip.status)::text;
    END IF;
    IF v_trip.driver_id <> p_operation.actor_id AND NOT public.has_role_in(p_operation.actor_id, p_operation.tenant_id, ARRAY['owner','admin','branch_manager']) THEN
      RAISE EXCEPTION 'insufficient_role: only the trip''s own driver or a manager may record its payments'
        USING errcode = '42501', detail = json_build_object('code','insufficient_role')::text;
    END IF;
    IF v_order.driver_trip_id IS DISTINCT FROM v_driver_trip_id THEN
      RAISE EXCEPTION 'ticket is not linked to this driver trip'
        USING errcode = 'P0001', detail = json_build_object('code','invalid_request')::text;
    END IF;
  ELSIF v_method = 'cash' THEN
    IF v_cash_session_id IS NULL THEN
      SELECT * INTO v_session FROM public.cash_sessions
       WHERE tenant_id = p_operation.tenant_id AND branch_id = v_order.branch_id AND status = 'open'
       FOR UPDATE;
    ELSE
      SELECT * INTO v_session FROM public.cash_sessions
       WHERE id = v_cash_session_id AND tenant_id = p_operation.tenant_id
       FOR UPDATE;
    END IF;
    IF v_session.id IS NULL OR v_session.status <> 'open' THEN
      RAISE EXCEPTION 'cash payments require an open till session at this branch'
        USING errcode = 'P0001', detail = json_build_object('code','invalid_request')::text;
    END IF;
    IF v_session.branch_id IS DISTINCT FROM v_order.branch_id THEN
      RAISE EXCEPTION 'the till session belongs to a different branch'
        USING errcode = 'P0001', detail = json_build_object('code','invalid_request')::text;
    END IF;
  END IF;

  SELECT id INTO v_invoice FROM public.invoices
   WHERE ticket_id = v_ticket_id AND tenant_id = p_operation.tenant_id
   LIMIT 1;

  INSERT INTO public.payments
    (tenant_id, branch_id, ticket_id, invoice_id, cash_session_id, driver_trip_id,
     amount, method, reference, created_by)
  VALUES
    (p_operation.tenant_id, v_order.branch_id, v_ticket_id, v_invoice, v_session.id, v_trip.id,
     v_amount, v_method, v_reference, p_operation.actor_id)
  RETURNING * INTO v_payment;

  INSERT INTO public.sync_changes (tenant_id, branch_id, entity_type, entity_id,
    operation_type, domain_operation, revision, changed_by, payload)
  VALUES (v_payment.tenant_id, v_payment.branch_id, 'payments', v_payment.id,
    'EVENT', 'payment.create', 1, p_operation.actor_id, to_jsonb(v_payment));

  RETURN jsonb_build_object('payment_id', v_payment.id, 'ticket_id', v_payment.ticket_id,
    'amount', v_payment.amount, 'revision', 1);
END;
$function$;

CREATE OR REPLACE FUNCTION public.apply_payment_reverse(p_operation sync_operations)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_payload   jsonb := p_operation.payload;
  v_payment_id uuid := nullif(v_payload ->> 'payment_id', '')::uuid;
  v_amount    numeric := nullif(v_payload ->> 'amount', '')::numeric;
  v_reason    text := nullif(btrim(v_payload ->> 'reason'), '');
  v_payment   public.payments;
  v_refunded  numeric;
  v_refund    public.refunds;
  v_new_rev   bigint;
BEGIN
  IF v_payment_id IS NULL THEN
    RAISE EXCEPTION 'payment.reverse payload requires payment_id'
      USING errcode = '22023', detail = json_build_object('code','invalid_request')::text;
  END IF;
  IF v_amount IS NULL OR v_amount <= 0 THEN
    RAISE EXCEPTION 'payment.reverse payload requires amount greater than zero'
      USING errcode = '22023', detail = json_build_object('code','invalid_request')::text;
  END IF;
  IF v_reason IS NULL OR length(v_reason) > 1000 THEN
    RAISE EXCEPTION 'payment.reverse payload requires reason (1-1000 characters)'
      USING errcode = '22023', detail = json_build_object('code','invalid_request')::text;
  END IF;

  -- Role eligibility mirrors record_refund()'s own actor list verbatim
  -- (owner/admin/branch_manager); tenant-scoped per AD-006.
  IF NOT public.has_role_in(p_operation.actor_id, p_operation.tenant_id,
       ARRAY['owner','admin','branch_manager']) THEN
    RAISE EXCEPTION 'insufficient_role: actor may not reverse payments in this organization'
      USING errcode = '42501', detail = json_build_object('code','insufficient_role')::text;
  END IF;

  SELECT * INTO v_payment FROM public.payments
   WHERE id = v_payment_id AND tenant_id = p_operation.tenant_id
   FOR UPDATE;
  IF v_payment.id IS NULL THEN
    RAISE EXCEPTION 'payment not found in this organization'
      USING errcode = 'P0001', detail = json_build_object('code','invalid_request')::text;
  END IF;
  IF v_payment.branch_id IS DISTINCT FROM p_operation.branch_id THEN
    RAISE EXCEPTION 'payment does not belong to the operation branch'
      USING errcode = '22023', detail = json_build_object('code','invalid_request')::text;
  END IF;

  SELECT coalesce(sum(amount),0) INTO v_refunded FROM public.refunds
   WHERE payment_id = v_payment_id AND tenant_id = p_operation.tenant_id;
  IF v_refunded + v_amount > v_payment.amount THEN
    RAISE EXCEPTION 'invalid_transition: refund of % exceeds the % remaining on this payment',
      v_amount, v_payment.amount - v_refunded
      USING errcode = 'P0001', detail = json_build_object('code','invalid_transition',
        'payment_amount', v_payment.amount, 'already_refunded', v_refunded)::text;
  END IF;

  INSERT INTO public.refunds (tenant_id, branch_id, payment_id, amount, reason, created_by)
  VALUES (p_operation.tenant_id, v_payment.branch_id, v_payment.id, v_amount, v_reason, p_operation.actor_id)
  RETURNING * INTO v_refund;

  SELECT coalesce(max(revision),0)+1 INTO v_new_rev FROM public.sync_changes WHERE entity_id = v_payment.id;

  INSERT INTO public.sync_changes (tenant_id, branch_id, entity_type, entity_id,
    operation_type, domain_operation, revision, changed_by, payload)
  VALUES (v_payment.tenant_id, v_payment.branch_id, 'payments', v_payment.id,
    'EVENT', 'payment.reverse', v_new_rev, p_operation.actor_id, to_jsonb(v_refund));

  RETURN jsonb_build_object('refund_id', v_refund.id, 'payment_id', v_payment.id,
    'amount', v_refund.amount, 'revision', v_new_rev);
END;
$function$;

CREATE OR REPLACE FUNCTION public.apply_payment_to_ticket()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_paid  numeric(19,4);
  v_total numeric(19,4);
  v_inv   uuid;
begin
  if new.ticket_id is null then
    return null;
  end if;

  select coalesce(sum(p.amount), 0) into v_paid
  from public.payments p where p.ticket_id = new.ticket_id;

  update public.tickets set amount_paid = v_paid where id = new.ticket_id
  returning total_amount into v_total;

  -- Invoice status is derived from payments, never set by hand.
  select id into v_inv from public.invoices where ticket_id = new.ticket_id;

  if v_inv is not null then
    update public.invoices
       set status = case
                      when status = 'void'   then 'void'
                      when v_paid <= 0       then 'issued'
                      when v_paid < v_total  then 'partially_paid'
                      else 'paid'
                    end
     where id = v_inv;
  end if;

  return null;
end $function$;

CREATE OR REPLACE FUNCTION public.apply_production_cancel(p_operation sync_operations)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_payload  jsonb := p_operation.payload;
  v_batch_id uuid  := nullif(v_payload ->> 'batch_id', '')::uuid;
  v_batch    public.production_batches;
  v_new_rev  bigint;
BEGIN
  IF v_batch_id IS NULL THEN
    RAISE EXCEPTION 'production.cancel payload requires batch_id'
      USING errcode = '22023', detail = json_build_object('code','invalid_request')::text;
  END IF;

  SELECT * INTO v_batch FROM public.production_batches
   WHERE id = v_batch_id AND tenant_id = p_operation.tenant_id AND deleted_at IS NULL;
  IF v_batch.id IS NULL THEN
    RAISE EXCEPTION 'production batch not found in this organization'
      USING errcode = 'P0001', detail = json_build_object('code','invalid_request')::text;
  END IF;
  IF v_batch.branch_id IS DISTINCT FROM p_operation.branch_id THEN
    RAISE EXCEPTION 'batch does not belong to the operation branch'
      USING errcode = '22023', detail = json_build_object('code','invalid_request')::text;
  END IF;
  IF v_batch.status <> 'scheduled' THEN
    RAISE EXCEPTION 'invalid_transition: batch is %, not scheduled', v_batch.status
      USING errcode = 'P0001', detail = json_build_object('code','invalid_transition','from',v_batch.status,'to','cancelled')::text;
  END IF;

  -- Role eligibility mirrors guard_production_batch_transition()'s own 'cancelled' actors
  -- verbatim (narrower than 'start' -- no baker).
  IF NOT public.has_role_in(p_operation.actor_id, p_operation.tenant_id,
       ARRAY['owner','admin','branch_manager']) THEN
    RAISE EXCEPTION 'insufficient_role: actor may not cancel this production batch'
      USING errcode = '42501', detail = json_build_object('code','insufficient_role')::text;
  END IF;

  UPDATE public.production_batches SET status = 'cancelled'
   WHERE id = v_batch_id AND tenant_id = p_operation.tenant_id
   RETURNING * INTO v_batch;

  SELECT coalesce(max(revision),0)+1 INTO v_new_rev FROM public.sync_changes WHERE entity_id = v_batch_id;

  INSERT INTO public.sync_changes (tenant_id, branch_id, entity_type, entity_id,
    operation_type, domain_operation, revision, changed_by, payload)
  VALUES (v_batch.tenant_id, v_batch.branch_id, 'production_batches', v_batch.id,
    'EVENT', 'production.cancel', v_new_rev, p_operation.actor_id, to_jsonb(v_batch));

  RETURN jsonb_build_object('batch_id', v_batch.id, 'status', v_batch.status, 'revision', v_new_rev);
END; $function$;

CREATE OR REPLACE FUNCTION public.apply_production_record_output(p_operation sync_operations)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_payload      jsonb := p_operation.payload;
  v_batch_id     uuid  := nullif(v_payload ->> 'batch_id', '')::uuid;
  v_actual_qty   numeric(18,4);
  v_ing_actuals  jsonb := coalesce(v_payload -> 'ingredient_actuals', '[]'::jsonb);
  v_warehouse_id uuid  := nullif(v_payload ->> 'warehouse_id', '')::uuid;
  v_batch        public.production_batches;
  v_result       jsonb;
  v_new_rev      bigint;
BEGIN
  IF v_batch_id IS NULL THEN
    RAISE EXCEPTION 'production.record_output payload requires batch_id'
      USING errcode = '22023', detail = json_build_object('code','invalid_request')::text;
  END IF;
  IF NOT (v_payload ? 'actual_quantity') THEN
    RAISE EXCEPTION 'production.record_output payload requires actual_quantity'
      USING errcode = '22023', detail = json_build_object('code','invalid_request')::text;
  END IF;
  BEGIN
    v_actual_qty := (v_payload ->> 'actual_quantity')::numeric(18,4);
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'production.record_output payload actual_quantity must be numeric'
      USING errcode = '22023', detail = json_build_object('code','invalid_request')::text;
  END;

  SELECT * INTO v_batch FROM public.production_batches
   WHERE id = v_batch_id AND tenant_id = p_operation.tenant_id AND deleted_at IS NULL;
  IF v_batch.id IS NULL THEN
    RAISE EXCEPTION 'production batch not found in this organization'
      USING errcode = 'P0001', detail = json_build_object('code','invalid_request')::text;
  END IF;
  IF v_batch.branch_id IS DISTINCT FROM p_operation.branch_id THEN
    RAISE EXCEPTION 'batch does not belong to the operation branch'
      USING errcode = '22023', detail = json_build_object('code','invalid_request')::text;
  END IF;

  IF NOT public.has_role_in(p_operation.actor_id, p_operation.tenant_id,
       ARRAY['owner','admin','branch_manager','baker']) THEN
    RAISE EXCEPTION 'insufficient_role: actor may not complete this production batch'
      USING errcode = '42501', detail = json_build_object('code','insufficient_role')::text;
  END IF;

  v_result := public.complete_production_batch(v_batch_id, v_actual_qty, v_ing_actuals, v_warehouse_id, p_operation.tenant_id);

  SELECT coalesce(max(revision),0)+1 INTO v_new_rev FROM public.sync_changes WHERE entity_id = v_batch_id;

  INSERT INTO public.sync_changes (tenant_id, branch_id, entity_type, entity_id,
    operation_type, domain_operation, revision, changed_by, payload)
  VALUES (v_batch.tenant_id, v_batch.branch_id, 'production_batches', v_batch.id,
    'EVENT', 'production.record_output', v_new_rev, p_operation.actor_id, v_result);

  RETURN jsonb_build_object('batch_id', v_batch.id, 'result', v_result, 'revision', v_new_rev);
END; $function$;

CREATE OR REPLACE FUNCTION public.apply_production_record_waste(p_operation sync_operations)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_payload      jsonb := p_operation.payload;
  v_batch_id     uuid  := nullif(v_payload ->> 'batch_id', '')::uuid;
  v_reason       text  := nullif(v_payload ->> 'reason', '');
  v_ing_actuals  jsonb := coalesce(v_payload -> 'ingredient_actuals', '[]'::jsonb);
  v_warehouse_id uuid  := nullif(v_payload ->> 'warehouse_id', '')::uuid;
  v_batch        public.production_batches;
  v_result       jsonb;
  v_new_rev      bigint;
BEGIN
  IF v_batch_id IS NULL THEN
    RAISE EXCEPTION 'production.record_waste payload requires batch_id'
      USING errcode = '22023', detail = json_build_object('code','invalid_request')::text;
  END IF;
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'production.record_waste payload requires reason'
      USING errcode = '22023', detail = json_build_object('code','invalid_request')::text;
  END IF;

  SELECT * INTO v_batch FROM public.production_batches
   WHERE id = v_batch_id AND tenant_id = p_operation.tenant_id AND deleted_at IS NULL;
  IF v_batch.id IS NULL THEN
    RAISE EXCEPTION 'production batch not found in this organization'
      USING errcode = 'P0001', detail = json_build_object('code','invalid_request')::text;
  END IF;
  IF v_batch.branch_id IS DISTINCT FROM p_operation.branch_id THEN
    RAISE EXCEPTION 'batch does not belong to the operation branch'
      USING errcode = '22023', detail = json_build_object('code','invalid_request')::text;
  END IF;

  IF NOT public.has_role_in(p_operation.actor_id, p_operation.tenant_id,
       ARRAY['owner','admin','branch_manager','baker']) THEN
    RAISE EXCEPTION 'insufficient_role: actor may not fail this production batch'
      USING errcode = '42501', detail = json_build_object('code','insufficient_role')::text;
  END IF;

  v_result := public.fail_production_batch(v_batch_id, v_reason, v_ing_actuals, v_warehouse_id, p_operation.tenant_id);

  SELECT coalesce(max(revision),0)+1 INTO v_new_rev FROM public.sync_changes WHERE entity_id = v_batch_id;

  INSERT INTO public.sync_changes (tenant_id, branch_id, entity_type, entity_id,
    operation_type, domain_operation, revision, changed_by, payload)
  VALUES (v_batch.tenant_id, v_batch.branch_id, 'production_batches', v_batch.id,
    'EVENT', 'production.record_waste', v_new_rev, p_operation.actor_id, v_result);

  RETURN jsonb_build_object('batch_id', v_batch.id, 'result', v_result, 'revision', v_new_rev);
END; $function$;

CREATE OR REPLACE FUNCTION public.apply_production_start(p_operation sync_operations)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_payload  jsonb := p_operation.payload;
  v_batch_id uuid  := nullif(v_payload ->> 'batch_id', '')::uuid;
  v_batch    public.production_batches;
  v_new_rev  bigint;
BEGIN
  IF v_batch_id IS NULL THEN
    RAISE EXCEPTION 'production.start payload requires batch_id'
      USING errcode = '22023', detail = json_build_object('code','invalid_request')::text;
  END IF;

  SELECT * INTO v_batch FROM public.production_batches
   WHERE id = v_batch_id AND tenant_id = p_operation.tenant_id AND deleted_at IS NULL;
  IF v_batch.id IS NULL THEN
    RAISE EXCEPTION 'production batch not found in this organization'
      USING errcode = 'P0001', detail = json_build_object('code','invalid_request')::text;
  END IF;
  -- The operation's branch was already authorized by the gateway (is_authorized_for_branch,
  -- in process_sync_batch_context_validated); this confirms the payload's own batch actually
  -- belongs to that authorized branch, matching the same consistency-guard shape
  -- apply_customer_update/apply_inventory_adjust already use for their own entity checks.
  IF v_batch.branch_id IS DISTINCT FROM p_operation.branch_id THEN
    RAISE EXCEPTION 'batch does not belong to the operation branch'
      USING errcode = '22023', detail = json_build_object('code','invalid_request')::text;
  END IF;
  IF v_batch.status <> 'scheduled' THEN
    RAISE EXCEPTION 'invalid_transition: batch is %, not scheduled', v_batch.status
      USING errcode = 'P0001', detail = json_build_object('code','invalid_transition','from',v_batch.status,'to','in_progress')::text;
  END IF;

  -- Role eligibility mirrors guard_production_batch_transition()'s own 'in_progress' actors
  -- verbatim (owner/admin/branch_manager/baker) -- the existing, human-approved rule, not
  -- invented for this handler. See IMPLEMENTATION_LOG.md 2026-08-30.
  IF NOT public.has_role_in(p_operation.actor_id, p_operation.tenant_id,
       ARRAY['owner','admin','branch_manager','baker']) THEN
    RAISE EXCEPTION 'insufficient_role: actor may not start this production batch'
      USING errcode = '42501', detail = json_build_object('code','insufficient_role')::text;
  END IF;

  UPDATE public.production_batches SET status = 'in_progress'
   WHERE id = v_batch_id AND tenant_id = p_operation.tenant_id
   RETURNING * INTO v_batch;

  SELECT coalesce(max(revision),0)+1 INTO v_new_rev FROM public.sync_changes WHERE entity_id = v_batch_id;

  INSERT INTO public.sync_changes (tenant_id, branch_id, entity_type, entity_id,
    operation_type, domain_operation, revision, changed_by, payload)
  VALUES (v_batch.tenant_id, v_batch.branch_id, 'production_batches', v_batch.id,
    'EVENT', 'production.start', v_new_rev, p_operation.actor_id, to_jsonb(v_batch));

  RETURN jsonb_build_object('batch_id', v_batch.id, 'status', v_batch.status,
    'started_at', v_batch.started_at, 'revision', v_new_rev);
END; $function$;

CREATE OR REPLACE FUNCTION public.apply_stock_movement()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_new_qty      numeric(18,4);
  v_allow_neg    boolean;
  v_item_name    text;
  v_unit         text;
begin
  if new.item_type = 'ingredient' then
    -- ON CONFLICT takes a row lock, so concurrent movements for the same key
    -- serialise and the final level equals the sum of deltas.
    insert into public.ingredient_stock_levels
      (tenant_id, branch_id, warehouse_id, ingredient_id, quantity_on_hand)
    values
      (new.tenant_id, new.branch_id, new.warehouse_id, new.ingredient_id, new.quantity_delta)
    on conflict (warehouse_id, ingredient_id) do update
      set quantity_on_hand = public.ingredient_stock_levels.quantity_on_hand + excluded.quantity_on_hand,
          updated_at       = now()
    returning quantity_on_hand into v_new_qty;
  else
    insert into public.product_stock_levels
      (tenant_id, branch_id, warehouse_id, product_variant_id, quantity_on_hand)
    values
      (new.tenant_id, new.branch_id, new.warehouse_id, new.product_variant_id, new.quantity_delta)
    on conflict (warehouse_id, product_variant_id) do update
      set quantity_on_hand = public.product_stock_levels.quantity_on_hand + excluded.quantity_on_hand,
          updated_at       = now()
    returning quantity_on_hand into v_new_qty;
  end if;

  if v_new_qty < 0 then
    -- Consumption and sales may NEVER drive stock negative, whatever the
    -- tenant setting. STATE-MACHINES.md §2: do not "allow it and reconcile
    -- later" — that breaks Core Principle 3.
    if new.reason in ('production_consume', 'sale') then
      if new.item_type = 'ingredient' then
        select i.name, i.unit_of_measure into v_item_name, v_unit
        from public.ingredients i where i.id = new.ingredient_id;
      else
        select v.name, 'unit' into v_item_name, v_unit
        from public.product_variants v where v.id = new.product_variant_id;
      end if;

      raise exception 'insufficient_stock: % short by % %',
        v_item_name, abs(v_new_qty), v_unit
        using errcode = 'P0001',
              detail  = json_build_object(
                'code',        'insufficient_stock',
                'item_type',   new.item_type,
                'item_id',     coalesce(new.ingredient_id, new.product_variant_id),
                'item_name',   v_item_name,
                'unit',        v_unit,
                'shortfall',   abs(v_new_qty)
              )::text;
    end if;

    -- Waste and adjustments may go negative only where the tenant has opted in.
    select o.allow_negative_stock into v_allow_neg
    from public.organizations o where o.id = new.tenant_id;

    if not coalesce(v_allow_neg, false) then
      raise exception 'insufficient_stock: movement would leave % on hand', v_new_qty
        using errcode = 'P0001',
              detail  = json_build_object(
                'code',      'insufficient_stock',
                'item_type', new.item_type,
                'item_id',   coalesce(new.ingredient_id, new.product_variant_id),
                'shortfall', abs(v_new_qty)
              )::text;
    end if;
  end if;

  -- Keep ingredient costing current from purchases.
  if new.reason = 'purchase' and new.unit_cost is not null and new.item_type = 'ingredient' then
    update public.ingredients
       set last_unit_cost = new.unit_cost
     where id = new.ingredient_id;
  end if;

  return null;  -- AFTER trigger; return value is ignored.
end $function$;

CREATE OR REPLACE FUNCTION public.apply_sync_operation(p_operation_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_op        public.sync_operations;
  v_result    jsonb;
  v_cur_rev   bigint;
BEGIN
  SELECT * INTO v_op FROM public.sync_operations WHERE operation_id = p_operation_id;
  IF v_op.operation_id IS NULL THEN RETURN; END IF;

  IF v_op.status = 'CONFLICT' THEN
    SELECT max(revision) INTO v_cur_rev FROM public.sync_changes WHERE entity_id = v_op.entity_id;
    INSERT INTO public.sync_conflicts (
      tenant_id, branch_id, entity_type, entity_id, operation_id, actor_id, device_id,
      operation_type, operation_payload, base_revision, current_revision, conflict_code
    ) VALUES (
      v_op.tenant_id, v_op.branch_id, v_op.entity_type, v_op.entity_id, v_op.operation_id,
      v_op.actor_id, v_op.device_id, coalesce(v_op.domain_operation, v_op.operation_type),
      v_op.payload, v_op.base_revision, v_cur_rev, coalesce(v_op.error_code, 'stale_revision')
    )
    ON CONFLICT (operation_id) DO NOTHING;
    RETURN;
  END IF;

  IF v_op.status <> 'PENDING' THEN
    RETURN;
  END IF;

  BEGIN
    IF v_op.domain_operation = 'ticket.create' THEN
      v_result := public.apply_ticket_create(v_op);
    ELSIF v_op.domain_operation = 'ticket.item_update' THEN
      v_result := public.apply_ticket_item_update(v_op);
    ELSIF v_op.domain_operation = 'customer.create' THEN
      v_result := public.apply_customer_create(v_op);
    ELSIF v_op.domain_operation = 'customer.update' THEN
      v_result := public.apply_customer_update(v_op);
    ELSIF v_op.domain_operation = 'inventory.adjust' THEN
      v_result := public.apply_inventory_adjust(v_op);
    ELSIF v_op.domain_operation = 'inventory.waste' THEN
      v_result := public.apply_inventory_waste(v_op);
    ELSIF v_op.domain_operation = 'production.start' THEN
      v_result := public.apply_production_start(v_op);
    ELSIF v_op.domain_operation = 'production.cancel' THEN
      v_result := public.apply_production_cancel(v_op);
    ELSIF v_op.domain_operation = 'production.record_output' THEN
      v_result := public.apply_production_record_output(v_op);
    ELSIF v_op.domain_operation = 'production.record_waste' THEN
      v_result := public.apply_production_record_waste(v_op);
    ELSIF v_op.domain_operation = 'payment.create' THEN
      v_result := public.apply_payment_create(v_op);
    ELSIF v_op.domain_operation = 'payment.reverse' THEN
      v_result := public.apply_payment_reverse(v_op);
    ELSIF v_op.domain_operation = 'expense.create' THEN
      v_result := public.apply_expense_create(v_op);
    ELSE
      UPDATE public.sync_operations
         SET status = 'REJECTED', error_code = 'unsupported_operation_type',
             result = jsonb_build_object('message',
               coalesce(v_op.domain_operation, '(none)') || ' has no handler yet')
       WHERE operation_id = p_operation_id;
      RETURN;
    END IF;

    UPDATE public.sync_operations
       SET status = 'APPLIED', result = v_result, applied_at = now(),
           applied_sequence_id = (SELECT sequence_id FROM public.sync_changes
                                    WHERE entity_id = v_op.entity_id
                                    ORDER BY sequence_id DESC LIMIT 1)
     WHERE operation_id = p_operation_id;

  EXCEPTION WHEN OTHERS THEN
    UPDATE public.sync_operations
       SET status = 'REJECTED', error_code = SQLSTATE,
           error_message = SQLERRM, result = '{}'::jsonb
     WHERE operation_id = p_operation_id;
  END;
END;
$function$;

CREATE OR REPLACE FUNCTION public.apply_ticket_create(p_operation sync_operations)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_payload jsonb := p_operation.payload;
  v_customer_id uuid := nullif(v_payload ->> 'customer_id','')::uuid;
  v_fulfilment  text := nullif(v_payload ->> 'fulfilment_type','');
  v_sale_type   text := coalesce(nullif(v_payload ->> 'sale_customer_type',''),
                                  case when v_customer_id is null then 'ROADSIDE' else 'REGISTERED' end);
  v_due_at      timestamptz := nullif(v_payload ->> 'due_at','')::timestamptz;
  v_ticket      public.tickets;
BEGIN
  IF v_fulfilment IS NULL OR v_fulfilment NOT IN ('pickup','delivery') THEN
    RAISE EXCEPTION 'ticket.create payload requires fulfilment_type of pickup or delivery'
      USING errcode = '22023', detail = json_build_object('code','invalid_request')::text;
  END IF;
  IF NOT public.has_role_in(p_operation.actor_id, p_operation.tenant_id,
       ARRAY['owner','admin','branch_manager','cashier','driver']) THEN
    RAISE EXCEPTION 'insufficient_role: actor may not create tickets in this organization'
      USING errcode = '42501', detail = json_build_object('code','insufficient_role')::text;
  END IF;
  INSERT INTO public.tickets (
    tenant_id, branch_id, customer_id, fulfilment_type, due_at,
    sale_customer_type, driver_trip_id, device_created_at, server_received_at
  ) VALUES (
    p_operation.tenant_id, p_operation.branch_id, v_customer_id, v_fulfilment, v_due_at,
    v_sale_type, nullif(v_payload ->> 'driver_trip_id','')::uuid,
    p_operation.device_created_at, now()
  )
  RETURNING * INTO v_ticket;
  INSERT INTO public.sync_changes (tenant_id, branch_id, entity_type, entity_id,
    operation_type, domain_operation, revision, changed_by, payload)
  VALUES (v_ticket.tenant_id, v_ticket.branch_id, 'tickets', v_ticket.id,
    'CREATE', 'ticket.create', v_ticket.revision, p_operation.actor_id, to_jsonb(v_ticket));
  RETURN jsonb_build_object('ticket_id', v_ticket.id, 'ticket_number', v_ticket.ticket_number,
    'revision', v_ticket.revision);
END; $function$;

CREATE OR REPLACE FUNCTION public.apply_ticket_item_update(p_operation sync_operations)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_payload   jsonb := p_operation.payload;
  v_ticket_id uuid  := nullif(v_payload ->> 'ticket_id','')::uuid;
  v_ticket    public.tickets;
  v_item      jsonb;
  v_variant   uuid;
  v_qty       numeric;
  v_price     numeric;
  -- Fixed 2026-09-02 (migration fix_db_lint_warnings_array_literals_and_unused_var,
  -- audit-findings/SECURITY-AUDIT-2026-09-02.md): unambiguous typed empty array, not '{}'.
  v_item_ids  uuid[] := ARRAY[]::uuid[];
  v_new_item  public.ticket_items;
BEGIN
  IF v_ticket_id IS NULL OR jsonb_typeof(v_payload -> 'items') <> 'array'
     OR jsonb_array_length(v_payload -> 'items') = 0 THEN
    RAISE EXCEPTION 'ticket.item_update payload requires ticket_id and a non-empty items array'
      USING errcode = '22023', detail = json_build_object('code','invalid_request')::text;
  END IF;
  SELECT * INTO v_ticket FROM public.tickets
   WHERE id = v_ticket_id AND tenant_id = p_operation.tenant_id AND deleted_at IS NULL;
  IF v_ticket.id IS NULL THEN
    RAISE EXCEPTION 'ticket not found in this organization'
      USING errcode = 'P0001', detail = json_build_object('code','invalid_request')::text;
  END IF;
  IF NOT (
    public.has_role_in(p_operation.actor_id, p_operation.tenant_id, ARRAY['owner','admin','branch_manager','cashier'])
    OR (public.has_role_in(p_operation.actor_id, p_operation.tenant_id, ARRAY['driver'])
        AND (v_ticket.created_by = p_operation.actor_id OR v_ticket.assigned_to = p_operation.actor_id))
  ) THEN
    RAISE EXCEPTION 'insufficient_role: actor may not add items to this ticket'
      USING errcode = '42501', detail = json_build_object('code','insufficient_role')::text;
  END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(v_payload -> 'items') LOOP
    v_variant := nullif(v_item ->> 'product_variant_id','')::uuid;
    v_qty     := nullif(v_item ->> 'quantity','')::numeric;
    IF v_variant IS NULL OR v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'each item requires product_variant_id and a positive quantity'
        USING errcode = '22023', detail = json_build_object('code','invalid_request')::text;
    END IF;
    SELECT pv.unit_price INTO v_price FROM public.product_variants pv
     WHERE pv.id = v_variant AND pv.tenant_id = p_operation.tenant_id;
    IF v_price IS NULL THEN
      RAISE EXCEPTION 'product variant not found in this organization'
        USING errcode = 'P0001', detail = json_build_object('code','invalid_request')::text;
    END IF;
    INSERT INTO public.ticket_items (tenant_id, ticket_id, product_variant_id, quantity, unit_price, created_by)
    VALUES (p_operation.tenant_id, v_ticket_id, v_variant, v_qty, v_price, p_operation.actor_id)
    RETURNING * INTO v_new_item;
    v_item_ids := v_item_ids || v_new_item.id;
  END LOOP;
  SELECT * INTO v_ticket FROM public.tickets WHERE id = v_ticket_id;
  INSERT INTO public.sync_changes (tenant_id, branch_id, entity_type, entity_id,
    operation_type, domain_operation, revision, changed_by, payload)
  VALUES (v_ticket.tenant_id, v_ticket.branch_id, 'tickets', v_ticket.id,
    'UPDATE', 'ticket.item_update', v_ticket.revision, p_operation.actor_id,
    jsonb_build_object('item_ids', to_jsonb(v_item_ids), 'subtotal_amount', v_ticket.subtotal_amount));
  RETURN jsonb_build_object('ticket_id', v_ticket.id, 'item_ids', to_jsonb(v_item_ids),
    'subtotal_amount', v_ticket.subtotal_amount, 'revision', v_ticket.revision);
END; $function$;

-- AD-022-scoped (2026-09-01): 'product'|'product_category'|'product_variant' only, not
-- 'ingredient'/'recipe' — see BLOCKERS.md BLOCKER-010(c) and migration
-- 20260901200000_add_archive_restore_catalog_entity_rpcs.sql for the full rationale.
CREATE OR REPLACE FUNCTION public.archive_catalog_entity(p_entity_type text, p_entity_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant_id uuid;
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required'
      USING errcode='28000', detail = json_build_object('code','session_expired')::text;
  END IF;
  IF NOT public.has_permission('products.manage', NULL) THEN
    RAISE EXCEPTION 'only Owner, Admin, or Branch Manager may archive catalog entities'
      USING errcode='42501', detail = json_build_object('code','insufficient_role')::text;
  END IF;
  IF p_entity_type NOT IN ('product','product_category','product_variant') THEN
    RAISE EXCEPTION 'unsupported entity_type: % (ingredient/recipe entities are not archivable through this RPC)', p_entity_type
      USING errcode='22023', detail = json_build_object('code','invalid_request')::text;
  END IF;

  IF p_entity_type = 'product' THEN
    UPDATE public.products
       SET deleted_at = now(), deleted_by = auth.uid()
     WHERE id = p_entity_id AND tenant_id = public.current_tenant_id() AND deleted_at IS NULL
     RETURNING tenant_id, to_jsonb(products.*) INTO v_tenant_id, v_result;
  ELSIF p_entity_type = 'product_category' THEN
    UPDATE public.product_categories
       SET deleted_at = now(), deleted_by = auth.uid()
     WHERE id = p_entity_id AND tenant_id = public.current_tenant_id() AND deleted_at IS NULL
     RETURNING tenant_id, to_jsonb(product_categories.*) INTO v_tenant_id, v_result;
  ELSIF p_entity_type = 'product_variant' THEN
    UPDATE public.product_variants
       SET deleted_at = now(), deleted_by = auth.uid()
     WHERE id = p_entity_id AND tenant_id = public.current_tenant_id() AND deleted_at IS NULL
     RETURNING tenant_id, (to_jsonb(product_variants.*) || jsonb_build_object('unit_price', unit_price::text))
       INTO v_tenant_id, v_result;
  END IF;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION '% not found or already archived', p_entity_type
      USING errcode='P0001', detail = json_build_object('code','invalid_transition')::text;
  END IF;

  PERFORM public.log_audit_event(
    v_tenant_id, p_entity_type, p_entity_id, 'update',
    jsonb_build_object('deleted_at', null),
    jsonb_build_object('deleted_at', v_result->>'deleted_at', 'deleted_by', v_result->>'deleted_by'));

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.archive_ticket(p_ticket_id uuid, p_reason text)
 RETURNS tickets
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ticket public.tickets;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required'
      USING errcode='28000', detail = json_build_object('code', 'session_expired')::text;
  END IF;
  IF NOT public.has_permission('tickets.archive', NULL) THEN
    RAISE EXCEPTION 'only Manager or Admin may archive tickets'
      USING errcode='42501', detail = json_build_object('code', 'insufficient_role')::text;
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) < 5 THEN
    RAISE EXCEPTION 'archive reason is required'
      USING errcode = 'P0001', detail = json_build_object('code', 'invalid_request')::text;
  END IF;

  UPDATE public.tickets
  SET archived_at=now(), archived_by=auth.uid(), archive_reason=btrim(p_reason), updated_at=now()
  WHERE id=p_ticket_id
    AND tenant_id=public.current_tenant_id()
    AND deleted_at IS NULL
    AND archived_at IS NULL
  RETURNING * INTO v_ticket;

  IF v_ticket.id IS NULL THEN
    RAISE EXCEPTION 'ticket not found or already archived'
      USING errcode = 'P0001', detail = json_build_object('code', 'invalid_transition')::text;
  END IF;

  INSERT INTO public.sync_changes(tenant_id,branch_id,entity_type,entity_id,operation_type,revision,changed_by,payload)
  VALUES(v_ticket.tenant_id,v_ticket.branch_id,'ticket',v_ticket.id,'UPDATE',v_ticket.revision,auth.uid(),jsonb_build_object(
    'archived_at',v_ticket.archived_at,'archived_by',v_ticket.archived_by,'archive_reason',v_ticket.archive_reason
  ));

  PERFORM public.log_audit_event(
    v_ticket.tenant_id, 'ticket', v_ticket.id, 'update',
    jsonb_build_object('archived_at', null),
    jsonb_build_object('archived_at', v_ticket.archived_at, 'archived_by', v_ticket.archived_by,
                        'archive_reason', v_ticket.archive_reason));

  RETURN v_ticket;
END;
$function$;

CREATE OR REPLACE FUNCTION public.assert_schema_invariants()
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_problems text := '';
  r          record;
begin
  for r in select table_name, problem from public.verify_rls_coverage() loop
    v_problems := v_problems || format(E'\n  [RLS] %s: %s', r.table_name, r.problem);
  end loop;

  for r in select table_name, column_name, actual_type from public.verify_money_columns() loop
    v_problems := v_problems || format(E'\n  [MONEY] %s.%s is %s, must be numeric(19,4)',
                                       r.table_name, r.column_name, r.actual_type);
  end loop;

  for r in select table_name, column_name, actual_type from public.verify_quantity_columns() loop
    v_problems := v_problems || format(E'\n  [QUANTITY] %s.%s is %s, must be numeric(18,4)',
                                       r.table_name, r.column_name, r.actual_type);
  end loop;

  for r in select table_name, problem from public.verify_tenant_columns() loop
    v_problems := v_problems || format(E'\n  [TENANT] %s: %s', r.table_name, r.problem);
  end loop;

  if v_problems <> '' then
    raise exception 'schema invariant violations:%', v_problems
      using errcode = 'P0001',
            detail = json_build_object('code', 'schema_invariant_violation')::text;
  end if;
end $function$;

CREATE OR REPLACE FUNCTION public.assign_batch_number()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if coalesce(btrim(new.batch_number), '') = '' then
    new.batch_number := public.next_document_number(new.tenant_id, 'production_batch');
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.assign_order_number()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if coalesce(btrim(new.ticket_number), '') = '' then
    new.ticket_number := public.next_document_number(new.tenant_id, 'ticket');
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.bump_cash_session_revision()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW IS DISTINCT FROM OLD THEN
    NEW.revision := OLD.revision + 1;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.bump_ticket_revision()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW IS DISTINCT FROM OLD THEN
    NEW.revision := OLD.revision + 1;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.cancel_ticket(p_order_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant uuid := public.current_tenant_id();
  v_order  public.tickets;
begin
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'cancellation requires a reason'
      using errcode = 'P0001',
            detail = json_build_object('code', 'invalid_transition',
                                       'reason', 'cancelled_reason_required')::text;
  end if;

  select * into v_order from public.tickets
  where id = p_order_id and tenant_id = v_tenant for update;

  if v_order.id is null then
    raise exception 'order not found'
      using errcode = 'P0001', detail = json_build_object('code', 'invalid_transition')::text;
  end if;

  -- guard_ticket_status_transition() enforces legality, the reason and the
  -- refund requirement; this RPC exists so the client makes one atomic call.
  update public.tickets
     set cancelled_reason = btrim(p_reason), status = 'cancelled'
   where id = p_order_id
  returning * into v_order;

  -- An unpaid invoice is voided along with the order.
  update public.invoices
     set status = 'void'
   where ticket_id = p_order_id
     and status <> 'void'
     and not exists (select 1 from public.payments p where p.ticket_id = p_order_id);

  return jsonb_build_object('ticket', to_jsonb(v_order));
end $function$;

CREATE OR REPLACE FUNCTION public.close_cash_session(p_session_id uuid, p_counted_amount numeric, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant   uuid := public.current_tenant_id();
  v_session  public.cash_sessions;
  v_cash_in  numeric(19,4);
  v_trip_cash numeric(19,4);
  v_cash_out numeric(19,4);
  v_expected numeric(19,4);
  v_variance numeric(19,4);
begin
  if p_counted_amount is null or p_counted_amount < 0 then
    raise exception 'counted amount cannot be negative'
      using errcode = 'P0001', detail = json_build_object('code', 'invalid_transition')::text;
  end if;

  select * into v_session from public.cash_sessions
  where id = p_session_id and tenant_id = v_tenant for update;

  if v_session.id is null then
    raise exception 'till session not found'
      using errcode = 'P0001', detail = json_build_object('code', 'invalid_transition')::text;
  end if;

  if v_session.status <> 'open' then
    raise exception 'invalid_transition: session is already closed'
      using errcode = 'P0001',
            detail = json_build_object('code', 'invalid_transition',
                                       'from', v_session.status, 'to', 'closed')::text;
  end if;

  if auth.uid() is not null
     and v_session.opened_by <> auth.uid()
     and not public.has_role(array['owner', 'admin', 'branch_manager']) then
    raise exception 'insufficient_role: only the opening cashier or a manager may close this till'
      using errcode = 'P0001', detail = json_build_object('code', 'insufficient_role')::text;
  end if;

  -- Expected = opening float + cash taken in (till) + reconciled driver-trip cash
  -- settled against this session (AD-018) − cash paid out. Computed here at close
  -- time, never by the client, and never by rewriting the original trip payments.
  select coalesce(sum(p.amount), 0) into v_cash_in
  from public.payments p
  where p.cash_session_id = p_session_id and p.method = 'cash';

  select coalesce(sum(dt.physical_cash), 0) into v_trip_cash
  from public.driver_trips dt
  where dt.settlement_cash_session_id = p_session_id and dt.status = 'completed';

  select coalesce(sum(e.amount), 0) into v_cash_out
  from public.expenses e
  where e.cash_session_id = p_session_id;

  v_expected := v_session.opening_float + v_cash_in + v_trip_cash - v_cash_out;
  v_variance := p_counted_amount - v_expected;

  -- Variance is recorded, never corrected — but it must be explained.
  if v_variance <> 0 and coalesce(btrim(p_note), '') = '' then
    raise exception 'variance_note_required: the drawer is off by %', v_variance
      using errcode = 'P0001',
            detail = json_build_object('code', 'variance_note_required',
                                       'variance', v_variance,
                                       'expected', v_expected,
                                       'counted', p_counted_amount)::text;
  end if;

  update public.cash_sessions
     set expected_amount = v_expected,
         counted_amount  = p_counted_amount,
         variance_note   = nullif(btrim(coalesce(p_note, '')), ''),
         closed_by       = auth.uid(),
         closed_at       = now(),
         status          = 'closed'
   where id = p_session_id
  returning * into v_session;

  return jsonb_build_object(
    'session',      to_jsonb(v_session),
    'cash_in',      v_cash_in,
    'trip_cash',    v_trip_cash,
    'cash_out',     v_cash_out,
    'expected',     v_expected,
    'variance',     v_variance
  );
end $function$;

CREATE OR REPLACE FUNCTION public.complete_driver_field_sale(p_ticket_id uuid, p_warehouse_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant  uuid := public.current_tenant_id();
  v_ticket  public.tickets;
  v_trip    public.driver_trips;
  v_wh      uuid;
  v_items   int;
  v_invoice public.invoices;
  v_item    record;
  v_moves   jsonb := '[]'::jsonb;
  v_move    public.stock_movements;
BEGIN
  SELECT * INTO v_ticket FROM public.tickets
  WHERE id = p_ticket_id AND tenant_id = v_tenant FOR UPDATE;

  IF v_ticket.id IS NULL THEN
    RAISE EXCEPTION 'ticket not found'
      USING ERRCODE = 'P0001', DETAIL = json_build_object('code', 'invalid_transition')::text;
  END IF;

  IF NOT public.has_branch_access(v_ticket.branch_id) THEN
    RAISE EXCEPTION 'insufficient_role: ticket is outside your branch scope'
      USING ERRCODE = 'P0001', DETAIL = json_build_object('code', 'insufficient_role')::text;
  END IF;

  IF v_ticket.status <> 'draft' THEN
    RAISE EXCEPTION 'invalid_transition: the field-sale shortcut only applies to a draft ticket, this one is %', v_ticket.status
      USING ERRCODE = 'P0001',
            DETAIL = json_build_object('code', 'invalid_transition', 'from', v_ticket.status, 'to', 'completed')::text;
  END IF;

  IF v_ticket.driver_trip_id IS NULL THEN
    RAISE EXCEPTION 'invalid_request: ticket is not linked to a driver trip'
      USING ERRCODE = 'P0001', DETAIL = json_build_object('code', 'invalid_request')::text;
  END IF;

  -- Preserves AD-019: deliveries stays the sole proof-of-delivery authority. A
  -- delivery-fulfilment ticket must still walk the normal ready -> delivered gate.
  IF v_ticket.fulfilment_type <> 'pickup' THEN
    RAISE EXCEPTION 'invalid_request: the field-sale shortcut is pickup-only; this ticket is fulfilment_type=%', v_ticket.fulfilment_type
      USING ERRCODE = 'P0001', DETAIL = json_build_object('code', 'invalid_request')::text;
  END IF;

  SELECT * INTO v_trip FROM public.driver_trips
  WHERE id = v_ticket.driver_trip_id AND tenant_id = v_tenant FOR UPDATE;

  IF v_trip.id IS NULL THEN
    RAISE EXCEPTION 'driver trip not found'
      USING ERRCODE = 'P0001', DETAIL = json_build_object('code', 'invalid_request')::text;
  END IF;

  IF v_trip.status <> 'in_transit' THEN
    RAISE EXCEPTION 'invalid_transition: driver trip is not in transit'
      USING ERRCODE = 'P0001',
            DETAIL = json_build_object('code', 'invalid_transition', 'from', v_trip.status)::text;
  END IF;

  -- Identity check beyond the trigger's generic role check, same two-layer pattern
  -- record_payment() already uses: holding 'driver' isn't enough, this must be the
  -- trip's own driver, unless the caller is a manager. guard_ticket_driver_trip_assignment()
  -- already guarantees trip.driver_id equals this ticket's created_by (Path B) or
  -- assigned_to (Path A) at link time, so this single check covers both paths.
  IF v_trip.driver_id <> auth.uid() AND NOT public.has_role(ARRAY['owner','admin','branch_manager']) THEN
    RAISE EXCEPTION 'insufficient_role: only the trip''s own driver or a manager may complete its field sales'
      USING ERRCODE = 'P0001', DETAIL = json_build_object('code', 'insufficient_role')::text;
  END IF;

  SELECT count(*) INTO v_items FROM public.ticket_items WHERE ticket_id = p_ticket_id;
  IF v_items = 0 THEN
    RAISE EXCEPTION 'a ticket needs at least one item before it can be completed'
      USING ERRCODE = 'P0001',
            DETAIL = json_build_object('code', 'invalid_transition', 'reason', 'no_items')::text;
  END IF;

  -- Recompute rather than trust: totals are the basis of the invoice. Same mechanism
  -- confirm_ticket() uses -- a separate UPDATE, since subtotal_amount is unfrozen while
  -- still 'draft'.
  UPDATE public.tickets
     SET subtotal_amount = COALESCE(
           (SELECT SUM(oi.line_total) FROM public.ticket_items oi WHERE oi.ticket_id = p_ticket_id), 0)
   WHERE id = p_ticket_id;

  -- Marks this transaction as an authorized RPC-driven completion, so the trigger above
  -- lets draft -> completed through. Transaction-scoped: never leaks to a later,
  -- unrelated request. Same technique BLOCKER-017 established for production_batches.
  PERFORM set_config('bakeflow.driver_field_sale_rpc', 'true', true);

  UPDATE public.tickets SET status = 'completed'
   WHERE id = p_ticket_id
  RETURNING * INTO v_ticket;

  -- Invoice: same insert-or-refresh-total shape as confirm_ticket().
  INSERT INTO public.invoices
    (tenant_id, branch_id, ticket_id, invoice_number, total_amount, due_at, created_by)
  VALUES
    (v_tenant, v_ticket.branch_id, v_ticket.id,
     public.next_document_number(v_tenant, 'invoice'),
     v_ticket.total_amount, v_ticket.due_at, auth.uid())
  ON CONFLICT (ticket_id) DO UPDATE SET total_amount = excluded.total_amount
  RETURNING * INTO v_invoice;

  -- One sale movement per line, out of the TRIP's own warehouse (the vehicle) by
  -- default -- not the branch's default warehouse as complete_ticket() would use. The
  -- goods being sold here were already moved into the vehicle's custody by
  -- verify_trip_loading(); deducting from the branch shelf instead would corrupt both
  -- warehouses' stock levels. apply_stock_movement() still refuses to go negative, so an
  -- oversold ticket rolls the whole completion back.
  --
  -- p_warehouse_id, when supplied, must belong to this same tenant and to the ticket's own
  -- branch -- otherwise a caller could redirect the sale movement onto another tenant's
  -- warehouse, corrupting that tenant's actual stock levels (ingredient_stock_levels/
  -- product_stock_levels are keyed by warehouse_id+item only, not tenant_id -- the
  -- stock_movements_guard_warehouse_tenant trigger is the backstop, this is the specific,
  -- friendly rejection before it).
  IF p_warehouse_id IS NOT NULL THEN
    SELECT id INTO v_wh FROM public.warehouses
    WHERE id = p_warehouse_id AND tenant_id = v_tenant AND branch_id = v_ticket.branch_id;

    IF v_wh IS NULL THEN
      RAISE EXCEPTION 'warehouse not found at this branch'
        USING ERRCODE = 'P0001', DETAIL = json_build_object('code', 'invalid_request')::text;
    END IF;
  ELSE
    v_wh := v_trip.warehouse_id;
  END IF;

  FOR v_item IN
    SELECT product_variant_id, SUM(quantity) AS qty
    FROM public.ticket_items WHERE ticket_id = p_ticket_id
    GROUP BY product_variant_id
  LOOP
    INSERT INTO public.stock_movements
      (tenant_id, branch_id, warehouse_id, item_type, product_variant_id,
       quantity_delta, reason, reference_type, reference_id, created_by)
    VALUES
      (v_tenant, v_ticket.branch_id, v_wh, 'product', v_item.product_variant_id,
       -v_item.qty, 'sale', 'order', p_ticket_id, auth.uid())
    RETURNING * INTO v_move;

    v_moves := v_moves || to_jsonb(v_move);
  END LOOP;

  RETURN jsonb_build_object('ticket', to_jsonb(v_ticket), 'invoice', to_jsonb(v_invoice), 'movements', v_moves);
END;
$function$;

CREATE OR REPLACE FUNCTION public.complete_driver_trip(p_trip_id uuid, p_settlement_cash_session_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant uuid := public.current_tenant_id();
  v_trip public.driver_trips;
  v_session public.cash_sessions;
begin
  if not public.has_role(array['owner','admin','branch_manager']) then
    raise exception 'insufficient_role: completing a trip requires management'
      using errcode = 'P0001', detail = json_build_object('code', 'insufficient_role')::text;
  end if;

  select * into v_trip from public.driver_trips
  where id = p_trip_id and tenant_id = v_tenant for update;

  if v_trip.id is null then
    raise exception 'trip not found'
      using errcode = 'P0001', detail = json_build_object('code', 'invalid_transition')::text;
  end if;

  if not public.has_branch_access(v_trip.branch_id) then
    raise exception 'insufficient_role: trip is outside your branch scope'
      using errcode = 'P0001', detail = json_build_object('code', 'insufficient_role')::text;
  end if;

  if v_trip.status <> 'reconciled' then
    raise exception 'invalid_transition: trip has not been reconciled yet'
      using errcode = 'P0001',
            detail = json_build_object('code', 'invalid_transition', 'from', v_trip.status)::text;
  end if;

  select * into v_session from public.cash_sessions
  where id = p_settlement_cash_session_id and tenant_id = v_tenant;

  if v_session.id is null or v_session.status <> 'open' then
    raise exception 'settlement requires an open till session'
      using errcode = 'P0001', detail = json_build_object('code', 'invalid_transition')::text;
  end if;

  if v_session.branch_id <> v_trip.branch_id then
    raise exception 'the till session belongs to a different branch'
      using errcode = 'P0001', detail = json_build_object('code', 'invalid_request')::text;
  end if;

  update public.driver_trips
     set status = 'completed', settlement_cash_session_id = p_settlement_cash_session_id
   where id = p_trip_id
  returning * into v_trip;

  return jsonb_build_object('trip', to_jsonb(v_trip));
end
$function$;

CREATE OR REPLACE FUNCTION public.complete_production_batch(p_batch_id uuid, p_actual_quantity numeric, p_ingredient_actuals jsonb DEFAULT '[]'::jsonb, p_warehouse_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant  uuid := public.current_tenant_id();
  v_batch   public.production_batches;
  v_variant uuid;
  v_wh      uuid := p_warehouse_id;
  v_row     record;
  v_actual  numeric(18,4);
  v_waste   numeric(18,4);
  v_moves   jsonb := '[]'::jsonb;
  v_move    public.stock_movements;
begin
  if p_actual_quantity is null or p_actual_quantity <= 0 then
    raise exception 'actual_quantity must be greater than zero'
      using errcode = 'P0001', detail = json_build_object('code', 'invalid_transition')::text;
  end if;

  select * into v_batch from public.production_batches
  where id = p_batch_id and tenant_id = v_tenant for update;

  if v_batch.id is null then
    raise exception 'batch not found'
      using errcode = 'P0001', detail = json_build_object('code', 'invalid_transition')::text;
  end if;

  if v_batch.status <> 'in_progress' then
    raise exception 'invalid_transition: batch is %', v_batch.status
      using errcode = 'P0001',
            detail = json_build_object('code', 'invalid_transition',
                                       'from', v_batch.status, 'to', 'completed')::text;
  end if;

  select r.product_variant_id into v_variant
  from public.recipes r where r.id = v_batch.recipe_id;

  -- p_warehouse_id, when supplied, must belong to this same tenant and to the batch's own
  -- branch -- otherwise a caller could redirect the consume/output movements onto another
  -- tenant's warehouse, corrupting that tenant's actual stock levels
  -- (ingredient_stock_levels/product_stock_levels are keyed by warehouse_id+item only, not
  -- tenant_id -- the stock_movements_guard_warehouse_tenant trigger is the backstop, this
  -- is the specific, friendly rejection before it).
  if v_wh is not null then
    perform 1 from public.warehouses
    where id = v_wh and tenant_id = v_tenant and branch_id = v_batch.branch_id;

    if not found then
      raise exception 'warehouse not found at this branch'
        using errcode = 'P0001', detail = json_build_object('code', 'invalid_transition')::text;
    end if;
  else
    select id into v_wh from public.warehouses
    where tenant_id = v_tenant and branch_id = v_batch.branch_id and is_default limit 1;
  end if;
  if v_wh is null then
    raise exception 'no default warehouse for this branch; pass a warehouse explicitly'
      using errcode = 'P0001', detail = json_build_object('code', 'invalid_transition')::text;
  end if;

  -- Record actuals supplied by the baker, defaulting to the planned amounts.
  for v_row in
    select pbi.id, pbi.ingredient_id, pbi.planned_quantity
    from public.production_batch_ingredients pbi
    where pbi.batch_id = p_batch_id
  loop
    select coalesce((a ->> 'actual_quantity')::numeric, v_row.planned_quantity),
           coalesce((a ->> 'waste_quantity')::numeric, 0)
      into v_actual, v_waste
    from jsonb_array_elements(coalesce(p_ingredient_actuals, '[]'::jsonb)) a
    where (a ->> 'ingredient_id')::uuid = v_row.ingredient_id;

    v_actual := coalesce(v_actual, v_row.planned_quantity);
    v_waste  := coalesce(v_waste, 0);

    update public.production_batch_ingredients
       set actual_quantity = v_actual, waste_quantity = v_waste
     where id = v_row.id;

    if v_actual > 0 then
      -- apply_stock_movement() raises insufficient_stock if this would go
      -- negative, which rolls back the entire completion.
      insert into public.stock_movements
        (tenant_id, branch_id, warehouse_id, item_type, ingredient_id,
         quantity_delta, reason, reference_type, reference_id, created_by)
      values
        (v_tenant, v_batch.branch_id, v_wh, 'ingredient', v_row.ingredient_id,
         -v_actual, 'production_consume', 'production_batch', p_batch_id, auth.uid())
      returning * into v_move;

      v_moves := v_moves || to_jsonb(v_move);
    end if;
  end loop;

  -- One output movement for the finished product.
  insert into public.stock_movements
    (tenant_id, branch_id, warehouse_id, item_type, product_variant_id,
     quantity_delta, reason, reference_type, reference_id, created_by)
  values
    (v_tenant, v_batch.branch_id, v_wh, 'product', v_variant,
     p_actual_quantity, 'production_output', 'production_batch', p_batch_id, auth.uid())
  returning * into v_move;

  v_moves := v_moves || to_jsonb(v_move);

  -- Marks this transaction as an authorized RPC-driven completion, so the trigger above
  -- lets the status flip to 'completed' through. Transaction-scoped: never leaks to a
  -- later, unrelated request.
  perform set_config('bakeflow.production_batch_rpc', 'true', true);

  update public.production_batches
     set actual_quantity = p_actual_quantity,
         completed_at    = now(),
         status          = 'completed'
   where id = p_batch_id
  returning * into v_batch;

  return jsonb_build_object('batch', to_jsonb(v_batch), 'movements', v_moves);
end $function$;

CREATE OR REPLACE FUNCTION public.complete_production_batch(p_batch_id uuid, p_actual_quantity numeric, p_ingredient_actuals jsonb DEFAULT '[]'::jsonb, p_warehouse_id uuid DEFAULT NULL::uuid, p_tenant_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant  uuid := coalesce(p_tenant_id, public.current_tenant_id());
  v_batch   public.production_batches;
  v_variant uuid;
  v_wh      uuid := p_warehouse_id;
  v_row     record;
  v_actual  numeric(18,4);
  v_waste   numeric(18,4);
  v_moves   jsonb := '[]'::jsonb;
  v_move    public.stock_movements;
begin
  if p_actual_quantity is null or p_actual_quantity <= 0 then
    raise exception 'actual_quantity must be greater than zero'
      using errcode = 'P0001', detail = json_build_object('code', 'invalid_transition')::text;
  end if;
  select * into v_batch from public.production_batches
  where id = p_batch_id and tenant_id = v_tenant for update;
  if v_batch.id is null then
    raise exception 'batch not found'
      using errcode = 'P0001', detail = json_build_object('code', 'invalid_transition')::text;
  end if;
  if v_batch.status <> 'in_progress' then
    raise exception 'invalid_transition: batch is %', v_batch.status
      using errcode = 'P0001', detail = json_build_object('code', 'invalid_transition','from', v_batch.status, 'to', 'completed')::text;
  end if;
  select r.product_variant_id into v_variant from public.recipes r where r.id = v_batch.recipe_id;

  -- p_warehouse_id, when supplied, must belong to this same tenant and to the batch's own
  -- branch -- see complete_production_batch(p_batch_id,p_actual_quantity,p_ingredient_actuals,
  -- p_warehouse_id) for the full explanation (this is the sync-dispatcher overload).
  if v_wh is not null then
    perform 1 from public.warehouses
    where id = v_wh and tenant_id = v_tenant and branch_id = v_batch.branch_id;

    if not found then
      raise exception 'warehouse not found at this branch'
        using errcode = 'P0001', detail = json_build_object('code', 'invalid_transition')::text;
    end if;
  else
    select id into v_wh from public.warehouses
    where tenant_id = v_tenant and branch_id = v_batch.branch_id and is_default limit 1;
  end if;
  if v_wh is null then
    raise exception 'no default warehouse for this branch; pass a warehouse explicitly'
      using errcode = 'P0001', detail = json_build_object('code', 'invalid_transition')::text;
  end if;
  for v_row in
    select pbi.id, pbi.ingredient_id, pbi.planned_quantity
    from public.production_batch_ingredients pbi where pbi.batch_id = p_batch_id
  loop
    select coalesce((a ->> 'actual_quantity')::numeric, v_row.planned_quantity),
           coalesce((a ->> 'waste_quantity')::numeric, 0)
      into v_actual, v_waste
    from jsonb_array_elements(coalesce(p_ingredient_actuals, '[]'::jsonb)) a
    where (a ->> 'ingredient_id')::uuid = v_row.ingredient_id;
    v_actual := coalesce(v_actual, v_row.planned_quantity);
    v_waste  := coalesce(v_waste, 0);
    update public.production_batch_ingredients set actual_quantity = v_actual, waste_quantity = v_waste where id = v_row.id;
    if v_actual > 0 then
      insert into public.stock_movements
        (tenant_id, branch_id, warehouse_id, item_type, ingredient_id, quantity_delta, reason, reference_type, reference_id, created_by)
      values (v_tenant, v_batch.branch_id, v_wh, 'ingredient', v_row.ingredient_id, -v_actual, 'production_consume', 'production_batch', p_batch_id, auth.uid())
      returning * into v_move;
      v_moves := v_moves || to_jsonb(v_move);
    end if;
  end loop;
  insert into public.stock_movements
    (tenant_id, branch_id, warehouse_id, item_type, product_variant_id, quantity_delta, reason, reference_type, reference_id, created_by)
  values (v_tenant, v_batch.branch_id, v_wh, 'product', v_variant, p_actual_quantity, 'production_output', 'production_batch', p_batch_id, auth.uid())
  returning * into v_move;
  v_moves := v_moves || to_jsonb(v_move);
  perform set_config('bakeflow.production_batch_rpc', 'true', true);
  update public.production_batches set actual_quantity = p_actual_quantity, completed_at = now(), status = 'completed'
   where id = p_batch_id returning * into v_batch;
  return jsonb_build_object('batch', to_jsonb(v_batch), 'movements', v_moves);
end $function$;

CREATE OR REPLACE FUNCTION public.complete_ticket(p_order_id uuid, p_warehouse_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant uuid := public.current_tenant_id();
  v_order  public.tickets;
  v_wh     uuid := p_warehouse_id;
  v_item   record;
  v_moves  jsonb := '[]'::jsonb;
  v_move   public.stock_movements;
begin
  select * into v_order from public.tickets
  where id = p_order_id and tenant_id = v_tenant for update;

  if v_order.id is null then
    raise exception 'order not found'
      using errcode = 'P0001', detail = json_build_object('code', 'invalid_transition')::text;
  end if;

  -- Fixed 2026-09-01 (migration fix_complete_ticket_idempotency): a second call on an
  -- already-completed ticket used to silently sell the same stock twice -- the final
  -- status UPDATE is a same-status no-op, so nothing ever raised to stop it.
  if v_order.status = 'completed' then
    raise exception 'order is already completed'
      using errcode = 'P0001',
            detail = json_build_object('code', 'invalid_transition', 'reason', 'already_completed')::text;
  end if;

  -- p_warehouse_id, when supplied, must belong to this same tenant and to the ticket's own
  -- branch -- otherwise a caller could redirect the sale movement onto another tenant's
  -- warehouse, corrupting that tenant's actual stock levels (ingredient_stock_levels/
  -- product_stock_levels are keyed by warehouse_id+item only, not tenant_id -- the
  -- stock_movements_guard_warehouse_tenant trigger is the backstop, this is the specific,
  -- friendly rejection before it).
  if v_wh is not null then
    perform 1 from public.warehouses
    where id = v_wh and tenant_id = v_tenant and branch_id = v_order.branch_id;

    if not found then
      raise exception 'warehouse not found at this branch'
        using errcode = 'P0001', detail = json_build_object('code', 'invalid_transition')::text;
    end if;
  else
    select id into v_wh from public.warehouses
    where tenant_id = v_tenant and branch_id = v_order.branch_id and is_default
    limit 1;
  end if;

  if v_wh is null then
    raise exception 'no default warehouse for this branch; pass a warehouse explicitly'
      using errcode = 'P0001', detail = json_build_object('code', 'invalid_transition')::text;
  end if;

  -- One sale movement per line. apply_stock_movement() refuses to go negative,
  -- so an oversold order fails here and the whole completion rolls back.
  for v_item in
    select product_variant_id, sum(quantity) as qty
    from public.ticket_items where ticket_id = p_order_id
    group by product_variant_id
  loop
    insert into public.stock_movements
      (tenant_id, branch_id, warehouse_id, item_type, product_variant_id,
       quantity_delta, reason, reference_type, reference_id, created_by)
    values
      (v_tenant, v_order.branch_id, v_wh, 'product', v_item.product_variant_id,
       -v_item.qty, 'sale', 'order', p_order_id, auth.uid())
    returning * into v_move;

    v_moves := v_moves || to_jsonb(v_move);
  end loop;

  update public.tickets set status = 'completed' where id = p_order_id
  returning * into v_order;

  return jsonb_build_object('ticket', to_jsonb(v_order), 'movements', v_moves);
end $function$;

CREATE OR REPLACE FUNCTION public.confirm_ticket(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant  uuid := public.current_tenant_id();
  v_order   public.tickets;
  v_items   int;
  v_invoice public.invoices;
begin
  select * into v_order from public.tickets
  where id = p_order_id and tenant_id = v_tenant for update;

  if v_order.id is null then
    raise exception 'order not found'
      using errcode = 'P0001', detail = json_build_object('code', 'invalid_transition')::text;
  end if;

  select count(*) into v_items from public.ticket_items where ticket_id = p_order_id;
  if v_items = 0 then
    raise exception 'an order needs at least one item before it can be confirmed'
      using errcode = 'P0001',
            detail = json_build_object('code', 'invalid_transition',
                                       'reason', 'no_items')::text;
  end if;

  -- Recompute rather than trust: totals are the basis of the invoice.
  update public.tickets
     set subtotal_amount = coalesce(
           (select sum(oi.line_total) from public.ticket_items oi where oi.ticket_id = p_order_id), 0)
   where id = p_order_id;

  update public.tickets set status = 'confirmed'
   where id = p_order_id
  returning * into v_order;

  insert into public.invoices
    (tenant_id, branch_id, ticket_id, invoice_number, total_amount, due_at, created_by)
  values
    (v_tenant, v_order.branch_id, v_order.id,
     public.next_document_number(v_tenant, 'invoice'),
     v_order.total_amount, v_order.due_at, auth.uid())
  on conflict (ticket_id) do update set total_amount = excluded.total_amount
  returning * into v_invoice;

  return jsonb_build_object('ticket', to_jsonb(v_order), 'invoice', to_jsonb(v_invoice));
end $function$;

CREATE OR REPLACE FUNCTION public.copy_batch_planned_ingredients()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_yield numeric(18,4);
begin
  select yield_quantity into v_yield from public.recipes where id = new.recipe_id;

  if v_yield is null or v_yield <= 0 then
    raise exception 'recipe has no usable yield quantity'
      using errcode = 'P0001', detail = json_build_object('code', 'invalid_transition')::text;
  end if;

  insert into public.production_batch_ingredients
    (tenant_id, batch_id, ingredient_id, planned_quantity, created_by)
  select new.tenant_id, new.id, ri.ingredient_id,
         round(ri.quantity * (new.planned_quantity / v_yield), 4),
         new.created_by
  from public.recipe_ingredients ri
  where ri.recipe_id = new.recipe_id
  on conflict (batch_id, ingredient_id) do nothing;

  return null;
end $function$;

CREATE OR REPLACE FUNCTION public.create_organization_invite(p_email text, p_role_key text, p_branch_id uuid DEFAULT NULL::uuid, p_valid_days integer DEFAULT 7)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_role uuid;
  v_raw text;
  v_invite public.organization_invites;
BEGIN
  IF v_tenant IS NULL OR NOT public.has_role(ARRAY['owner','admin']) THEN
    RAISE EXCEPTION 'only owners and admins may invite members'
      USING errcode='P0001', detail=json_build_object('code','insufficient_role')::text;
  END IF;
  SELECT id INTO v_role FROM public.roles WHERE key=p_role_key;
  IF v_role IS NULL OR NOT private.can_manage_target_role(v_role) THEN
    RAISE EXCEPTION 'you are not permitted to invite this role'
      USING errcode='P0001', detail=json_build_object('code','insufficient_role','role_key',p_role_key)::text;
  END IF;
  IF p_branch_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.branches b WHERE b.id=p_branch_id AND b.tenant_id=v_tenant
  ) THEN
    RAISE EXCEPTION 'branch does not belong to this organization'
      USING errcode='P0001', detail=json_build_object('code','insufficient_role')::text;
  END IF;
  IF p_role_key IN ('owner','admin') AND p_branch_id IS NOT NULL THEN
    RAISE EXCEPTION 'owner and admin invitations must be organization-wide'
      USING errcode='P0001', detail=json_build_object('code','invalid_transition')::text;
  END IF;

  -- 2026-09-04 (rate_limit_organization_invite_create): after every other check, so a
  -- malformed/unauthorized request never consumes a legitimate caller's quota.
  PERFORM public.enforce_rate_limit(v_tenant, auth.uid(), 'org_invite_create', 20, 60);

  v_raw := encode(extensions.gen_random_bytes(32),'hex');
  INSERT INTO public.organization_invites
    (tenant_id,email,role_id,branch_id,token_hash,expires_at,created_by)
  VALUES
    (v_tenant,lower(btrim(p_email)),v_role,p_branch_id,
     encode(extensions.digest(v_raw,'sha256'),'hex'),
     now()+make_interval(days=>greatest(p_valid_days,1)),auth.uid())
  RETURNING * INTO v_invite;
  PERFORM public.log_audit_event(
    v_tenant,'organization_invite',v_invite.id,'insert',NULL,
    to_jsonb(v_invite)-'token_hash'
  );
  RETURN jsonb_build_object('invite',to_jsonb(v_invite)-'token_hash','raw_token',v_raw);
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_organization_with_owner(p_name text, p_branch_name text DEFAULT 'Main Branch'::text, p_timezone text DEFAULT 'Africa/Lagos'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user     uuid := auth.uid();
  v_slug     text;
  v_org      public.organizations;
  v_branch   public.branches;
  v_profile  public.profiles;
  v_owner    uuid;
  v_attempt  int := 0;
begin
  if v_user is null then
    raise exception 'authentication required'
      using errcode = 'P0001',
            detail = json_build_object('code', 'insufficient_role')::text;
  end if;

  select * into v_profile from public.profiles where id = v_user for update;

  if v_profile.id is null then
    raise exception 'profile not found'
      using errcode = 'P0001',
            detail = json_build_object('code', 'insufficient_role')::text;
  end if;

  if v_profile.tenant_id is not null then
    raise exception 'this user already belongs to an organization'
      using errcode = 'P0001',
            detail = json_build_object('code', 'duplicate_reference', 'field', 'organization')::text;
  end if;

  -- Slug: URL-safe, unique across the platform. Retry with a random suffix
  -- rather than failing the whole signup on a name collision.
  v_slug := btrim(regexp_replace(lower(p_name), '[^a-z0-9]+', '-', 'g'), '-');
  if v_slug = '' then
    v_slug := 'bakery';
  end if;

  while exists (select 1 from public.organizations o where o.slug = v_slug) loop
    v_attempt := v_attempt + 1;
    if v_attempt > 10 then
      raise exception 'could not allocate a unique slug for %', p_name
        using errcode = 'P0001',
              detail = json_build_object('code', 'duplicate_reference', 'field', 'slug')::text;
    end if;
    v_slug := btrim(regexp_replace(lower(p_name), '[^a-z0-9]+', '-', 'g'), '-')
              || '-' || substr(md5(random()::text), 1, 6);
  end loop;

  insert into public.organizations (name, slug, timezone, created_by)
  values (btrim(p_name), v_slug, coalesce(nullif(btrim(p_timezone), ''), 'Africa/Lagos'), v_user)
  returning * into v_org;

  insert into public.branches (tenant_id, name, code, is_primary, created_by)
  values (v_org.id, btrim(p_branch_name), 'MAIN', true, v_user)
  returning * into v_branch;

  update public.profiles
     set tenant_id = v_org.id,
         primary_branch_id = v_branch.id
   where id = v_user
  returning * into v_profile;

  select id into v_owner from public.roles where key = 'owner';

  insert into public.user_roles (tenant_id, profile_id, role_id, created_by)
  values (v_org.id, v_user, v_owner, v_user);

  insert into public.branch_assignments (tenant_id, profile_id, branch_id, is_default, created_by)
  values (v_org.id, v_user, v_branch.id, true, v_user);

  perform public.log_audit_event(
    v_org.id, 'organization', v_org.id, 'insert', null, to_jsonb(v_org));

  return jsonb_build_object(
    'organization',   to_jsonb(v_org),
    'branch',         to_jsonb(v_branch),
    'profile',        to_jsonb(v_profile),
    -- The tenant_id and roles claims do not exist in the caller's current token.
    -- The client MUST refresh the session before any RLS-protected query.
    'refresh_session', true
  );
end $function$;

CREATE OR REPLACE FUNCTION public.current_tenant_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select nullif(auth.jwt() ->> 'tenant_id', '')::uuid
$function$;

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  claims    jsonb := coalesce(event -> 'claims', '{}'::jsonb);
  v_user    uuid  := (event ->> 'user_id')::uuid;
  v_active  uuid;
  v_status  text;
  v_deleted timestamptz;
  -- Fixed 2026-09-02 (migration fix_db_lint_warnings_array_literals_and_unused_var,
  -- audit-findings/SECURITY-AUDIT-2026-09-02.md): unambiguous typed empty array, not '{}'.
  v_roles   text[] := ARRAY[]::text[];
BEGIN
  SELECT p.active_tenant_id, p.status, p.deleted_at
    INTO v_active, v_status, v_deleted
    FROM public.profiles p
   WHERE p.id = v_user;

  IF v_status IS DISTINCT FROM 'active' OR v_deleted IS NOT NULL THEN
    v_active := NULL;
  ELSIF v_active IS NOT NULL AND NOT EXISTS (
    SELECT 1
      FROM public.user_roles ur
     WHERE ur.profile_id = v_user
       AND ur.tenant_id  = v_active
       AND ur.deleted_at IS NULL
  ) THEN
    v_active := NULL;
  END IF;

  IF v_active IS NOT NULL THEN
    SELECT coalesce(array_agg(DISTINCT r.key), ARRAY[]::text[])
      INTO v_roles
      FROM public.user_roles ur
      JOIN public.roles r ON r.id = ur.role_id
     WHERE ur.profile_id = v_user
       AND ur.tenant_id  = v_active
       AND ur.deleted_at IS NULL
       AND r.deleted_at  IS NULL;
  END IF;

  claims := jsonb_set(claims, '{tenant_id}',
                      coalesce(to_jsonb(v_active), 'null'::jsonb), true);
  claims := jsonb_set(claims, '{roles}',
                      coalesce(to_jsonb(v_roles), '[]'::jsonb), true);

  RETURN jsonb_set(event, '{claims}', claims, true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.depart_driver_trip(p_trip_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant uuid := public.current_tenant_id();
  v_trip public.driver_trips;
begin
  select * into v_trip from public.driver_trips
  where id = p_trip_id and tenant_id = v_tenant for update;

  if v_trip.id is null then
    raise exception 'trip not found'
      using errcode = 'P0001', detail = json_build_object('code', 'invalid_transition')::text;
  end if;

  if v_trip.driver_id <> auth.uid() then
    raise exception 'insufficient_role: only the trip''s own driver may depart'
      using errcode = 'P0001', detail = json_build_object('code', 'insufficient_role')::text;
  end if;

  if v_trip.status <> 'ready_to_depart' then
    raise exception 'invalid_transition: trip is not ready to depart'
      using errcode = 'P0001',
            detail = json_build_object('code', 'invalid_transition', 'from', v_trip.status)::text;
  end if;

  update public.driver_trips
     set status = 'in_transit', departed_at = now()
   where id = p_trip_id
  returning * into v_trip;

  return jsonb_build_object('trip', to_jsonb(v_trip));
end
$function$;

CREATE OR REPLACE FUNCTION public.enforce_rate_limit(p_tenant_id uuid, p_actor_id uuid, p_scope text, p_limit integer, p_window_minutes integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer;
BEGIN
  IF p_tenant_id IS NULL OR p_scope IS NULL OR p_limit IS NULL OR p_window_minutes IS NULL THEN
    RAISE EXCEPTION 'enforce_rate_limit requires tenant_id, scope, limit, and window_minutes'
      USING errcode = 'P0001', detail = json_build_object('code', 'invalid_request')::text;
  END IF;

  IF p_limit < 1 OR p_window_minutes < 1 THEN
    RAISE EXCEPTION 'enforce_rate_limit: limit and window_minutes must be positive'
      USING errcode = 'P0001', detail = json_build_object('code', 'invalid_request')::text;
  END IF;

  -- 2026-09-04 (fix_enforce_rate_limit_toctou): serialize concurrent callers for the same
  -- (tenant_id, scope) so the count-check below can't be raced past p_limit. See that
  -- migration's header for the alternatives considered (counter row + FOR UPDATE; a
  -- unique/exclusion constraint; SERIALIZABLE isolation) and why this one line was chosen.
  PERFORM pg_advisory_xact_lock(hashtext(p_scope || ':rate_limit'), hashtext(p_tenant_id::text));

  -- Counted per (tenant, scope), not per actor: the resource this protects (recipient
  -- inboxes, a transactional-email provider's quota and sender reputation) is a
  -- tenant-level concern, so one compromised or careless member of a tenant cannot dodge
  -- the cap by acting alone -- it caps the tenant's total call volume for this scope, not
  -- any one member's. actor_id is still recorded on each row for traceability.
  SELECT count(*) INTO v_count
  FROM public.rate_limit_events
  WHERE tenant_id = p_tenant_id
    AND scope = p_scope
    AND occurred_at > now() - make_interval(mins => p_window_minutes);

  IF v_count >= p_limit THEN
    RAISE EXCEPTION 'rate limit exceeded for scope %: % of % calls used in the last % minutes',
      p_scope, v_count, p_limit, p_window_minutes
      USING errcode = 'P0001',
            detail = json_build_object(
              'code', 'rate_limited',
              'scope', p_scope,
              'limit', p_limit,
              'window_minutes', p_window_minutes
            )::text;
  END IF;

  INSERT INTO public.rate_limit_events (tenant_id, actor_id, scope)
  VALUES (p_tenant_id, p_actor_id, p_scope);
END;
$function$;

CREATE OR REPLACE FUNCTION public.fail_production_batch(p_batch_id uuid, p_reason text, p_ingredient_actuals jsonb DEFAULT '[]'::jsonb, p_warehouse_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant uuid := public.current_tenant_id();
  v_batch  public.production_batches;
  v_wh     uuid := p_warehouse_id;
  v_row    record;
  v_actual numeric(18,4);
  v_waste  numeric(18,4);
  v_moves  jsonb := '[]'::jsonb;
  v_move   public.stock_movements;
begin
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'a failed batch requires a reason'
      using errcode = 'P0001', detail = json_build_object('code', 'invalid_transition')::text;
  end if;

  select * into v_batch from public.production_batches
  where id = p_batch_id and tenant_id = v_tenant for update;

  if v_batch.id is null or v_batch.status <> 'in_progress' then
    raise exception 'invalid_transition: batch is %', coalesce(v_batch.status, 'missing')
      using errcode = 'P0001',
            detail = json_build_object('code', 'invalid_transition', 'to', 'failed')::text;
  end if;

  -- p_warehouse_id, when supplied, must belong to this same tenant and to the batch's own
  -- branch -- see complete_production_batch for the full explanation (same class of gap,
  -- the batch-failure sibling of that RPC).
  if v_wh is not null then
    perform 1 from public.warehouses
    where id = v_wh and tenant_id = v_tenant and branch_id = v_batch.branch_id;

    if not found then
      raise exception 'warehouse not found at this branch'
        using errcode = 'P0001', detail = json_build_object('code', 'invalid_transition')::text;
    end if;
  else
    select id into v_wh from public.warehouses
    where tenant_id = v_tenant and branch_id = v_batch.branch_id and is_default limit 1;
  end if;
  if v_wh is null then
    raise exception 'no default warehouse for this branch; pass a warehouse explicitly'
      using errcode = 'P0001', detail = json_build_object('code', 'invalid_transition')::text;
  end if;

  for v_row in
    select pbi.id, pbi.ingredient_id, pbi.planned_quantity
    from public.production_batch_ingredients pbi
    where pbi.batch_id = p_batch_id
  loop
    select coalesce((a ->> 'actual_quantity')::numeric, v_row.planned_quantity),
           coalesce((a ->> 'waste_quantity')::numeric, 0)
      into v_actual, v_waste
    from jsonb_array_elements(coalesce(p_ingredient_actuals, '[]'::jsonb)) a
    where (a ->> 'ingredient_id')::uuid = v_row.ingredient_id;

    v_actual := coalesce(v_actual, v_row.planned_quantity);
    v_waste  := coalesce(v_waste, v_actual);

    update public.production_batch_ingredients
       set actual_quantity = v_actual, waste_quantity = v_waste
     where id = v_row.id;

    if v_actual > 0 then
      insert into public.stock_movements
        (tenant_id, branch_id, warehouse_id, item_type, ingredient_id,
         quantity_delta, reason, reference_type, reference_id, note, created_by)
      values
        (v_tenant, v_batch.branch_id, v_wh, 'ingredient', v_row.ingredient_id,
         -v_actual, 'production_consume', 'production_batch', p_batch_id,
         'failed batch: ' || btrim(p_reason), auth.uid())
      returning * into v_move;

      v_moves := v_moves || to_jsonb(v_move);
    end if;
  end loop;

  -- Deliberately NO output movement.
  perform set_config('bakeflow.production_batch_rpc', 'true', true);

  update public.production_batches
     set failure_reason = btrim(p_reason),
         completed_at   = now(),
         status         = 'failed'
   where id = p_batch_id
  returning * into v_batch;

  return jsonb_build_object('batch', to_jsonb(v_batch), 'movements', v_moves);
end $function$;

CREATE OR REPLACE FUNCTION public.fail_production_batch(p_batch_id uuid, p_reason text, p_ingredient_actuals jsonb DEFAULT '[]'::jsonb, p_warehouse_id uuid DEFAULT NULL::uuid, p_tenant_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant uuid := coalesce(p_tenant_id, public.current_tenant_id());
  v_batch  public.production_batches;
  v_wh     uuid := p_warehouse_id;
  v_row    record;
  v_actual numeric(18,4);
  v_waste  numeric(18,4);
  v_moves  jsonb := '[]'::jsonb;
  v_move   public.stock_movements;
begin
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'a failed batch requires a reason'
      using errcode = 'P0001', detail = json_build_object('code', 'invalid_transition')::text;
  end if;
  select * into v_batch from public.production_batches where id = p_batch_id and tenant_id = v_tenant for update;
  if v_batch.id is null or v_batch.status <> 'in_progress' then
    raise exception 'invalid_transition: batch is %', coalesce(v_batch.status, 'missing')
      using errcode = 'P0001', detail = json_build_object('code', 'invalid_transition', 'to', 'failed')::text;
  end if;

  -- p_warehouse_id, when supplied, must belong to this same tenant and to the batch's own
  -- branch -- see complete_production_batch for the full explanation (this is the
  -- sync-dispatcher overload of fail_production_batch).
  if v_wh is not null then
    perform 1 from public.warehouses
    where id = v_wh and tenant_id = v_tenant and branch_id = v_batch.branch_id;

    if not found then
      raise exception 'warehouse not found at this branch'
        using errcode = 'P0001', detail = json_build_object('code', 'invalid_transition')::text;
    end if;
  else
    select id into v_wh from public.warehouses where tenant_id = v_tenant and branch_id = v_batch.branch_id and is_default limit 1;
  end if;
  if v_wh is null then
    raise exception 'no default warehouse for this branch; pass a warehouse explicitly'
      using errcode = 'P0001', detail = json_build_object('code', 'invalid_transition')::text;
  end if;
  for v_row in
    select pbi.id, pbi.ingredient_id, pbi.planned_quantity from public.production_batch_ingredients pbi where pbi.batch_id = p_batch_id
  loop
    select coalesce((a ->> 'actual_quantity')::numeric, v_row.planned_quantity),
           coalesce((a ->> 'waste_quantity')::numeric, 0)
      into v_actual, v_waste
    from jsonb_array_elements(coalesce(p_ingredient_actuals, '[]'::jsonb)) a
    where (a ->> 'ingredient_id')::uuid = v_row.ingredient_id;
    v_actual := coalesce(v_actual, v_row.planned_quantity);
    v_waste  := coalesce(v_waste, v_actual);
    update public.production_batch_ingredients set actual_quantity = v_actual, waste_quantity = v_waste where id = v_row.id;
    if v_actual > 0 then
      insert into public.stock_movements
        (tenant_id, branch_id, warehouse_id, item_type, ingredient_id, quantity_delta, reason, reference_type, reference_id, note, created_by)
      values (v_tenant, v_batch.branch_id, v_wh, 'ingredient', v_row.ingredient_id, -v_actual, 'production_consume', 'production_batch', p_batch_id, 'failed batch: ' || btrim(p_reason), auth.uid())
      returning * into v_move;
      v_moves := v_moves || to_jsonb(v_move);
    end if;
  end loop;
  perform set_config('bakeflow.production_batch_rpc', 'true', true);
  update public.production_batches set failure_reason = btrim(p_reason), completed_at = now(), status = 'failed'
   where id = p_batch_id returning * into v_batch;
  return jsonb_build_object('batch', to_jsonb(v_batch), 'movements', v_moves);
end $function$;

CREATE OR REPLACE FUNCTION public.get_daily_revenue_summary(p_branch_id uuid, p_date date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant uuid := current_tenant_id();
  v_tz text;
  v_date date;
  v_start timestamptz;
  v_end timestamptz;
  v_gross_revenue numeric(19,4);
  v_recognized_refunds numeric(19,4);
  v_gross_collected numeric(19,4);
begin
  if v_tenant is null then
    raise exception 'no active organization'
      using errcode = 'P0001', detail = json_build_object('code','invalid_request')::text;
  end if;

  if not public.has_branch_access(p_branch_id) then
    raise exception 'insufficient_role: no access to this branch'
      using errcode = 'P0001', detail = json_build_object('code','insufficient_role')::text;
  end if;

  if not public.has_role(array['owner','admin','branch_manager','cashier','accountant']) then
    raise exception 'insufficient_role: reporting requires an authorized role'
      using errcode = 'P0001', detail = json_build_object('code','insufficient_role')::text;
  end if;

  select o.timezone into v_tz from public.organizations o where o.id = v_tenant;
  v_date := coalesce(p_date, (now() at time zone v_tz)::date);

  v_start := (v_date::timestamp) at time zone v_tz;
  v_end   := ((v_date + 1)::timestamp) at time zone v_tz;

  select coalesce(sum(t.total_amount), 0) into v_gross_revenue
  from public.tickets t
  where t.tenant_id = v_tenant
    and t.branch_id = p_branch_id
    and t.deleted_at is null
    and t.completed_at >= v_start
    and t.completed_at <  v_end;

  select coalesce(sum(r.amount), 0) into v_recognized_refunds
  from public.refunds r
  where r.tenant_id = v_tenant
    and r.branch_id = p_branch_id
    and r.deleted_at is null
    and r.refunded_at >= v_start
    and r.refunded_at <  v_end;

  select coalesce(sum(p.amount), 0) into v_gross_collected
  from public.payments p
  where p.tenant_id = v_tenant
    and p.branch_id = p_branch_id
    and p.deleted_at is null
    and p.received_at >= v_start
    and p.received_at <  v_end;

  return jsonb_build_object(
    'branch_id', p_branch_id,
    'reporting_date', v_date,
    'timezone', v_tz,
    'gross_revenue', v_gross_revenue::text,
    'recognized_refunds', v_recognized_refunds::text,
    'net_revenue', (v_gross_revenue - v_recognized_refunds)::text,
    'gross_collected', v_gross_collected::text,
    'refunds_paid', v_recognized_refunds::text,
    'net_collected', (v_gross_collected - v_recognized_refunds)::text
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.guard_cash_session_transition()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.status = old.status then
    return new;
  end if;

  if not (old.status = 'open' and new.status = 'closed') then
    raise exception 'invalid_transition: cash session % -> %', old.status, new.status
      using errcode = 'P0001',
            detail = json_build_object('code', 'invalid_transition',
                                       'from', old.status, 'to', new.status)::text;
  end if;

  perform public.log_audit_event(
    new.tenant_id, 'cash_session', new.id, 'status_change',
    jsonb_build_object('status', old.status),
    jsonb_build_object('status', new.status, 'variance', new.variance_amount));

  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.guard_daily_financial_audit_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if tg_op = 'DELETE' then
    raise exception 'daily_financial_audits rows are never deleted; set deleted_at instead'
      using errcode = '42501';
  end if;

  if new.tenant_id    is distinct from old.tenant_id
  or new.branch_id    is distinct from old.branch_id
  or new.audit_date   is distinct from old.audit_date
  or new.submitted_by is distinct from old.submitted_by then
    raise exception 'tenant_id, branch_id, audit_date and submitted_by are immutable on daily_financial_audits'
      using errcode = '42501';
  end if;

  if old.status in ('CONFIRMED','REJECTED') then
    raise exception 'daily financial audit % is already % and can no longer be modified',
      old.id, old.status using errcode = '42501';
  end if;

  if new.status in ('CONFIRMED','REJECTED') then
    if not has_role(array['owner','admin','branch_manager']) then
      raise exception 'only an owner, admin or branch manager may confirm or reject a daily financial audit'
        using errcode = '42501';
    end if;

    if coalesce(new.confirmed_by, auth.uid()) = new.submitted_by then
      raise exception 'the submitter of a daily financial audit may not confirm or reject it'
        using errcode = '42501';
    end if;

    new.confirmed_by := coalesce(new.confirmed_by, auth.uid());
    new.confirmed_at := coalesce(new.confirmed_at, now());
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.guard_delivery_transition()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  allowed      text[];
  v_is_driver  boolean := new.driver_id is not null and new.driver_id = auth.uid();
  v_is_manager boolean := public.has_role(array['owner', 'admin', 'branch_manager']);
begin
  if new.status = old.status then
    return new;
  end if;

  allowed := case old.status
    when 'pending'    then array['assigned']
    when 'assigned'   then array['in_transit']
    when 'in_transit' then array['delivered', 'failed', 'returned']
    when 'failed'     then array['returned']
    else array[]::text[]
  end;

  if not (new.status = any(allowed)) then
    raise exception 'invalid_transition: delivery % -> %', old.status, new.status
      using errcode = 'P0001',
            detail = json_build_object('code', 'invalid_transition',
                                       'from', old.status, 'to', new.status)::text;
  end if;

  -- A driver may only move deliveries assigned to them. Enforced here, not
  -- only in the UI.
  if auth.uid() is not null then
    if new.status in ('in_transit', 'delivered', 'failed', 'returned') then
      if not (v_is_driver or v_is_manager) then
        raise exception 'insufficient_role: only the assigned driver or a manager may do this'
          using errcode = 'P0001',
                detail = json_build_object('code', 'insufficient_role')::text;
      end if;
      -- 'delivered' is the assigned driver's call alone.
      if new.status = 'delivered' and not v_is_driver and not v_is_manager then
        raise exception 'insufficient_role: only the assigned driver may mark delivered'
          using errcode = 'P0001',
                detail = json_build_object('code', 'insufficient_role')::text;
      end if;
    elsif not v_is_manager then
      raise exception 'insufficient_role: assigning a delivery requires a manager'
        using errcode = 'P0001',
              detail = json_build_object('code', 'insufficient_role')::text;
    end if;
  end if;

  if new.status = 'in_transit' and new.dispatched_at is null then
    new.dispatched_at := now();
  end if;
  if new.status = 'delivered' and new.delivered_at is null then
    new.delivered_at := now();
  end if;

  perform public.log_audit_event(
    new.tenant_id, 'delivery', new.id, 'status_change',
    jsonb_build_object('status', old.status),
    jsonb_build_object('status', new.status));

  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.guard_driver_created_order_assignment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF public.has_role_in(auth.uid(), NEW.tenant_id, ARRAY['driver'])
     AND NOT public.has_role_in(auth.uid(), NEW.tenant_id, ARRAY['owner','admin','branch_manager','cashier','baker','accountant']) THEN
    NEW.assigned_to := auth.uid();
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.guard_driver_trip_transition()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  allowed text[];
begin
  if new.status = old.status then
    return new;
  end if;

  allowed := case old.status
    when 'created'         then array['loading']
    when 'loading'         then array['ready_to_depart']
    when 'ready_to_depart' then array['in_transit']
    when 'in_transit'      then array['returning']
    when 'returning'       then array['reconciled']
    when 'reconciled'      then array['completed']
    else array[]::text[]
  end;

  if not (new.status = any(allowed)) then
    raise exception 'invalid_transition: driver trip % -> %', old.status, new.status
      using errcode = 'P0001',
            detail = json_build_object('code', 'invalid_transition',
                                       'from', old.status, 'to', new.status)::text;
  end if;

  perform public.log_audit_event(
    new.tenant_id, 'driver_trip', new.id, 'status_change',
    jsonb_build_object('status', old.status),
    jsonb_build_object('status', new.status));

  return new;
end
$function$;

CREATE OR REPLACE FUNCTION public.guard_expense_cash_session()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_branch uuid;
BEGIN
  IF NEW.cash_session_id IS NOT NULL THEN
    SELECT branch_id INTO v_branch
    FROM public.cash_sessions
    WHERE id = NEW.cash_session_id AND tenant_id = NEW.tenant_id;
    IF v_branch IS NULL THEN
      RAISE EXCEPTION 'cash session does not belong to this organization';
    END IF;
    IF NEW.branch_id <> v_branch THEN
      RAISE EXCEPTION 'cash session branch does not match expense branch';
    END IF;
    IF NEW.paid_method <> 'cash' THEN
      RAISE EXCEPTION 'cash session may only be attached to cash expenses';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.guard_order_actor_and_assignment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_is_driver boolean := public.has_role(array['driver']);
begin
  -- created_by is immutable after insertion. Never overwrite historical authorship.
  if tg_op = 'INSERT' then
    if v_uid is not null then
      new.created_by := v_uid;
    end if;

    if v_uid is not null and v_is_driver and new.assigned_to is null then
      new.assigned_to := v_uid;
    end if;
  elsif tg_op = 'UPDATE' then
    new.created_by := old.created_by;

    -- Drivers may work their tickets, but cannot reassign them.
    if v_uid is not null and v_is_driver and new.assigned_to is distinct from old.assigned_to then
      raise exception 'drivers cannot reassign tickets'
        using errcode = 'P0001', detail = json_build_object('code', 'insufficient_role')::text;
    end if;
  end if;

  if new.created_by is not null then
    if not exists (
      select 1
      from public.profiles p
      where p.id = new.created_by
        and p.deleted_at is null
        and exists (
          select 1
          from public.user_roles ur
          where ur.profile_id = p.id
            and ur.tenant_id  = new.tenant_id
            and ur.deleted_at is null
        )
    ) then
      raise exception 'invalid order creator'
        using errcode = 'P0001', detail = json_build_object('code', 'insufficient_role')::text;
    end if;
  end if;

  if new.assigned_to is not null then
    if not exists (
      select 1
      from public.profiles p
      where p.id = new.assigned_to
        and p.deleted_at is null
        and exists (
          select 1
          from public.user_roles ur
          where ur.profile_id = p.id
            and ur.tenant_id  = new.tenant_id
            and ur.deleted_at is null
        )
    ) then
      raise exception 'assigned staff member does not belong to this organization'
        using errcode = 'P0001', detail = json_build_object('code', 'insufficient_role')::text;
    end if;

    if not exists (
      select 1
      from public.user_roles ur
      join public.roles r on r.id = ur.role_id
      where ur.profile_id = new.assigned_to
        and ur.tenant_id = new.tenant_id
        and ur.deleted_at is null
        and r.key = 'driver'
        and r.deleted_at is null
        and (ur.branch_id is null or ur.branch_id = new.branch_id)
    ) then
      raise exception 'assigned staff member is not a driver for this branch'
        using errcode = 'P0001', detail = json_build_object('code', 'insufficient_role')::text;
    end if;
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.guard_order_item_price()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_price numeric;
  v_tenant uuid;
BEGIN
  SELECT pv.unit_price, pv.tenant_id
    INTO v_price, v_tenant
  FROM public.product_variants pv
  WHERE pv.id = NEW.product_variant_id;

  IF v_price IS NULL OR v_tenant IS NULL THEN
    RAISE EXCEPTION 'product variant not found'
      USING errcode='P0001', detail=json_build_object('code','invalid_transition')::text;
  END IF;

  IF NEW.tenant_id IS DISTINCT FROM v_tenant THEN
    RAISE EXCEPTION 'product variant does not belong to this organization'
      USING errcode='P0001', detail=json_build_object('code','insufficient_role')::text;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.unit_price := v_price;
  ELSIF NEW.product_variant_id IS DISTINCT FROM OLD.product_variant_id THEN
    -- Changing the product also takes the current catalog price for the new variant.
    NEW.unit_price := v_price;
  ELSIF NEW.unit_price IS DISTINCT FROM OLD.unit_price THEN
    RAISE EXCEPTION 'order item price is controlled by the product catalog'
      USING errcode='P0001', detail=json_build_object('code','price_locked')::text;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.guard_payment_relationships()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_order_branch uuid;
  v_order_total numeric(19,4);
  v_already_paid numeric(19,4);
  v_invoice_order uuid;
  v_session_branch uuid;
BEGIN
  IF NEW.ticket_id IS NOT NULL THEN
    SELECT branch_id, total_amount INTO v_order_branch, v_order_total
    FROM public.tickets
    WHERE id = NEW.ticket_id AND tenant_id = NEW.tenant_id;
    IF v_order_branch IS NULL THEN
      RAISE EXCEPTION 'payment order does not belong to this organization';
    END IF;
    IF NEW.branch_id <> v_order_branch THEN
      RAISE EXCEPTION 'payment branch does not match order branch';
    END IF;

    SELECT COALESCE(SUM(amount), 0) INTO v_already_paid
    FROM public.payments
    WHERE ticket_id = NEW.ticket_id;

    IF v_already_paid + NEW.amount > v_order_total THEN
      RAISE EXCEPTION 'payment of % would exceed the % outstanding on this order (% of % already paid)',
        NEW.amount, v_order_total - v_already_paid, v_already_paid, v_order_total
        USING errcode = 'P0001',
              detail = json_build_object(
                'code', 'invalid_transition',
                'reason', 'overpayment',
                'total_amount', v_order_total,
                'already_paid', v_already_paid,
                'attempted_amount', NEW.amount
              )::text;
    END IF;
  END IF;

  IF NEW.invoice_id IS NOT NULL THEN
    SELECT ticket_id INTO v_invoice_order
    FROM public.invoices
    WHERE id = NEW.invoice_id AND tenant_id = NEW.tenant_id;
    IF v_invoice_order IS NULL THEN
      RAISE EXCEPTION 'payment invoice does not belong to this organization';
    END IF;
    IF NEW.ticket_id IS NULL OR v_invoice_order <> NEW.ticket_id THEN
      RAISE EXCEPTION 'payment invoice does not belong to the payment order';
    END IF;
  END IF;

  IF NEW.cash_session_id IS NOT NULL THEN
    SELECT branch_id INTO v_session_branch
    FROM public.cash_sessions
    WHERE id = NEW.cash_session_id AND tenant_id = NEW.tenant_id;
    IF v_session_branch IS NULL THEN
      RAISE EXCEPTION 'cash session does not belong to this organization';
    END IF;
    IF NEW.branch_id <> v_session_branch THEN
      RAISE EXCEPTION 'cash session branch does not match payment branch';
    END IF;
    IF NEW.method <> 'cash' THEN
      RAISE EXCEPTION 'cash session may only be attached to cash payments';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.guard_production_batch_transition()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  allowed text[];
  actors  text[];
begin
  if new.status = old.status then
    return new;
  end if;

  allowed := case old.status
    when 'scheduled'   then array['in_progress', 'cancelled']
    when 'in_progress' then array['completed', 'failed']
    else array[]::text[]
  end;

  if not (new.status = any(allowed)) then
    raise exception 'invalid_transition: batch % -> %', old.status, new.status
      using errcode = 'P0001',
            detail = json_build_object('code', 'invalid_transition',
                                       'from', old.status, 'to', new.status)::text;
  end if;

  if new.status in ('completed', 'failed')
     and coalesce(current_setting('bakeflow.production_batch_rpc', true), 'false') <> 'true'
  then
    raise exception 'invalid_transition: % must be set through complete_production_batch() or fail_production_batch(), not a direct update', new.status
      using errcode = 'P0001',
            detail = json_build_object('code', 'invalid_transition',
                                       'from', old.status, 'to', new.status)::text;
  end if;

  actors := case new.status
    when 'in_progress' then array['owner', 'admin', 'branch_manager', 'baker']
    when 'completed'   then array['owner', 'admin', 'branch_manager', 'baker']
    when 'failed'      then array['owner', 'admin', 'branch_manager', 'baker']
    when 'cancelled'   then array['owner', 'admin', 'branch_manager']
  end;

  -- Fixed 2026-08-30 (found while building the P3.7 PRODUCTION sync slice, live-reproduced
  -- before fixing): auth.uid() is still the real caller regardless of SECURITY DEFINER
  -- context, but has_role(actors) reads the session JWT's role claim, which reflects the
  -- session's *active* organization, not necessarily new.tenant_id. A session active in org
  -- B, holding branch_manager there, could flip an org A batch's status with zero role in
  -- org A -- the exact active-org-assumption bug class AD-006 already fixed for
  -- is_authorized_for_branch()/has_role_in() elsewhere; this table's own trigger had never
  -- been touched by that fix, and was dormant only because no prior write path could ever
  -- produce a mismatched tenant_id -- until the sync gateway's explicit-tenant model made it
  -- reachable. has_role_in() checks the live user_roles table for the row's own tenant.
  if auth.uid() is not null and not public.has_role_in(auth.uid(), new.tenant_id, actors) then
    raise exception 'insufficient_role: % requires one of %', new.status, actors
      using errcode = 'P0001',
            detail = json_build_object('code', 'insufficient_role', 'required', actors)::text;
  end if;

  if new.status = 'in_progress' and new.started_at is null then
    new.started_at := now();
  end if;

  perform public.log_audit_event(
    new.tenant_id, 'production_batch', new.id, 'status_change',
    jsonb_build_object('status', old.status),
    jsonb_build_object('status', new.status));

  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.guard_profile_primary_branch()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_branch_tenant uuid;
BEGIN
  IF NEW.primary_branch_id IS NOT NULL THEN
    SELECT tenant_id INTO v_branch_tenant
    FROM public.branches WHERE id = NEW.primary_branch_id;
    IF v_branch_tenant IS NULL OR v_branch_tenant IS DISTINCT FROM NEW.tenant_id THEN
      RAISE EXCEPTION 'primary branch does not belong to this organization'
        USING errcode='P0001', detail=json_build_object('code','insufficient_role')::text;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.guard_refund_total()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_payment numeric(19,4);
  v_refunded numeric(19,4);
begin
  select amount into v_payment from public.payments where id = new.payment_id for update;

  select coalesce(sum(amount), 0) into v_refunded
  from public.refunds where payment_id = new.payment_id;

  if v_refunded + new.amount > v_payment then
    raise exception 'refund of % exceeds the % remaining on this payment',
      new.amount, v_payment - v_refunded
      using errcode = 'P0001',
            detail = json_build_object('code', 'invalid_transition',
                                       'payment_amount', v_payment,
                                       'already_refunded', v_refunded)::text;
  end if;

  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.guard_stock_movement_warehouse_tenant()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.warehouses w
    WHERE w.id = NEW.warehouse_id AND w.tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'stock movement warehouse_id % does not belong to tenant %', NEW.warehouse_id, NEW.tenant_id
      USING ERRCODE = 'P0001',
            DETAIL = json_build_object('code', 'invalid_request', 'reason', 'warehouse_tenant_mismatch')::text;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.guard_ticket_driver_trip_assignment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_trip public.driver_trips;
begin
  if new.driver_trip_id is null then
    return new;
  end if;

  if old.driver_trip_id is not distinct from new.driver_trip_id then
    return new;
  end if;

  select * into v_trip from public.driver_trips
  where id = new.driver_trip_id and tenant_id = new.tenant_id;

  if v_trip.id is null then
    raise exception 'driver trip not found'
      using errcode = 'P0001', detail = json_build_object('code', 'invalid_request')::text;
  end if;

  if v_trip.branch_id <> new.branch_id then
    raise exception 'driver trip belongs to a different branch'
      using errcode = 'P0001', detail = json_build_object('code', 'invalid_request')::text;
  end if;

  if v_trip.status <> 'in_transit' then
    raise exception 'invalid_transition: driver trip is not in transit'
      using errcode = 'P0001',
            detail = json_build_object('code', 'invalid_transition', 'from', v_trip.status)::text;
  end if;

  if v_trip.driver_id <> new.created_by and v_trip.driver_id <> new.assigned_to then
    raise exception 'insufficient_role: ticket does not belong to this trip''s driver'
      using errcode = 'P0001', detail = json_build_object('code', 'insufficient_role')::text;
  end if;

  return new;
end
$function$;

CREATE OR REPLACE FUNCTION public.guard_ticket_item_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_status text;
  v_order  uuid := coalesce(new.ticket_id, old.ticket_id);
begin
  select status into v_status from public.tickets where id = v_order;

  if v_status in ('ready', 'completed', 'cancelled') then
    raise exception 'order_locked: this order can no longer be changed (status %)', v_status
      using errcode = 'P0001',
            detail = json_build_object('code', 'order_locked', 'status', v_status)::text;
  end if;

  return coalesce(new, old);
end $function$;

CREATE OR REPLACE FUNCTION public.guard_ticket_status_transition()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  allowed           text[];
  actors            text[];
  v_refund          numeric(19,4);
  v_delivery_status text;
  v_true_subtotal   numeric(19,4);
BEGIN
  -- ── Money freeze ────────────────────────────────────────────────────────────
  IF OLD.status <> 'draft'
     AND NEW.subtotal_amount IS DISTINCT FROM OLD.subtotal_amount THEN
    SELECT COALESCE(SUM(line_total), 0) INTO v_true_subtotal
    FROM public.ticket_items WHERE ticket_id = NEW.id;

    IF NEW.subtotal_amount IS DISTINCT FROM v_true_subtotal THEN
      RAISE EXCEPTION 'subtotal_amount is frozen once a ticket leaves draft'
        USING ERRCODE = '42501',
              DETAIL  = json_build_object(
                'code', 'immutable_field',
                'field', 'subtotal_amount',
                'current_status', OLD.status
              )::text;
    END IF;
  END IF;

  -- ── Status unchanged — nothing more to do ───────────────────────────────────
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  -- ── Allowed transitions ─────────────────────────────────────────────────────
  -- 'completed' added to 'draft''s targets for BLOCKER-021 -- the driver field-sale
  -- shortcut. Gated immediately below; this array alone does not make it reachable.
  allowed := CASE OLD.status
    WHEN 'draft'         THEN ARRAY['submitted', 'cancelled', 'completed']
    WHEN 'submitted'     THEN ARRAY['confirmed', 'cancelled']
    WHEN 'confirmed'     THEN ARRAY['scheduled', 'cancelled']
    WHEN 'scheduled'     THEN ARRAY['in_production', 'cancelled']
    WHEN 'in_production' THEN ARRAY['ready', 'cancelled']
    WHEN 'ready'         THEN ARRAY['delivered', 'cancelled']
    WHEN 'delivered'     THEN ARRAY['completed', 'cancelled']
    WHEN 'cancelled'     THEN ARRAY['archived']
    ELSE ARRAY[]::text[]
  END;

  IF NOT (NEW.status = ANY(allowed)) THEN
    RAISE EXCEPTION 'invalid_transition: order % -> %', OLD.status, NEW.status
      USING ERRCODE = 'P0001',
            DETAIL  = json_build_object(
              'code', 'invalid_transition',
              'from', OLD.status,
              'to',   NEW.status
            )::text;
  END IF;

  -- ── BLOCKER-021: draft -> completed must go through complete_driver_field_sale() ──
  IF OLD.status = 'draft' AND NEW.status = 'completed'
     AND COALESCE(current_setting('bakeflow.driver_field_sale_rpc', true), 'false') <> 'true'
  THEN
    RAISE EXCEPTION 'invalid_transition: draft -> completed is only reachable through complete_driver_field_sale()'
      USING ERRCODE = 'P0001',
            DETAIL  = json_build_object(
              'code', 'invalid_transition',
              'from', 'draft',
              'to',   'completed'
            )::text;
  END IF;

  IF OLD.status = 'draft' AND NEW.status = 'completed' AND NEW.fulfilment_type <> 'pickup' THEN
    RAISE EXCEPTION 'invalid_transition: the driver field-sale shortcut is pickup-only'
      USING ERRCODE = 'P0001',
            DETAIL  = json_build_object(
              'code', 'invalid_transition',
              'reason', 'not_pickup'
            )::text;
  END IF;

  IF OLD.status = 'draft' AND NEW.status = 'completed' AND NEW.driver_trip_id IS NULL THEN
    RAISE EXCEPTION 'invalid_transition: the driver field-sale shortcut requires driver_trip_id'
      USING ERRCODE = 'P0001',
            DETAIL  = json_build_object(
              'code', 'invalid_transition',
              'reason', 'no_trip'
            )::text;
  END IF;

  -- ── Role check ──────────────────────────────────────────────────────────────
  actors := CASE NEW.status
    WHEN 'submitted'     THEN ARRAY['owner', 'admin', 'branch_manager', 'cashier']
    WHEN 'confirmed'     THEN ARRAY['owner', 'admin', 'branch_manager', 'cashier']
    WHEN 'scheduled'     THEN ARRAY['owner', 'admin', 'branch_manager', 'cashier']
    WHEN 'in_production' THEN ARRAY['owner', 'admin', 'branch_manager', 'baker']
    WHEN 'ready'         THEN ARRAY['owner', 'admin', 'branch_manager', 'baker']
    WHEN 'delivered'     THEN ARRAY['owner', 'admin', 'branch_manager', 'cashier']
    WHEN 'completed'     THEN CASE WHEN OLD.status = 'draft'
                                    THEN ARRAY['owner', 'admin', 'branch_manager', 'driver']
                                    ELSE ARRAY['owner', 'admin', 'branch_manager', 'cashier']
                               END
    WHEN 'cancelled'     THEN ARRAY['owner', 'admin', 'branch_manager']
    WHEN 'archived'      THEN ARRAY['owner', 'admin', 'branch_manager']
  END;

  IF auth.uid() IS NOT NULL AND NOT public.has_role(actors) THEN
    RAISE EXCEPTION 'insufficient_role: % requires one of %', NEW.status, actors
      USING ERRCODE = 'P0001',
            DETAIL  = json_build_object(
              'code',     'insufficient_role',
              'required', actors
            )::text;
  END IF;

  -- ── Delivery gate ────────────────────────────────────────────────────────────
  IF NEW.status = 'delivered' AND NEW.fulfilment_type = 'delivery' THEN
    SELECT d.status INTO v_delivery_status
    FROM   public.deliveries d
    WHERE  d.ticket_id = NEW.id;

    IF v_delivery_status IS DISTINCT FROM 'delivered' THEN
      RAISE EXCEPTION 'delivery_not_complete: order requires linked delivery to be delivered first'
        USING ERRCODE = 'P0001',
              DETAIL  = json_build_object(
                'code',            'delivery_not_complete',
                'delivery_status', v_delivery_status
              )::text;
    END IF;
  END IF;

  -- ── Cancellation rules ───────────────────────────────────────────────────────
  IF NEW.status = 'cancelled' THEN
    IF COALESCE(BTRIM(NEW.cancelled_reason), '') = '' THEN
      RAISE EXCEPTION 'cancellation requires a reason'
        USING ERRCODE = 'P0001',
              DETAIL  = json_build_object(
                'code',   'invalid_transition',
                'reason', 'cancelled_reason_required'
              )::text;
    END IF;

    IF NEW.amount_paid > 0 THEN
      SELECT COALESCE(SUM(r.amount), 0) INTO v_refund
      FROM   public.refunds r
      JOIN   public.payments p ON p.id = r.payment_id
      WHERE  p.ticket_id = NEW.id;

      IF v_refund < NEW.amount_paid THEN
        RAISE EXCEPTION 'refund_required: % paid, only % refunded', NEW.amount_paid, v_refund
          USING ERRCODE = 'P0001',
                DETAIL  = json_build_object(
                  'code',      'refund_required',
                  'paid',      NEW.amount_paid,
                  'refunded',  v_refund
                )::text;
      END IF;
    END IF;
  END IF;

  -- ── Revenue-recognition timestamp ───────────────────────────────────────────
  -- Single choke point: both entry paths into 'completed' (the normal
  -- delivered -> completed hop and the AD-020 draft -> completed shortcut) pass through
  -- here. Stamped once; the column has no UPDATE grant path back to draft that could
  -- reset it (terminal state).
  IF NEW.status = 'completed' THEN
    NEW.completed_at := now();
  END IF;

  -- ── Audit ────────────────────────────────────────────────────────────────────
  PERFORM public.log_audit_event(
    NEW.tenant_id, 'ticket', NEW.id, 'status_change',
    jsonb_build_object('status', OLD.status),
    jsonb_build_object('status', NEW.status)
  );

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.guard_user_role_integrity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_branch_tenant uuid;
  v_role_key      text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = NEW.profile_id) THEN
    RAISE EXCEPTION 'profile does not exist'
      USING errcode='P0001', detail=json_build_object('code','insufficient_role')::text;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'organization does not exist'
      USING errcode='P0001', detail=json_build_object('code','insufficient_role')::text;
  END IF;

  SELECT key INTO v_role_key FROM public.roles WHERE id = NEW.role_id;
  IF v_role_key IS NULL THEN
    RAISE EXCEPTION 'unknown role'
      USING errcode='P0001', detail=json_build_object('code','invalid_transition')::text;
  END IF;

  IF v_role_key IN ('owner','admin') AND NEW.branch_id IS NOT NULL THEN
    RAISE EXCEPTION 'owner and admin roles must be organization-wide'
      USING errcode='P0001', detail=json_build_object('code','invalid_transition')::text;
  END IF;

  IF NEW.branch_id IS NOT NULL THEN
    SELECT tenant_id INTO v_branch_tenant
    FROM public.branches WHERE id = NEW.branch_id;
    IF v_branch_tenant IS NULL OR v_branch_tenant IS DISTINCT FROM NEW.tenant_id THEN
      RAISE EXCEPTION 'branch does not belong to this organization'
        USING errcode='P0001', detail=json_build_object('code','insufficient_role')::text;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into public.profiles (id, full_name, phone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    new.raw_user_meta_data ->> 'phone'
  )
  on conflict (id) do nothing;
  return new;
end $function$;

-- has_role/has_role_in moved here (out of strict alphabetical order, ahead of
-- has_branch_access) 2026-09-01: has_branch_access() is LANGUAGE sql, which Postgres
-- validates eagerly at CREATE FUNCTION time (unlike plpgsql's lazy validation) -- calling
-- public.has_role(...) before has_role itself was defined made this file fail applying
-- to a genuinely fresh database with "function public.has_role(text[]) does not exist".
-- Found via the P11.1 throwaway-database CI validation exercise, not caught by BLOCKER-002's
-- earlier verification (which checked function bodies were individually valid DDL via
-- pg_get_functiondef, but never actually re-ran the FUNCTIONS section start-to-finish against
-- an empty database — exactly the gap this exercise was built to close). See
-- IMPLEMENTATION_LOG.md 2026-09-01.
CREATE OR REPLACE FUNCTION public.has_role(role_keys text[])
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select coalesce((auth.jwt() -> 'roles') ?| role_keys, false)
$function$;

CREATE OR REPLACE FUNCTION public.has_role_in(p_actor uuid, p_tenant uuid, p_role_keys text[])
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
      FROM public.user_roles ur
      JOIN public.roles r ON r.id = ur.role_id
     WHERE ur.profile_id = p_actor
       AND ur.tenant_id  = p_tenant
       AND ur.deleted_at IS NULL
       AND r.deleted_at  IS NULL
       AND r.key = ANY (p_role_keys)
  );
$function$;

-- Was entirely missing from this file (schema and function both) until 2026-09-01 despite
-- being referenced by three RLS policies and a GRANT further down -- see the SCHEMAS section
-- note near the top of this file. Placed here (after has_role) because it calls
-- public.has_role(), which -- like has_branch_access below -- must exist first for this
-- LANGUAGE sql function to validate at CREATE time.
CREATE OR REPLACE FUNCTION private.can_manage_target_role(p_role_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT CASE
    WHEN public.has_role(ARRAY['owner']) THEN EXISTS (
      SELECT 1 FROM public.roles r WHERE r.id = p_role_id
    )
    WHEN public.has_role(ARRAY['admin']) THEN EXISTS (
      SELECT 1 FROM public.roles r
      WHERE r.id = p_role_id AND r.key NOT IN ('owner','admin')
    )
    ELSE false
  END;
$function$;

CREATE OR REPLACE FUNCTION public.has_branch_access(target_branch_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    public.has_role(array['owner', 'admin'])
    or exists (
      select 1
      from public.branch_assignments ba
      where ba.profile_id = auth.uid()
        and ba.branch_id  = target_branch_id
        and ba.tenant_id  = public.current_tenant_id()
    )
$function$;

-- Fixed 2026-09-02 (migration add_supervisor_permission_overrides, BLOCKER-025): now
-- override-aware -- an active user_permission_overrides row for the caller wins outright
-- (COALESCE short-circuits to it); otherwise falls back to the role-level grant, unchanged
-- in substance from the prior definition. Branch-access check pulled out of the per-row
-- EXISTS since an override has no role row of its own to check; unchanged in effect.
CREATE OR REPLACE FUNCTION public.has_permission(required_permission text, target_branch_id uuid DEFAULT NULL::uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    COALESCE(
      (
        SELECT upo.granted
        FROM public.user_permission_overrides upo
        JOIN public.permissions p ON p.id = upo.permission_id
        WHERE upo.profile_id = auth.uid()
          AND upo.tenant_id = public.current_tenant_id()
          AND upo.deleted_at IS NULL
          AND p.key = required_permission
          AND p.deleted_at IS NULL
      ),
      EXISTS (
        SELECT 1
        FROM public.user_roles ur
        JOIN public.roles r ON r.id=ur.role_id
        JOIN public.role_permissions rp ON rp.role_id=r.id
        JOIN public.permissions p ON p.id=rp.permission_id
        WHERE ur.profile_id=auth.uid()
          AND ur.tenant_id=public.current_tenant_id()
          AND ur.deleted_at IS NULL
          AND r.deleted_at IS NULL
          AND p.deleted_at IS NULL
          AND p.key=required_permission
      )
    )
    AND (
      target_branch_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.user_roles ur
        JOIN public.roles r ON r.id = ur.role_id
        WHERE ur.profile_id = auth.uid()
          AND ur.tenant_id = public.current_tenant_id()
          AND ur.deleted_at IS NULL
          AND r.deleted_at IS NULL
          AND r.key IN ('owner','admin')
      )
      OR EXISTS (
        SELECT 1 FROM public.branch_assignments ba
        WHERE ba.profile_id=auth.uid()
          AND ba.tenant_id=public.current_tenant_id()
          AND ba.branch_id=target_branch_id
      )
    );
$function$;

CREATE OR REPLACE FUNCTION public.is_authorized_for_branch(p_actor uuid, p_tenant uuid, p_branch uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Organization-level operation: membership in that organization is the rule.
  IF p_branch IS NULL THEN
    RETURN public.is_member_of(p_actor, p_tenant);
  END IF;

  IF NOT public.is_member_of(p_actor, p_tenant) THEN
    RETURN false;
  END IF;

  -- §13: the branch must belong to THIS organization and be live, and this is
  -- evaluated BEFORE organization-wide roles are consulted. A branch id from
  -- Bakery B must never become authorized because the actor is an owner in
  -- Bakery A.
  IF NOT EXISTS (
    SELECT 1 FROM public.branches b
     WHERE b.id        = p_branch
       AND b.tenant_id = p_tenant
       AND b.deleted_at IS NULL
  ) THEN
    RETURN false;
  END IF;

  -- §14: owner/admin reach every valid branch of their own organization.
  IF EXISTS (
    SELECT 1
      FROM public.user_roles ur
      JOIN public.roles r ON r.id = ur.role_id
     WHERE ur.profile_id = p_actor
       AND ur.tenant_id  = p_tenant
       AND ur.deleted_at IS NULL
       AND r.deleted_at  IS NULL
       AND r.key IN ('owner','admin')
  ) THEN
    RETURN true;
  END IF;

  -- Everyone else needs an explicit branch assignment in that organization.
  RETURN EXISTS (
    SELECT 1
      FROM public.branch_assignments ba
     WHERE ba.profile_id = p_actor
       AND ba.tenant_id  = p_tenant
       AND ba.branch_id  = p_branch
       AND ba.deleted_at IS NULL
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.is_member_of(p_actor uuid, p_tenant uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT p_actor IS NOT NULL
     AND p_tenant IS NOT NULL
     AND EXISTS (
       SELECT 1
         FROM public.user_roles ur
        WHERE ur.profile_id = p_actor
          AND ur.tenant_id  = p_tenant
          AND ur.deleted_at IS NULL
     )
     AND EXISTS (
       SELECT 1
         FROM public.profiles p
        WHERE p.id = p_actor
          AND p.status = 'active'
          AND p.deleted_at IS NULL
     );
$function$;

CREATE OR REPLACE FUNCTION public.log_audit_event(p_tenant_id uuid, p_entity_type text, p_entity_id uuid, p_action text, p_before jsonb DEFAULT NULL::jsonb, p_after jsonb DEFAULT NULL::jsonb)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  insert into public.audit_log (tenant_id, actor_id, entity_type, entity_id, action, before, after)
  values (p_tenant_id, auth.uid(), p_entity_type, p_entity_id, p_action, p_before, p_after);
$function$;

-- 2026-09-04 (add_expenses_audit_trail): expenses had no audit trail at all -- neither the
-- sync/RPC path (apply_expense_create) nor any direct-write RLS path ever called
-- log_audit_event. Hand-written, per-table AFTER trigger, matching this file's existing
-- guard_*_transition() convention rather than a generic reusable abstraction (expenses is
-- the first table getting this treatment; revisit only if a second and third table need
-- the same -- rule of three). Scope is auditability only -- BLOCKER-028
-- (expense.reverse/immutability) remains open and unchanged.
CREATE OR REPLACE FUNCTION public.log_expense_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.log_audit_event(NEW.tenant_id, 'expense', NEW.id, 'insert', NULL, to_jsonb(NEW));
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    PERFORM public.log_audit_event(NEW.tenant_id, 'expense', NEW.id, 'update', to_jsonb(OLD), to_jsonb(NEW));
    RETURN NEW;
  ELSE
    PERFORM public.log_audit_event(OLD.tenant_id, 'expense', OLD.id, 'delete', to_jsonb(OLD), NULL);
    RETURN OLD;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.next_document_number(p_tenant_id uuid, p_doc_type text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_prefix text; v_next bigint;
begin
  v_prefix := case p_doc_type when 'ticket' then 'TKT' when 'invoice' then 'INV' when 'production_batch' then 'BATCH' end;
  if v_prefix is null then raise exception 'unknown document type: %', p_doc_type using errcode='P0001', detail=json_build_object('code','invalid_document_type','doc_type',p_doc_type)::text; end if;
  insert into public.document_sequences (tenant_id,doc_type,prefix,current_value) values (p_tenant_id,p_doc_type,v_prefix,1)
  on conflict (tenant_id,doc_type) do update set current_value=public.document_sequences.current_value+1
  returning current_value into v_next;
  return v_prefix || '-' || lpad(v_next::text,6,'0');
end $function$;

CREATE OR REPLACE FUNCTION public.open_cash_session(p_branch_id uuid, p_opening_float numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant  uuid := public.current_tenant_id();
  v_session public.cash_sessions;
begin
  if p_opening_float is null or p_opening_float < 0 then
    raise exception 'opening float cannot be negative'
      using errcode = 'P0001', detail = json_build_object('code', 'invalid_transition')::text;
  end if;

  if not public.has_branch_access(p_branch_id)
     or not public.has_role(array['owner', 'admin', 'branch_manager', 'cashier']) then
    raise exception 'insufficient_role: not permitted to open a till at this branch'
      using errcode = 'P0001', detail = json_build_object('code', 'insufficient_role')::text;
  end if;

  begin
    insert into public.cash_sessions
      (tenant_id, branch_id, opened_by, opening_float, created_by)
    values
      (v_tenant, p_branch_id, auth.uid(), p_opening_float, auth.uid())
    returning * into v_session;
  exception when unique_violation then
    -- The partial unique index is what makes two concurrent opens resolve to
    -- exactly one winner; this converts the raw violation into a stable code.
    raise exception 'session_already_open: a till session is already open at this branch'
      using errcode = 'P0001',
            detail = json_build_object('code', 'session_already_open')::text;
  end;

  perform public.log_audit_event(
    v_tenant, 'cash_session', v_session.id, 'insert', null, to_jsonb(v_session));

  return jsonb_build_object('session', to_jsonb(v_session));
end $function$;

CREATE OR REPLACE FUNCTION public.prevent_audit_log_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  raise exception 'audit_log is append-only'
    using errcode = 'P0001',
          detail = json_build_object('code', 'immutable_table', 'table', 'audit_log')::text;
end $function$;

CREATE OR REPLACE FUNCTION public.prevent_cash_session_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  raise exception 'cash sessions are never deleted'
    using errcode = 'P0001',
          detail = json_build_object('code', 'immutable_table', 'table', 'cash_sessions')::text;
end $function$;

CREATE OR REPLACE FUNCTION public.prevent_driver_trip_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  raise exception 'driver trips are never deleted'
    using errcode = 'P0001',
          detail = json_build_object('code', 'immutable_table', 'table', 'driver_trips')::text;
end
$function$;

CREATE OR REPLACE FUNCTION public.prevent_financial_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  raise exception '% is append-only; record a refund or a correcting entry instead', tg_table_name
    using errcode = 'P0001',
          detail = json_build_object('code', 'immutable_table', 'table', tg_table_name)::text;
end $function$;

CREATE OR REPLACE FUNCTION public.prevent_stock_movement_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  raise exception 'stock_movements is append-only; record a correcting adjustment instead'
    using errcode = 'P0001',
          detail = json_build_object('code', 'immutable_table', 'table', 'stock_movements')::text;
end $function$;

CREATE OR REPLACE FUNCTION public.process_sync_batch(p_device_id uuid, p_operations jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required'
      USING errcode = '28000', detail = json_build_object('code','insufficient_role')::text;
  END IF;

  IF jsonb_typeof(p_operations) <> 'array' THEN
    RAISE EXCEPTION 'p_operations must be a JSON array'
      USING errcode = '22023', detail = json_build_object('code','invalid_transition')::text;
  END IF;

  -- Establishes: caller authenticated, device exists, device owned by caller,
  -- device not revoked. It deliberately does NOT return an organization (§11).
  v_actor := public.sync_validate_device(p_device_id);

  RETURN public.process_sync_batch_context_validated(p_device_id, p_operations, v_actor);
END;
$function$;

CREATE OR REPLACE FUNCTION public.process_sync_batch_context_validated(p_device_id uuid, p_operations jsonb, p_actor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  op            jsonb;
  v_opid        uuid;
  v_tenant      uuid;
  v_branch      uuid;
  v_entity      uuid;
  v_entity_type text;
  v_op_type     text;
  v_domain_op   text;
  v_base_rev    bigint;
  v_created     timestamptz;
  v_client_seq  bigint;
  v_payload     jsonb;
  v_current_rev bigint;
  v_status      text;
  v_err_code    text;
  v_existing    public.sync_operations;
  v_final_status text;
  v_final_err    text;
  v_final_result jsonb;
  v_results     jsonb := '[]'::jsonb;
BEGIN
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'authentication required'
      USING errcode = '28000', detail = json_build_object('code','insufficient_role')::text;
  END IF;

  IF jsonb_typeof(p_operations) <> 'array' THEN
    RAISE EXCEPTION 'p_operations must be a JSON array'
      USING errcode = '22023', detail = json_build_object('code','invalid_transition')::text;
  END IF;

  -- 2026-09-04 (cap_sync_batch_operation_count): bound per-call server-side work. See
  -- that migration's header for the EB-017 batch-size guidance this cap is based on.
  IF jsonb_array_length(p_operations) > 500 THEN
    RAISE EXCEPTION 'batch exceeds the maximum of 500 operations per call (got %)', jsonb_array_length(p_operations)
      USING errcode = '22023', detail = json_build_object('code','batch_too_large','max_operations',500)::text;
  END IF;

  FOR op IN SELECT value FROM jsonb_array_elements(p_operations) LOOP
    -- Immutable context, taken verbatim from the operation (§8).
    v_opid        := nullif(op ->> 'operation_id','')::uuid;
    v_tenant      := nullif(op ->> 'tenant_id','')::uuid;
    v_branch      := nullif(op ->> 'branch_id','')::uuid;
    v_entity      := nullif(op ->> 'entity_id','')::uuid;
    v_entity_type := nullif(op ->> 'entity_type','');
    v_op_type     := nullif(op ->> 'operation_type','');
    v_domain_op   := nullif(op ->> 'domain_operation','');
    v_base_rev    := nullif(op ->> 'base_revision','')::bigint;
    v_created     := nullif(op ->> 'device_created_at','')::timestamptz;
    -- Diagnostic-only (OFFLINE-SYNC-MODEL.md §16): captured, never enforced on.
    v_client_seq  := nullif(op ->> 'client_sequence','')::bigint;
    v_payload     := coalesce(op -> 'payload', '{}'::jsonb);
    -- NOTE: op->>'actor_id' and op->>'received_at' are read by nothing. The actor
    -- comes from the authenticated device relationship (§10) and received_at is
    -- server-assigned (§17); a client-supplied value for either is ignored.

    IF v_opid IS NULL OR v_tenant IS NULL OR v_entity IS NULL
       OR v_entity_type IS NULL OR v_op_type IS NULL OR v_created IS NULL THEN
      RAISE EXCEPTION 'operation context is incomplete'
        USING errcode = '22023', detail = json_build_object('code','invalid_transition')::text;
    END IF;

    -- P3.7 item 2/malformed-payload: the payload must be a JSON object (or
    -- absent, defaulting to {}). A non-object payload is a client bug and is
    -- refused at the gateway boundary, matching the other structural checks
    -- above, rather than surfacing as an opaque failure deep inside a handler.
    IF jsonb_typeof(v_payload) <> 'object' THEN
      RAISE EXCEPTION 'operation payload must be a JSON object'
        USING errcode = '22023', detail = json_build_object('code','invalid_request')::text;
    END IF;

    -- IDEMPOTENCY (§15). operation_id is the key. A replay never applies twice and
    -- never mutates the stored row; a replay whose immutable context differs is an
    -- attempt to re-point an existing operation and is refused.
    --
    -- P3.7 hardening: the immutable-context comparison now covers every field the
    -- operation record treats as immutable, not just a subset -- see migration
    -- comment above for what was missing and why it mattered.
    SELECT * INTO v_existing
      FROM public.sync_operations so
     WHERE so.operation_id = v_opid;

    IF FOUND THEN
      IF v_existing.tenant_id         IS DISTINCT FROM v_tenant
         OR v_existing.actor_id       IS DISTINCT FROM p_actor
         OR v_existing.device_id      IS DISTINCT FROM p_device_id
         OR v_existing.entity_id      IS DISTINCT FROM v_entity
         OR v_existing.entity_type    IS DISTINCT FROM v_entity_type
         OR v_existing.operation_type IS DISTINCT FROM v_op_type
         OR v_existing.domain_operation IS DISTINCT FROM v_domain_op
         OR v_existing.branch_id      IS DISTINCT FROM v_branch
         OR v_existing.base_revision  IS DISTINCT FROM v_base_rev
         OR v_existing.payload        IS DISTINCT FROM v_payload THEN
        RAISE EXCEPTION 'operation replay with altered immutable context'
          USING errcode = '42501', detail = json_build_object('code','insufficient_role')::text;
      END IF;

      -- Genuine replay (ALREADY_APPLIED, P3.7 item 3): the mutation ran exactly
      -- once, on the first call. `status` reports what actually happened and
      -- `replayed:true` distinguishes this call from that one. No separate
      -- 'ALREADY_APPLIED' status value is introduced -- conflating "was this
      -- call a replay" (a property of the request) into the operation's own
      -- lifecycle status (a property of the operation) would let one operation
      -- carry two different notions of truth.
      v_results := v_results || jsonb_build_object(
        'operation_id', v_opid,
        'tenant_id',    v_existing.tenant_id,
        'status',       v_existing.status,
        'error_code',   v_existing.error_code,
        'result',       v_existing.result,
        'replayed',     true);
      CONTINUE;
    END IF;

    -- FULL-CONTEXT AUTHORIZATION (§5), against the OPERATION's organization.
    IF NOT public.is_member_of(p_actor, v_tenant) THEN
      RAISE EXCEPTION 'actor has no live membership in the operation organization'
        USING errcode = '42501', detail = json_build_object('code','insufficient_role')::text;
    END IF;

    IF NOT public.is_authorized_for_branch(p_actor, v_tenant, v_branch) THEN
      RAISE EXCEPTION 'actor is not authorized for the operation branch'
        USING errcode = '42501', detail = json_build_object('code','insufficient_role')::text;
    END IF;

    -- REVISION / CONCURRENCY (§16). A stale base revision is recorded as a
    -- CONFLICT and preserved; the server's authoritative state is never
    -- overwritten, and the operation is never silently discarded.
    SELECT max(sc.revision) INTO v_current_rev
      FROM public.sync_changes sc
     WHERE sc.entity_id = v_entity;

    IF v_base_rev IS NOT NULL AND v_current_rev IS NOT NULL AND v_base_rev < v_current_rev THEN
      v_status   := 'CONFLICT';
      v_err_code := 'stale_revision';
    ELSE
      v_status   := 'PENDING';
      v_err_code := NULL;
    END IF;

    INSERT INTO public.sync_operations (
      operation_id, tenant_id, branch_id, device_id, actor_id,
      entity_type, entity_id, operation_type, domain_operation, base_revision,
      client_sequence, device_created_at, received_at, status, error_code, payload, result)
    VALUES (
      v_opid,
      v_tenant,        -- destination: from the operation, never recomputed (§7)
      v_branch,
      p_device_id,
      p_actor,         -- from the authenticated device relationship (§10)
      v_entity_type, v_entity, v_op_type, v_domain_op, v_base_rev,
      v_client_seq,
      v_created,       -- device event time, client-controlled (§17)
      now(),           -- server receipt time, server-controlled (§17)
      v_status, v_err_code,
      v_payload,
      '{}'::jsonb);

    -- P3.7 fix (item 3): re-read the row after INSERT, because
    -- sync_operations_dispatch (AFTER INSERT ... WHEN status IN
    -- ('PENDING','CONFLICT')) has already run synchronously by this point and
    -- may have moved status to APPLIED/REJECTED. v_status/v_err_code are
    -- pre-dispatch snapshots and must not be used for the response.
    SELECT status, error_code, result INTO v_final_status, v_final_err, v_final_result
      FROM public.sync_operations WHERE operation_id = v_opid;

    v_results := v_results || jsonb_build_object(
      'operation_id',     v_opid,
      'tenant_id',        v_tenant,
      'status',           v_final_status,
      'error_code',       v_final_err,
      'result',           v_final_result,
      'server_revision',  v_current_rev,
      'replayed',         false);
  END LOOP;

  RETURN jsonb_build_object('results', v_results);
END;
$function$;

CREATE OR REPLACE FUNCTION public.recalculate_ticket_totals()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_order uuid := coalesce(new.ticket_id, old.ticket_id);
begin
  -- total_amount is generated, so only the subtotal is written here; the
  -- invariant total = subtotal - discount + tax cannot drift.
  update public.tickets o
     set subtotal_amount = coalesce(
           (select sum(oi.line_total) from public.ticket_items oi where oi.ticket_id = v_order), 0)
   where o.id = v_order;

  return null;
end $function$;

CREATE OR REPLACE FUNCTION public.reconcile_driver_trip(p_trip_id uuid, p_physical_cash numeric, p_variance_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant uuid := public.current_tenant_id();
  v_trip public.driver_trips;
  v_expected numeric(19,4);
  v_variance numeric(19,4);
begin
  if not public.has_role(array['owner','admin','branch_manager','supervisor']) then
    raise exception 'insufficient_role: trip reconciliation requires management'
      using errcode = 'P0001', detail = json_build_object('code', 'insufficient_role')::text;
  end if;

  if p_physical_cash is null or p_physical_cash < 0 then
    raise exception 'physical cash cannot be negative'
      using errcode = 'P0001', detail = json_build_object('code', 'invalid_request')::text;
  end if;

  select * into v_trip from public.driver_trips
  where id = p_trip_id and tenant_id = v_tenant for update;

  if v_trip.id is null then
    raise exception 'trip not found'
      using errcode = 'P0001', detail = json_build_object('code', 'invalid_transition')::text;
  end if;

  if not public.has_branch_access(v_trip.branch_id) then
    raise exception 'insufficient_role: trip is outside your branch scope'
      using errcode = 'P0001', detail = json_build_object('code', 'insufficient_role')::text;
  end if;

  if v_trip.status <> 'returning' then
    raise exception 'invalid_transition: trip has not been returned yet'
      using errcode = 'P0001',
            detail = json_build_object('code', 'invalid_transition', 'from', v_trip.status)::text;
  end if;

  select coalesce(sum(p.amount), 0) into v_expected
  from public.payments p
  where p.driver_trip_id = p_trip_id and p.method = 'cash';

  v_variance := p_physical_cash - v_expected;

  if v_variance <> 0 and coalesce(btrim(p_variance_note), '') = '' then
    raise exception 'variance_note_required: the trip cash is off by %', v_variance
      using errcode = 'P0001',
            detail = json_build_object('code', 'variance_note_required',
                                       'variance', v_variance,
                                       'expected', v_expected,
                                       'physical', p_physical_cash)::text;
  end if;

  update public.driver_trips
     set status = 'reconciled',
         expected_cash = v_expected,
         physical_cash = p_physical_cash,
         cash_variance = v_variance,
         cash_variance_note = nullif(btrim(coalesce(p_variance_note, '')), ''),
         reconciled_by = auth.uid(),
         reconciled_at = now()
   where id = p_trip_id
  returning * into v_trip;

  return jsonb_build_object('trip', to_jsonb(v_trip), 'expected_cash', v_expected, 'variance', v_variance);
end
$function$;

CREATE OR REPLACE FUNCTION public.record_payment(p_order_id uuid, p_amount numeric, p_method text, p_reference text DEFAULT NULL::text, p_cash_session_id uuid DEFAULT NULL::uuid, p_driver_trip_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_order public.tickets;
  v_session public.cash_sessions;
  v_trip public.driver_trips;
  v_payment public.payments;
  v_invoice uuid;
BEGIN
  IF NOT public.has_role(ARRAY['owner','admin','branch_manager','cashier','driver']) THEN
    RAISE EXCEPTION 'insufficient_role: recording payments requires owner, admin, branch manager, cashier, or driver'
      USING errcode='P0001', detail=json_build_object('code','insufficient_role')::text;
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'payment amount must be greater than zero';
  END IF;

  IF p_method NOT IN ('cash','card','transfer','pos') THEN
    RAISE EXCEPTION 'invalid payment method';
  END IF;

  IF p_cash_session_id IS NOT NULL AND p_driver_trip_id IS NOT NULL THEN
    RAISE EXCEPTION 'a payment cannot reference both a till session and a driver trip'
      USING errcode='P0001', detail=json_build_object('code','invalid_request')::text;
  END IF;

  SELECT * INTO v_order
  FROM public.tickets
  WHERE id = p_order_id AND tenant_id = v_tenant
  FOR UPDATE;

  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'order not found';
  END IF;

  IF NOT public.has_branch_access(v_order.branch_id) THEN
    RAISE EXCEPTION 'insufficient_role: order is outside your branch scope'
      USING errcode='P0001', detail=json_build_object('code','insufficient_role')::text;
  END IF;

  IF v_order.status = 'cancelled' THEN
    RAISE EXCEPTION 'cannot take payment on a cancelled order';
  END IF;

  IF p_driver_trip_id IS NOT NULL THEN
    -- AD-018: driver trip cash custody, distinct from branch till custody. This branch
    -- never touches cash_sessions -- close_cash_session() must not see this payment
    -- until the trip is completed and settled into a session explicitly.
    SELECT * INTO v_trip FROM public.driver_trips
    WHERE id = p_driver_trip_id AND tenant_id = v_tenant FOR UPDATE;

    IF v_trip.id IS NULL THEN
      RAISE EXCEPTION 'driver trip not found'
        USING errcode='P0001', detail=json_build_object('code','invalid_request')::text;
    END IF;

    IF v_trip.status <> 'in_transit' THEN
      RAISE EXCEPTION 'invalid_transition: driver trip is not in transit'
        USING errcode='P0001',
              detail=json_build_object('code','invalid_transition','from',v_trip.status)::text;
    END IF;

    IF v_trip.driver_id <> auth.uid() AND NOT public.has_role(ARRAY['owner','admin','branch_manager']) THEN
      RAISE EXCEPTION 'insufficient_role: only the trip''s own driver or a manager may record its payments'
        USING errcode='P0001', detail=json_build_object('code','insufficient_role')::text;
    END IF;

    IF v_order.driver_trip_id IS DISTINCT FROM p_driver_trip_id THEN
      RAISE EXCEPTION 'order is not linked to this driver trip'
        USING errcode='P0001', detail=json_build_object('code','invalid_request')::text;
    END IF;
  ELSIF p_method = 'cash' THEN
    IF p_cash_session_id IS NULL THEN
      SELECT * INTO v_session
      FROM public.cash_sessions
      WHERE tenant_id = v_tenant
        AND branch_id = v_order.branch_id
        AND status = 'open'
      FOR UPDATE;
    ELSE
      SELECT * INTO v_session
      FROM public.cash_sessions
      WHERE id = p_cash_session_id
        AND tenant_id = v_tenant
      FOR UPDATE;
    END IF;

    IF v_session.id IS NULL OR v_session.status <> 'open' THEN
      RAISE EXCEPTION 'cash payments require an open till session at this branch';
    END IF;

    IF v_session.branch_id <> v_order.branch_id THEN
      RAISE EXCEPTION 'the till session belongs to a different branch';
    END IF;
  ELSIF p_cash_session_id IS NOT NULL THEN
    RAISE EXCEPTION 'cash session can only be attached to cash payments';
  END IF;

  SELECT id INTO v_invoice
  FROM public.invoices
  WHERE ticket_id = p_order_id AND tenant_id = v_tenant
  LIMIT 1;

  INSERT INTO public.payments
    (tenant_id, branch_id, ticket_id, invoice_id, cash_session_id, driver_trip_id,
     amount, method, reference, created_by)
  VALUES
    (v_tenant, v_order.branch_id, p_order_id, v_invoice, v_session.id, v_trip.id,
     p_amount, p_method, NULLIF(btrim(p_reference), ''), auth.uid())
  RETURNING * INTO v_payment;

  PERFORM public.log_audit_event(
    v_tenant, 'payment', v_payment.id, 'insert', NULL, to_jsonb(v_payment)
  );

  RETURN jsonb_build_object('payment', to_jsonb(v_payment));
END;
$function$;

CREATE OR REPLACE FUNCTION public.record_refund(p_payment_id uuid, p_amount numeric, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_payment public.payments;
  v_refund public.refunds;
  v_refunded numeric;
BEGIN
  IF NOT public.has_role(ARRAY['owner','admin','branch_manager']) THEN
    RAISE EXCEPTION 'insufficient_role';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'refund amount must be greater than zero';
  END IF;
  IF NULLIF(btrim(p_reason), '') IS NULL OR length(p_reason) > 1000 THEN
    RAISE EXCEPTION 'refund reason is required and must be <= 1000 characters';
  END IF;

  SELECT * INTO v_payment
  FROM public.payments
  WHERE id = p_payment_id AND tenant_id = v_tenant
  FOR UPDATE;

  IF v_payment.id IS NULL THEN
    RAISE EXCEPTION 'payment not found';
  END IF;

  IF NOT public.has_branch_access(v_payment.branch_id) THEN
    RAISE EXCEPTION 'insufficient_role: payment is outside your branch scope'
      USING errcode='P0001', detail=json_build_object('code','insufficient_role')::text;
  END IF;

  SELECT COALESCE(sum(amount),0) INTO v_refunded
  FROM public.refunds
  WHERE payment_id = p_payment_id AND tenant_id = v_tenant;

  IF v_refunded + p_amount > v_payment.amount THEN
    RAISE EXCEPTION 'refund exceeds refundable payment balance';
  END IF;

  INSERT INTO public.refunds
    (tenant_id, branch_id, payment_id, amount, reason, created_by)
  VALUES
    (v_tenant, v_payment.branch_id, v_payment.id, p_amount, btrim(p_reason), auth.uid())
  RETURNING * INTO v_refund;

  PERFORM public.log_audit_event(
    v_tenant, 'refund', v_refund.id, 'insert', NULL, to_jsonb(v_refund)
  );

  RETURN jsonb_build_object('refund', to_jsonb(v_refund));
END;
$function$;

-- AD-022-scoped (2026-09-01): 'product'|'product_category'|'product_variant' only, not
-- 'ingredient'/'recipe' — see BLOCKERS.md BLOCKER-010(c) and migration
-- 20260901200000_add_archive_restore_catalog_entity_rpcs.sql for the full rationale.
CREATE OR REPLACE FUNCTION public.restore_catalog_entity(p_entity_type text, p_entity_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant_id uuid;
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required'
      USING errcode='28000', detail = json_build_object('code','session_expired')::text;
  END IF;
  IF NOT public.has_permission('products.manage', NULL) THEN
    RAISE EXCEPTION 'only Owner, Admin, or Branch Manager may restore catalog entities'
      USING errcode='42501', detail = json_build_object('code','insufficient_role')::text;
  END IF;
  IF p_entity_type NOT IN ('product','product_category','product_variant') THEN
    RAISE EXCEPTION 'unsupported entity_type: % (ingredient/recipe entities are not restorable through this RPC)', p_entity_type
      USING errcode='22023', detail = json_build_object('code','invalid_request')::text;
  END IF;

  IF p_entity_type = 'product' THEN
    UPDATE public.products
       SET deleted_at = NULL, deleted_by = NULL
     WHERE id = p_entity_id AND tenant_id = public.current_tenant_id() AND deleted_at IS NOT NULL
     RETURNING tenant_id, to_jsonb(products.*) INTO v_tenant_id, v_result;
  ELSIF p_entity_type = 'product_category' THEN
    UPDATE public.product_categories
       SET deleted_at = NULL, deleted_by = NULL
     WHERE id = p_entity_id AND tenant_id = public.current_tenant_id() AND deleted_at IS NOT NULL
     RETURNING tenant_id, to_jsonb(product_categories.*) INTO v_tenant_id, v_result;
  ELSIF p_entity_type = 'product_variant' THEN
    UPDATE public.product_variants
       SET deleted_at = NULL, deleted_by = NULL
     WHERE id = p_entity_id AND tenant_id = public.current_tenant_id() AND deleted_at IS NOT NULL
     RETURNING tenant_id, (to_jsonb(product_variants.*) || jsonb_build_object('unit_price', unit_price::text))
       INTO v_tenant_id, v_result;
  END IF;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION '% not found or not archived', p_entity_type
      USING errcode='P0001', detail = json_build_object('code','invalid_transition')::text;
  END IF;

  PERFORM public.log_audit_event(
    v_tenant_id, p_entity_type, p_entity_id, 'update',
    jsonb_build_object('deleted_at', 'was_deleted'),
    jsonb_build_object('deleted_at', null));

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.return_driver_trip(p_trip_id uuid, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant uuid := public.current_tenant_id();
  v_trip public.driver_trips;
  v_source uuid;
  v_item jsonb;
  v_item_type text;
  v_item_id uuid;
  v_qty numeric(18,4);
  v_moves jsonb := '[]'::jsonb;
  v_move public.stock_movements;
begin
  select * into v_trip from public.driver_trips
  where id = p_trip_id and tenant_id = v_tenant for update;

  if v_trip.id is null then
    raise exception 'trip not found'
      using errcode = 'P0001', detail = json_build_object('code', 'invalid_transition')::text;
  end if;

  if v_trip.driver_id <> auth.uid() then
    raise exception 'insufficient_role: only the trip''s own driver may record a return'
      using errcode = 'P0001', detail = json_build_object('code', 'insufficient_role')::text;
  end if;

  if v_trip.status <> 'in_transit' then
    raise exception 'invalid_transition: trip is not in transit'
      using errcode = 'P0001',
            detail = json_build_object('code', 'invalid_transition', 'from', v_trip.status)::text;
  end if;

  select id into v_source from public.warehouses
  where tenant_id = v_tenant and branch_id = v_trip.branch_id and is_default limit 1;

  if v_source is null then
    raise exception 'no default warehouse for this branch'
      using errcode = 'P0001', detail = json_build_object('code', 'invalid_request')::text;
  end if;

  -- Zero returned items is legal (a driver may sell everything).
  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_item_type := v_item ->> 'item_type';
    v_item_id := (v_item ->> 'item_id')::uuid;
    v_qty := (v_item ->> 'quantity')::numeric(18,4);

    if v_item_type not in ('ingredient','product') or v_qty is null or v_qty <= 0 then
      raise exception 'invalid return item: %', v_item
        using errcode = 'P0001', detail = json_build_object('code', 'invalid_request')::text;
    end if;

    insert into public.stock_movements
      (tenant_id, branch_id, warehouse_id, item_type, ingredient_id, product_variant_id,
       quantity_delta, reason, reference_type, reference_id, created_by)
    values
      (v_tenant, v_trip.branch_id, v_trip.warehouse_id, v_item_type,
       case when v_item_type = 'ingredient' then v_item_id end,
       case when v_item_type = 'product' then v_item_id end,
       -v_qty, 'transfer_out', 'driver_trip', p_trip_id, auth.uid())
    returning * into v_move;
    v_moves := v_moves || to_jsonb(v_move);

    insert into public.stock_movements
      (tenant_id, branch_id, warehouse_id, item_type, ingredient_id, product_variant_id,
       quantity_delta, reason, reference_type, reference_id, created_by)
    values
      (v_tenant, v_trip.branch_id, v_source, v_item_type,
       case when v_item_type = 'ingredient' then v_item_id end,
       case when v_item_type = 'product' then v_item_id end,
       v_qty, 'transfer_in', 'driver_trip', p_trip_id, auth.uid())
    returning * into v_move;
    v_moves := v_moves || to_jsonb(v_move);
  end loop;

  update public.driver_trips
     set status = 'returning', returned_at = now()
   where id = p_trip_id
  returning * into v_trip;

  return jsonb_build_object('trip', to_jsonb(v_trip), 'movements', v_moves);
end
$function$;

CREATE OR REPLACE FUNCTION public.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_active_organization(p_tenant_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'authentication required'
      USING errcode = '28000',
            detail  = json_build_object('code', 'insufficient_role')::text;
  END IF;

  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'organization is required'
      USING errcode = '22023',
            detail  = json_build_object('code', 'invalid_transition')::text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.id = v_user AND p.status = 'active' AND p.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'profile is not active'
      USING errcode = '42501',
            detail  = json_build_object('code', 'insufficient_role')::text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles ur
     WHERE ur.profile_id = v_user
       AND ur.tenant_id  = p_tenant_id
       AND ur.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'not a member of this organization'
      USING errcode = '42501',
            detail  = json_build_object('code', 'insufficient_role')::text;
  END IF;

  -- Only this column changes. No ticket, customer, branch assignment or queued
  -- sync operation is touched: the organization of an existing operation is
  -- immutable once created.
  UPDATE public.profiles
     SET active_tenant_id = p_tenant_id
   WHERE id = v_user;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  new.updated_at := now();
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.start_driver_trip(p_branch_id uuid, p_warehouse_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant uuid := public.current_tenant_id();
  v_wh public.warehouses;
  v_trip public.driver_trips;
begin
  if not public.has_role(array['driver']) then
    raise exception 'insufficient_role: only a driver may start a trip'
      using errcode = 'P0001', detail = json_build_object('code', 'insufficient_role')::text;
  end if;

  if not public.has_branch_access(p_branch_id) then
    raise exception 'insufficient_role: branch access denied'
      using errcode = 'P0001', detail = json_build_object('code', 'insufficient_role')::text;
  end if;

  select * into v_wh from public.warehouses
  where id = p_warehouse_id and tenant_id = v_tenant and branch_id = p_branch_id;

  if v_wh.id is null then
    raise exception 'warehouse not found at this branch'
      using errcode = 'P0001', detail = json_build_object('code', 'invalid_request')::text;
  end if;

  begin
    insert into public.driver_trips (tenant_id, branch_id, driver_id, warehouse_id, created_by)
    values (v_tenant, p_branch_id, auth.uid(), p_warehouse_id, auth.uid())
    returning * into v_trip;
  exception when unique_violation then
    raise exception 'trip_already_active: you already have an active trip'
      using errcode = 'P0001', detail = json_build_object('code', 'trip_already_active')::text;
  end;

  perform public.log_audit_event(v_tenant, 'driver_trip', v_trip.id, 'insert', null, to_jsonb(v_trip));

  return jsonb_build_object('trip', to_jsonb(v_trip));
end
$function$;

CREATE OR REPLACE FUNCTION public.sync_pull(p_device_id uuid, p_cursor bigint DEFAULT 0, p_page_size integer DEFAULT 200)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_page_size   int := LEAST(GREATEST(coalesce(p_page_size, 200), 1), 500);
  v_changes     jsonb;
  v_next_cursor bigint;
  v_has_more    boolean;
  v_max_visible bigint;
BEGIN
  -- Fixed 2026-09-02 (migration fix_db_lint_warnings_array_literals_and_unused_var,
  -- audit-findings/SECURITY-AUDIT-2026-09-02.md): sync_validate_device()'s return value
  -- (owning user_id) was captured but never read -- called for its validation side effect
  -- only (raises on an invalid/revoked device); RLS does the row-filtering, not this value.
  PERFORM public.sync_validate_device(p_device_id);

  IF p_cursor IS NOT NULL AND p_cursor < 0 THEN
    RAISE EXCEPTION 'cursor must not be negative'
      USING errcode = '22023', detail = json_build_object('code','invalid_request')::text;
  END IF;

  -- RLS on sync_changes (tenant-scoped, forced) determines what is "visible"
  -- here; this function is SECURITY INVOKER so the caller's own row
  -- visibility applies to both this max() and the page query below.
  SELECT max(sequence_id) INTO v_max_visible FROM public.sync_changes;

  IF coalesce(p_cursor, 0) > coalesce(v_max_visible, 0) THEN
    RETURN jsonb_build_object(
      'changes', '[]'::jsonb,
      'next_cursor', coalesce(v_max_visible, 0),
      'has_more', false,
      'full_resync_required', true
    );
  END IF;

  SELECT coalesce(jsonb_agg(to_jsonb(page) ORDER BY page.sequence_id), '[]'::jsonb),
         max(page.sequence_id)
    INTO v_changes, v_next_cursor
  FROM (
    SELECT * FROM public.sync_changes
     WHERE sequence_id > coalesce(p_cursor, 0)
     ORDER BY sequence_id ASC
     LIMIT v_page_size
  ) page;

  SELECT EXISTS (
    SELECT 1 FROM public.sync_changes WHERE sequence_id > coalesce(v_next_cursor, p_cursor, 0)
  ) INTO v_has_more;

  RETURN jsonb_build_object(
    'changes', v_changes,
    'next_cursor', coalesce(v_next_cursor, p_cursor, 0),
    'has_more', coalesce(v_has_more, false),
    'full_resync_required', false
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.sync_validate_device(p_device_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user  uuid := auth.uid();
  v_owner uuid;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'authentication required'
      USING errcode = '28000',
            detail  = json_build_object('code','insufficient_role')::text;
  END IF;

  SELECT d.user_id INTO v_owner
    FROM public.sync_devices d
   WHERE d.id = p_device_id
     AND d.user_id = v_user
     AND d.revoked_at IS NULL;

  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'device is invalid, not owned by the caller, or revoked'
      USING errcode = '42501',
            detail  = json_build_object('code','insufficient_role')::text;
  END IF;

  RETURN v_owner;
END;
$function$;

CREATE OR REPLACE FUNCTION public.transition_delivery(p_delivery_id uuid, p_to_status text, p_proof_url text DEFAULT NULL::text, p_recipient_name text DEFAULT NULL::text, p_reason text DEFAULT NULL::text, p_driver_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant   uuid := public.current_tenant_id();
  v_delivery public.deliveries;
  v_order    public.tickets;
begin
  select * into v_delivery from public.deliveries
  where id = p_delivery_id and tenant_id = v_tenant for update;

  if v_delivery.id is null then
    raise exception 'delivery not found'
      using errcode = 'P0001', detail = json_build_object('code', 'invalid_transition')::text;
  end if;

  if p_to_status = 'assigned' then
    if p_driver_id is null then
      raise exception 'assigning a delivery requires a driver'
        using errcode = 'P0001', detail = json_build_object('code', 'invalid_transition')::text;
    end if;
    -- The assignee must actually hold the driver role in this tenant.
    if not exists (
      select 1 from public.user_roles ur
      join public.roles r on r.id = ur.role_id
      where ur.profile_id = p_driver_id and ur.tenant_id = v_tenant and r.key = 'driver'
    ) then
      raise exception 'insufficient_role: that user is not a driver'
        using errcode = 'P0001', detail = json_build_object('code', 'insufficient_role')::text;
    end if;
  end if;

  if p_to_status = 'in_transit' then
    select * into v_order from public.tickets where id = v_delivery.ticket_id;
    if v_order.status <> 'ready' then
      raise exception 'invalid_transition: the order is % and is not ready to dispatch', v_order.status
        using errcode = 'P0001',
              detail = json_build_object('code', 'invalid_transition',
                                         'order_status', v_order.status)::text;
    end if;
  end if;

  -- guard_delivery_transition() validates legality and driver scoping.
  update public.deliveries
     set driver_id      = coalesce(p_driver_id, driver_id),
         proof_url      = coalesce(p_proof_url, proof_url),
         recipient_name = coalesce(p_recipient_name, recipient_name),
         failure_reason = case when p_to_status = 'failed'
                               then btrim(coalesce(p_reason, '')) else failure_reason end,
         status         = p_to_status
   where id = p_delivery_id
  returning * into v_delivery;

  return jsonb_build_object('delivery', to_jsonb(v_delivery));
end $function$;

CREATE OR REPLACE FUNCTION public.trg_dispatch_sync_operation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.apply_sync_operation(NEW.operation_id);
  RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION public.update_delivery_details(p_delivery_id uuid, p_address_line text DEFAULT NULL::text, p_contact_phone text DEFAULT NULL::text, p_scheduled_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_before public.deliveries;
  v_delivery public.deliveries;
BEGIN
  IF NOT public.has_role(ARRAY['owner','admin','branch_manager','cashier']) THEN
    RAISE EXCEPTION 'insufficient_role'
      USING errcode = 'P0001', detail = json_build_object('code', 'insufficient_role')::text;
  END IF;

  SELECT * INTO v_before
  FROM public.deliveries
  WHERE id = p_delivery_id AND tenant_id = v_tenant
  FOR UPDATE;

  IF v_before.id IS NULL THEN
    RAISE EXCEPTION 'delivery not found'
      USING errcode = 'P0001', detail = json_build_object('code', 'invalid_transition')::text;
  END IF;

  UPDATE public.deliveries
  SET address_line = COALESCE(p_address_line, address_line),
      contact_phone = COALESCE(p_contact_phone, contact_phone),
      scheduled_at = COALESCE(p_scheduled_at, scheduled_at)
  WHERE id = p_delivery_id
  RETURNING * INTO v_delivery;

  IF v_delivery.address_line IS DISTINCT FROM v_before.address_line
     OR v_delivery.contact_phone IS DISTINCT FROM v_before.contact_phone
     OR v_delivery.scheduled_at IS DISTINCT FROM v_before.scheduled_at THEN
    PERFORM public.log_audit_event(
      v_tenant, 'delivery', v_delivery.id, 'update',
      jsonb_build_object('address_line', v_before.address_line, 'contact_phone', v_before.contact_phone,
                          'scheduled_at', v_before.scheduled_at),
      jsonb_build_object('address_line', v_delivery.address_line, 'contact_phone', v_delivery.contact_phone,
                          'scheduled_at', v_delivery.scheduled_at));
  END IF;

  RETURN jsonb_build_object('delivery', to_jsonb(v_delivery));
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_invoice_due_at(p_invoice_id uuid, p_due_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_invoice public.invoices;
  v_tenant uuid := public.current_tenant_id();
BEGIN
  IF NOT public.has_role(ARRAY['owner','admin','accountant']) THEN
    RAISE EXCEPTION 'insufficient_role';
  END IF;

  UPDATE public.invoices
  SET due_at = p_due_at
  WHERE id = p_invoice_id AND tenant_id = v_tenant
  RETURNING * INTO v_invoice;

  IF v_invoice.id IS NULL THEN
    RAISE EXCEPTION 'invoice not found';
  END IF;

  RETURN jsonb_build_object('invoice', to_jsonb(v_invoice));
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_ticket(p_order_id uuid, p_customer_id uuid DEFAULT NULL::uuid, p_fulfilment_type text DEFAULT NULL::text, p_due_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_discount_amount numeric DEFAULT NULL::numeric, p_tax_amount numeric DEFAULT NULL::numeric, p_assigned_to uuid DEFAULT NULL::uuid, p_status text DEFAULT NULL::text, p_cancelled_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_order public.tickets;
  v_manager boolean := public.has_role(ARRAY['owner','admin','branch_manager']);
  v_cashier boolean := public.has_role(ARRAY['cashier']);
  v_baker   boolean := public.has_role(ARRAY['baker']);
BEGIN
  SELECT * INTO v_order
  FROM public.tickets
  WHERE id = p_order_id
    AND tenant_id = v_tenant
  FOR UPDATE;

  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'order not found';
  END IF;

  IF NOT public.has_branch_access(v_order.branch_id) THEN
    RAISE EXCEPTION 'insufficient_role: order is outside your branch scope'
      USING errcode='P0001', detail=json_build_object('code','insufficient_role')::text;
  END IF;

  IF NOT v_manager AND NOT v_cashier AND NOT v_baker THEN
    RAISE EXCEPTION 'insufficient_role';
  END IF;

  -- Pricing, assignment, and cancellation stay manager-only regardless of caller role.
  -- p_status is deliberately NOT gated here (previously it was, alongside these): the
  -- guard_ticket_status_transition() trigger already enforces the exact per-transition
  -- actor list documented in STATE-MACHINES.md (owner/admin/branch_manager/cashier for
  -- most hops, +baker for in_production/ready, manager-only for cancelled/archived), and
  -- is the single source of truth for that matrix. Re-implementing a coarser check here
  -- previously blocked cashiers from ever advancing a ticket through this RPC and blocked
  -- bakers from calling it at all, contradicting the approved role table.
  IF NOT v_manager AND (
       p_discount_amount IS NOT NULL OR
       p_tax_amount IS NOT NULL OR
       p_assigned_to IS NOT NULL OR
       p_cancelled_reason IS NOT NULL
     ) THEN
    RAISE EXCEPTION 'only managers may change pricing, assignment, or cancellation';
  END IF;

  -- Bakers may use this RPC only to move a ticket through production — never to edit
  -- customer, fulfilment, or scheduling details, which stay cashier/manager territory.
  IF v_baker AND NOT v_manager AND NOT v_cashier AND (
       p_customer_id IS NOT NULL OR
       p_fulfilment_type IS NOT NULL OR
       p_due_at IS NOT NULL
     ) THEN
    RAISE EXCEPTION 'bakers may only change ticket status';
  END IF;

  IF p_status = 'cancelled' AND NOT v_manager THEN
    RAISE EXCEPTION 'only managers may cancel tickets';
  END IF;

  IF p_assigned_to IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.user_roles ur
      JOIN public.roles r ON r.id = ur.role_id
      WHERE ur.profile_id = p_assigned_to
        AND ur.tenant_id = v_tenant
        AND ur.deleted_at IS NULL
        AND r.key = 'driver'
        AND r.deleted_at IS NULL
        AND (ur.branch_id IS NULL OR ur.branch_id = v_order.branch_id)
    ) THEN
      RAISE EXCEPTION 'assigned staff member is not a driver for this branch';
    END IF;
  END IF;

  UPDATE public.tickets
  SET customer_id      = COALESCE(p_customer_id, customer_id),
      fulfilment_type  = COALESCE(p_fulfilment_type, fulfilment_type),
      due_at           = COALESCE(p_due_at, due_at),
      discount_amount  = CASE WHEN v_manager THEN COALESCE(p_discount_amount, discount_amount) ELSE discount_amount END,
      tax_amount       = CASE WHEN v_manager THEN COALESCE(p_tax_amount, tax_amount) ELSE tax_amount END,
      assigned_to      = CASE WHEN v_manager THEN COALESCE(p_assigned_to, assigned_to) ELSE assigned_to END,
      status           = COALESCE(p_status, status),
      cancelled_reason = CASE WHEN v_manager AND p_status = 'cancelled' THEN NULLIF(btrim(p_cancelled_reason), '') ELSE cancelled_reason END
  WHERE id = p_order_id
  RETURNING * INTO v_order;

  RETURN jsonb_build_object('ticket', to_jsonb(v_order));
END;
$function$;

CREATE OR REPLACE FUNCTION public.verify_money_columns()
 RETURNS TABLE(table_name text, column_name text, actual_type text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select c.table_name::text,
         c.column_name::text,
         c.data_type || coalesce('(' || c.numeric_precision || ',' || c.numeric_scale || ')', '')
  from information_schema.columns c
  join pg_class     pc on pc.relname = c.table_name
  join pg_namespace pn on pn.oid = pc.relnamespace and pn.nspname = 'public'
  where c.table_schema = 'public'
    and pc.relkind = 'r'
    and (c.column_name like '%amount%' or c.column_name like '%price%'
         or c.column_name like '%total%' or c.column_name like '%cost%'
         or c.column_name like '%float%')
    and (c.data_type <> 'numeric' or c.numeric_precision <> 19 or c.numeric_scale <> 4);
$function$;

CREATE OR REPLACE FUNCTION public.verify_quantity_columns()
 RETURNS TABLE(table_name text, column_name text, actual_type text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select c.table_name::text,
         c.column_name::text,
         c.data_type || coalesce('(' || c.numeric_precision || ',' || c.numeric_scale || ')', '')
  from information_schema.columns c
  join pg_class     pc on pc.relname = c.table_name
  join pg_namespace pn on pn.oid = pc.relnamespace and pn.nspname = 'public'
  where c.table_schema = 'public'
    and pc.relkind = 'r'
    and c.column_name like '%quantity%'
    and (c.data_type <> 'numeric' or c.numeric_precision <> 18 or c.numeric_scale <> 4);
$function$;

CREATE OR REPLACE FUNCTION public.verify_rls_coverage()
 RETURNS TABLE(table_name text, problem text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select c.relname::text,
         case
           when not c.relrowsecurity      then 'RLS not enabled'
           when not c.relforcerowsecurity then 'RLS not forced (table owner is exempt)'
           else 'no policies defined (deny-all, almost certainly unintended)'
         end
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
    and (
      not c.relrowsecurity
      or not c.relforcerowsecurity
      or not exists (select 1 from pg_policy p where p.polrelid = c.oid)
    );
$function$;

CREATE OR REPLACE FUNCTION public.verify_stock_reconciliation()
 RETURNS TABLE(item_type text, warehouse_id uuid, item_id uuid, quantity_on_hand numeric, ledger_total numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select 'ingredient'::text, l.warehouse_id, l.ingredient_id,
         l.quantity_on_hand, coalesce(m.total, 0)
  from public.ingredient_stock_levels l
  left join (
    select warehouse_id, ingredient_id, sum(quantity_delta) as total
    from public.stock_movements
    where item_type = 'ingredient'
    group by 1, 2
  ) m on m.warehouse_id = l.warehouse_id and m.ingredient_id = l.ingredient_id
  where l.quantity_on_hand <> coalesce(m.total, 0)

  union all

  select 'product'::text, l.warehouse_id, l.product_variant_id,
         l.quantity_on_hand, coalesce(m.total, 0)
  from public.product_stock_levels l
  left join (
    select warehouse_id, product_variant_id, sum(quantity_delta) as total
    from public.stock_movements
    where item_type = 'product'
    group by 1, 2
  ) m on m.warehouse_id = l.warehouse_id and m.product_variant_id = l.product_variant_id
  where l.quantity_on_hand <> coalesce(m.total, 0);
$function$;

CREATE OR REPLACE FUNCTION public.verify_tenant_columns()
 RETURNS TABLE(table_name text, problem text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- Wrong type, or nullable where it must not be.
  select c.table_name::text,
         case when c.data_type <> 'uuid' then 'tenant_id is ' || c.data_type
              else 'tenant_id is nullable' end
  from information_schema.columns c
  join pg_class     pc on pc.relname = c.table_name
  join pg_namespace pn on pn.oid = pc.relnamespace and pn.nspname = 'public'
  where c.table_schema = 'public'
    and pc.relkind = 'r'
    and c.column_name = 'tenant_id'
    and c.table_name <> 'profiles'
    and (c.data_type <> 'uuid' or c.is_nullable = 'YES')

  union all

  -- Missing the foreign key to the tenant root.
  select c.table_name::text, 'tenant_id has no FK to organizations(id)'
  from information_schema.columns c
  join pg_class     pc on pc.relname = c.table_name
  join pg_namespace pn on pn.oid = pc.relnamespace and pn.nspname = 'public'
  where c.table_schema = 'public'
    and pc.relkind = 'r'
    and c.column_name = 'tenant_id'
    and not exists (
      select 1
      from pg_constraint con
      join pg_class ref on ref.oid = con.confrelid
      where con.conrelid = pc.oid
        and con.contype = 'f'
        and ref.relname = 'organizations'
        and (
          select array_agg(a.attname::text order by a.attname)
          from unnest(con.conkey) k
          join pg_attribute a on a.attrelid = pc.oid and a.attnum = k
        ) @> array['tenant_id']::text[]
    )

  union all

  -- Superseded tenant column names must never reappear (CLAUDE.md rule 2).
  select c.table_name::text, 'superseded tenant column: ' || c.column_name
  from information_schema.columns c
  join pg_class     pc on pc.relname = c.table_name
  join pg_namespace pn on pn.oid = pc.relnamespace and pn.nspname = 'public'
  where c.table_schema = 'public'
    and pc.relkind = 'r'
    and c.column_name in ('organization_id', 'bakery_id', 'company_id');
$function$;

CREATE OR REPLACE FUNCTION public.verify_trip_loading(p_trip_id uuid, p_items jsonb, p_source_warehouse_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant uuid := public.current_tenant_id();
  v_trip public.driver_trips;
  v_source uuid := p_source_warehouse_id;
  v_item jsonb;
  v_item_type text;
  v_item_id uuid;
  v_qty numeric(18,4);
  v_moves jsonb := '[]'::jsonb;
  v_move public.stock_movements;
begin
  if not public.has_role(array['owner','admin','branch_manager','supervisor','baker']) then
    raise exception 'insufficient_role: loading must be verified by a supervisor, manager, or baker'
      using errcode = 'P0001', detail = json_build_object('code', 'insufficient_role')::text;
  end if;

  select * into v_trip from public.driver_trips
  where id = p_trip_id and tenant_id = v_tenant for update;

  if v_trip.id is null then
    raise exception 'trip not found'
      using errcode = 'P0001', detail = json_build_object('code', 'invalid_transition')::text;
  end if;

  if not public.has_branch_access(v_trip.branch_id) then
    raise exception 'insufficient_role: trip is outside your branch scope'
      using errcode = 'P0001', detail = json_build_object('code', 'insufficient_role')::text;
  end if;

  if v_trip.status <> 'created' then
    raise exception 'invalid_transition: loading can only be verified on a newly created trip'
      using errcode = 'P0001',
            detail = json_build_object('code', 'invalid_transition', 'from', v_trip.status)::text;
  end if;

  -- p_source_warehouse_id, when supplied, must belong to this same tenant and branch --
  -- otherwise a caller could pull the transfer_out movement from another tenant's
  -- warehouse, corrupting that tenant's actual stock levels (ingredient_stock_levels/
  -- product_stock_levels are keyed by warehouse_id+item only, not tenant_id -- the
  -- stock_movements_guard_warehouse_tenant trigger is the backstop, this is the specific,
  -- friendly rejection before it).
  if v_source is not null then
    perform 1 from public.warehouses
    where id = v_source and tenant_id = v_tenant and branch_id = v_trip.branch_id;

    if not found then
      raise exception 'warehouse not found at this branch'
        using errcode = 'P0001', detail = json_build_object('code', 'invalid_request')::text;
    end if;
  else
    select id into v_source from public.warehouses
    where tenant_id = v_tenant and branch_id = v_trip.branch_id and is_default limit 1;
  end if;

  if v_source is null then
    raise exception 'no default warehouse for this branch; pass a source explicitly'
      using errcode = 'P0001', detail = json_build_object('code', 'invalid_request')::text;
  end if;

  if jsonb_array_length(p_items) = 0 then
    raise exception 'at least one item must be loaded'
      using errcode = 'P0001', detail = json_build_object('code', 'invalid_request')::text;
  end if;

  update public.driver_trips set status = 'loading' where id = p_trip_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_item_type := v_item ->> 'item_type';
    v_item_id := (v_item ->> 'item_id')::uuid;
    v_qty := (v_item ->> 'quantity')::numeric(18,4);

    if v_item_type not in ('ingredient','product') or v_qty is null or v_qty <= 0 then
      raise exception 'invalid load item: %', v_item
        using errcode = 'P0001', detail = json_build_object('code', 'invalid_request')::text;
    end if;

    insert into public.stock_movements
      (tenant_id, branch_id, warehouse_id, item_type, ingredient_id, product_variant_id,
       quantity_delta, reason, reference_type, reference_id, created_by)
    values
      (v_tenant, v_trip.branch_id, v_source, v_item_type,
       case when v_item_type = 'ingredient' then v_item_id end,
       case when v_item_type = 'product' then v_item_id end,
       -v_qty, 'transfer_out', 'driver_trip', p_trip_id, auth.uid())
    returning * into v_move;
    v_moves := v_moves || to_jsonb(v_move);

    insert into public.stock_movements
      (tenant_id, branch_id, warehouse_id, item_type, ingredient_id, product_variant_id,
       quantity_delta, reason, reference_type, reference_id, created_by)
    values
      (v_tenant, v_trip.branch_id, v_trip.warehouse_id, v_item_type,
       case when v_item_type = 'ingredient' then v_item_id end,
       case when v_item_type = 'product' then v_item_id end,
       v_qty, 'transfer_in', 'driver_trip', p_trip_id, auth.uid())
    returning * into v_move;
    v_moves := v_moves || to_jsonb(v_move);
  end loop;

  update public.driver_trips
     set status = 'ready_to_depart', loading_verified_by = auth.uid(), loading_verified_at = now()
   where id = p_trip_id
  returning * into v_trip;

  return jsonb_build_object('trip', to_jsonb(v_trip), 'movements', v_moves);
end
$function$;

-- Added 2026-09-02 (migration add_supervisor_permission_overrides, BLOCKER-025).
CREATE OR REPLACE FUNCTION public.set_supervisor_permission_override(
  p_profile_id uuid,
  p_permission_key text,
  p_granted boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant_id uuid;
  v_permission_id uuid;
  v_override_id uuid;
  v_result jsonb;
  v_allowed_keys text[] := ARRAY[
    'branch.view','customers.create','customers.update','customers.delete',
    'financial.audit.confirm','financial.audit.submit',
    'financial.expense.create','financial.expense.update','financial.view',
    'reports.view','staff.view',
    'tickets.create','tickets.view','tickets.correct','tickets.archive'
  ];
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required'
      USING errcode='28000', detail = json_build_object('code','session_expired')::text;
  END IF;

  v_tenant_id := public.current_tenant_id();

  IF NOT public.has_role_in(auth.uid(), v_tenant_id, ARRAY['branch_manager']) THEN
    RAISE EXCEPTION 'only a Branch Manager may set a per-supervisor permission override'
      USING errcode='42501', detail = json_build_object('code','insufficient_role')::text;
  END IF;

  IF NOT public.has_role_in(p_profile_id, v_tenant_id, ARRAY['supervisor']) THEN
    RAISE EXCEPTION 'target profile does not hold the supervisor role in this organization'
      USING errcode='P0001', detail = json_build_object('code','not_a_supervisor')::text;
  END IF;

  IF NOT (p_permission_key = ANY(v_allowed_keys)) THEN
    RAISE EXCEPTION 'permission key % is not eligible for per-supervisor override', p_permission_key
      USING errcode='42501', detail = json_build_object('code','permission_not_overridable')::text;
  END IF;

  SELECT id INTO v_permission_id
  FROM public.permissions
  WHERE key = p_permission_key AND deleted_at IS NULL;

  IF v_permission_id IS NULL THEN
    RAISE EXCEPTION 'unknown permission key: %', p_permission_key
      USING errcode='22023', detail = json_build_object('code','invalid_request')::text;
  END IF;

  IF p_granted IS NULL THEN
    UPDATE public.user_permission_overrides
       SET deleted_at = now(), deleted_by = auth.uid()
     WHERE tenant_id = v_tenant_id
       AND profile_id = p_profile_id
       AND permission_id = v_permission_id
       AND deleted_at IS NULL
     RETURNING id INTO v_override_id;

    v_result := jsonb_build_object(
      'profile_id', p_profile_id, 'permission_key', p_permission_key,
      'granted', null, 'cleared', v_override_id IS NOT NULL
    );

    IF v_override_id IS NOT NULL THEN
      PERFORM public.log_audit_event(v_tenant_id, 'user_permission_override', v_override_id, 'update',
        jsonb_build_object('granted', null),
        jsonb_build_object('cleared_at', now(), 'cleared_by', auth.uid()));
    END IF;

    RETURN v_result;
  END IF;

  INSERT INTO public.user_permission_overrides (tenant_id, profile_id, permission_id, granted, created_by)
  VALUES (v_tenant_id, p_profile_id, v_permission_id, p_granted, auth.uid())
  ON CONFLICT (tenant_id, profile_id, permission_id) WHERE deleted_at IS NULL
  DO UPDATE SET granted = EXCLUDED.granted, updated_at = now()
  RETURNING id, to_jsonb(user_permission_overrides.*) INTO v_override_id, v_result;

  PERFORM public.log_audit_event(v_tenant_id, 'user_permission_override', v_override_id, 'update',
    '{}'::jsonb, jsonb_build_object('permission_key', p_permission_key, 'granted', p_granted));

  RETURN v_result;
END;
$function$;



-- ============================================================
-- SECTION: TRIGGERS (59 total as of 2026-09-02/BLOCKER-025)
-- ============================================================

CREATE TRIGGER audit_log_immutable BEFORE DELETE OR UPDATE ON audit_log FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_mutation();
CREATE TRIGGER branch_assignments_set_updated_at BEFORE UPDATE ON branch_assignments FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER branches_set_updated_at BEFORE UPDATE ON branches FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER cash_sessions_bump_revision BEFORE UPDATE ON cash_sessions FOR EACH ROW EXECUTE FUNCTION bump_cash_session_revision();
CREATE TRIGGER cash_sessions_guard_transition BEFORE UPDATE OF status ON cash_sessions FOR EACH ROW EXECUTE FUNCTION guard_cash_session_transition();
CREATE TRIGGER cash_sessions_no_delete BEFORE DELETE ON cash_sessions FOR EACH ROW EXECUTE FUNCTION prevent_cash_session_delete();
CREATE TRIGGER cash_sessions_set_updated_at BEFORE UPDATE ON cash_sessions FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER customers_set_updated_at BEFORE UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER daily_financial_audits_guard_mutation BEFORE DELETE OR UPDATE ON daily_financial_audits FOR EACH ROW EXECUTE FUNCTION guard_daily_financial_audit_mutation();
CREATE TRIGGER daily_financial_audits_set_updated_at BEFORE UPDATE ON daily_financial_audits FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER deliveries_guard_transition BEFORE UPDATE OF status ON deliveries FOR EACH ROW EXECUTE FUNCTION guard_delivery_transition();
CREATE TRIGGER deliveries_set_updated_at BEFORE UPDATE ON deliveries FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER document_sequences_set_updated_at BEFORE UPDATE ON document_sequences FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER driver_trips_bump_revision BEFORE UPDATE ON driver_trips FOR EACH ROW EXECUTE FUNCTION bump_cash_session_revision();
CREATE TRIGGER driver_trips_guard_transition BEFORE UPDATE OF status ON driver_trips FOR EACH ROW EXECUTE FUNCTION guard_driver_trip_transition();
CREATE TRIGGER driver_trips_no_delete BEFORE DELETE ON driver_trips FOR EACH ROW EXECUTE FUNCTION prevent_driver_trip_delete();
CREATE TRIGGER driver_trips_set_updated_at BEFORE UPDATE ON driver_trips FOR EACH ROW EXECUTE FUNCTION set_updated_at();
-- 2026-09-04 (add_expenses_audit_trail): AFTER, not BEFORE like the guard trigger below --
-- this one only observes, never validates or blocks.
CREATE TRIGGER expenses_audit_trail AFTER INSERT OR UPDATE OR DELETE ON expenses FOR EACH ROW EXECUTE FUNCTION log_expense_mutation();
CREATE TRIGGER expenses_guard_cash_session BEFORE INSERT OR UPDATE ON expenses FOR EACH ROW EXECUTE FUNCTION guard_expense_cash_session();
CREATE TRIGGER expenses_set_updated_at BEFORE UPDATE ON expenses FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER ingredients_set_updated_at BEFORE UPDATE ON ingredients FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER invoices_set_updated_at BEFORE UPDATE ON invoices FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER organization_invites_set_updated_at BEFORE UPDATE ON organization_invites FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER organizations_set_updated_at BEFORE UPDATE ON organizations FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER payments_apply_to_ticket AFTER INSERT ON payments FOR EACH ROW EXECUTE FUNCTION apply_payment_to_ticket();
CREATE TRIGGER payments_guard_relationships BEFORE INSERT ON payments FOR EACH ROW EXECUTE FUNCTION guard_payment_relationships();
CREATE TRIGGER payments_immutable BEFORE DELETE OR UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION prevent_financial_mutation();
CREATE TRIGGER product_categories_set_updated_at BEFORE UPDATE ON product_categories FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER product_variants_set_updated_at BEFORE UPDATE ON product_variants FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER production_batch_ingredients_set_updated_at BEFORE UPDATE ON production_batch_ingredients FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER production_batches_assign_number BEFORE INSERT ON production_batches FOR EACH ROW EXECUTE FUNCTION assign_batch_number();
CREATE TRIGGER production_batches_copy_ingredients AFTER INSERT ON production_batches FOR EACH ROW EXECUTE FUNCTION copy_batch_planned_ingredients();
CREATE TRIGGER production_batches_guard_transition BEFORE UPDATE OF status ON production_batches FOR EACH ROW EXECUTE FUNCTION guard_production_batch_transition();
CREATE TRIGGER production_batches_set_updated_at BEFORE UPDATE ON production_batches FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER products_set_updated_at BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER profiles_set_updated_at BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_guard_profile_primary_branch BEFORE INSERT OR UPDATE OF tenant_id, primary_branch_id ON profiles FOR EACH ROW EXECUTE FUNCTION guard_profile_primary_branch();
CREATE TRIGGER recipe_ingredients_set_updated_at BEFORE UPDATE ON recipe_ingredients FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER recipes_set_updated_at BEFORE UPDATE ON recipes FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER refunds_guard_total BEFORE INSERT ON refunds FOR EACH ROW EXECUTE FUNCTION guard_refund_total();
CREATE TRIGGER refunds_immutable BEFORE DELETE OR UPDATE ON refunds FOR EACH ROW EXECUTE FUNCTION prevent_financial_mutation();
CREATE TRIGGER stock_movements_apply AFTER INSERT ON stock_movements FOR EACH ROW EXECUTE FUNCTION apply_stock_movement();
CREATE TRIGGER stock_movements_guard_warehouse_tenant BEFORE INSERT ON stock_movements FOR EACH ROW EXECUTE FUNCTION guard_stock_movement_warehouse_tenant();
CREATE TRIGGER stock_movements_immutable BEFORE DELETE OR UPDATE ON stock_movements FOR EACH ROW EXECUTE FUNCTION prevent_stock_movement_mutation();
CREATE TRIGGER sync_devices_set_updated_at BEFORE UPDATE ON sync_devices FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER sync_operations_dispatch AFTER INSERT ON sync_operations FOR EACH ROW WHEN (new.status = ANY (ARRAY['PENDING'::text, 'CONFLICT'::text])) EXECUTE FUNCTION trg_dispatch_sync_operation();
CREATE TRIGGER ticket_items_guard_mutation BEFORE INSERT OR DELETE OR UPDATE ON ticket_items FOR EACH ROW EXECUTE FUNCTION guard_ticket_item_mutation();
CREATE TRIGGER ticket_items_recalculate_totals AFTER INSERT OR DELETE OR UPDATE ON ticket_items FOR EACH ROW EXECUTE FUNCTION recalculate_ticket_totals();
CREATE TRIGGER ticket_items_set_updated_at BEFORE UPDATE ON ticket_items FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_guard_ticket_item_price BEFORE INSERT OR UPDATE OF product_variant_id, unit_price ON ticket_items FOR EACH ROW EXECUTE FUNCTION guard_order_item_price();
CREATE TRIGGER tickets_assign_number BEFORE INSERT ON tickets FOR EACH ROW EXECUTE FUNCTION assign_order_number();
CREATE TRIGGER tickets_bump_revision BEFORE UPDATE ON tickets FOR EACH ROW EXECUTE FUNCTION bump_ticket_revision();
CREATE TRIGGER tickets_guard_driver_trip_assignment BEFORE INSERT OR UPDATE OF driver_trip_id ON tickets FOR EACH ROW EXECUTE FUNCTION guard_ticket_driver_trip_assignment();
CREATE TRIGGER tickets_guard_status_transition BEFORE UPDATE OF status, subtotal_amount ON tickets FOR EACH ROW EXECUTE FUNCTION guard_ticket_status_transition();
CREATE TRIGGER tickets_set_updated_at BEFORE UPDATE ON tickets FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_guard_driver_created_ticket_assignment BEFORE INSERT ON tickets FOR EACH ROW EXECUTE FUNCTION guard_driver_created_order_assignment();
CREATE TRIGGER trg_guard_ticket_actor_assignment BEFORE INSERT OR UPDATE OF created_by, assigned_to, branch_id, tenant_id ON tickets FOR EACH ROW EXECUTE FUNCTION guard_order_actor_and_assignment();
CREATE TRIGGER trg_guard_user_role_integrity BEFORE INSERT OR UPDATE OF tenant_id, profile_id, role_id, branch_id ON user_roles FOR EACH ROW EXECUTE FUNCTION guard_user_role_integrity();
CREATE TRIGGER user_roles_set_updated_at BEFORE UPDATE ON user_roles FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER warehouses_set_updated_at BEFORE UPDATE ON warehouses FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Added 2026-09-02 (migration add_supervisor_permission_overrides, BLOCKER-025).
CREATE TRIGGER user_permission_overrides_set_updated_at BEFORE UPDATE ON user_permission_overrides FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ============================================================
-- SECTION: ROW LEVEL SECURITY ENABLE + FORCE (41 tables)
-- ============================================================

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log FORCE ROW LEVEL SECURITY;
ALTER TABLE public.branch_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.branch_assignments FORCE ROW LEVEL SECURITY;
ALTER TABLE public.branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.branches FORCE ROW LEVEL SECURITY;
ALTER TABLE public.cash_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers FORCE ROW LEVEL SECURITY;
ALTER TABLE public.daily_financial_audits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_financial_audits FORCE ROW LEVEL SECURITY;
ALTER TABLE public.deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deliveries FORCE ROW LEVEL SECURITY;
ALTER TABLE public.document_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_sequences FORCE ROW LEVEL SECURITY;
ALTER TABLE public.driver_trips ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_trips FORCE ROW LEVEL SECURITY;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses FORCE ROW LEVEL SECURITY;
ALTER TABLE public.ingredient_stock_levels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ingredient_stock_levels FORCE ROW LEVEL SECURITY;
ALTER TABLE public.ingredients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ingredients FORCE ROW LEVEL SECURITY;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices FORCE ROW LEVEL SECURITY;
ALTER TABLE public.organization_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_invites FORCE ROW LEVEL SECURITY;
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organizations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments FORCE ROW LEVEL SECURITY;
ALTER TABLE public.permanent_deletion_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permanent_deletion_challenges FORCE ROW LEVEL SECURITY;
ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permissions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.product_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_categories FORCE ROW LEVEL SECURITY;
ALTER TABLE public.product_stock_levels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_stock_levels FORCE ROW LEVEL SECURITY;
ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_variants FORCE ROW LEVEL SECURITY;
ALTER TABLE public.production_batch_ingredients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_batch_ingredients FORCE ROW LEVEL SECURITY;
ALTER TABLE public.production_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_batches FORCE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products FORCE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE public.rate_limit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rate_limit_events FORCE ROW LEVEL SECURITY;
ALTER TABLE public.recipe_ingredients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recipe_ingredients FORCE ROW LEVEL SECURITY;
ALTER TABLE public.recipes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recipes FORCE ROW LEVEL SECURITY;
ALTER TABLE public.refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.refunds FORCE ROW LEVEL SECURITY;
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_permissions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roles FORCE ROW LEVEL SECURITY;
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_movements FORCE ROW LEVEL SECURITY;
ALTER TABLE public.sync_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_changes FORCE ROW LEVEL SECURITY;
ALTER TABLE public.sync_conflicts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_conflicts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.sync_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_devices FORCE ROW LEVEL SECURITY;
ALTER TABLE public.sync_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_operations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_items FORCE ROW LEVEL SECURITY;
ALTER TABLE public.tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tickets FORCE ROW LEVEL SECURITY;
ALTER TABLE public.user_permission_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_permission_overrides FORCE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles FORCE ROW LEVEL SECURITY;
ALTER TABLE public.warehouses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.warehouses FORCE ROW LEVEL SECURITY;


-- ============================================================
-- SECTION: RLS POLICIES (105 total as of 2026-09-02/BLOCKER-025)
-- ============================================================

CREATE POLICY audit_log_select ON public.audit_log AS PERMISSIVE FOR SELECT TO authenticated
  USING (((tenant_id = current_tenant_id()) AND has_role(ARRAY['owner'::text, 'admin'::text, 'accountant'::text]) AND (deleted_at IS NULL)));

CREATE POLICY branch_assignments_delete ON public.branch_assignments AS PERMISSIVE FOR DELETE TO authenticated
  USING (((tenant_id = current_tenant_id()) AND has_role(ARRAY['owner'::text, 'admin'::text])));

CREATE POLICY branch_assignments_insert ON public.branch_assignments AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((tenant_id = current_tenant_id()) AND has_role(ARRAY['owner'::text, 'admin'::text, 'branch_manager'::text])));

CREATE POLICY branch_assignments_select ON public.branch_assignments AS PERMISSIVE FOR SELECT TO authenticated
  USING ((((profile_id = ( SELECT auth.uid() AS uid)) OR ((tenant_id = current_tenant_id()) AND has_role(ARRAY['owner'::text, 'admin'::text, 'branch_manager'::text]))) AND (deleted_at IS NULL)));

CREATE POLICY branch_assignments_update ON public.branch_assignments AS PERMISSIVE FOR UPDATE TO authenticated
  USING (((tenant_id = current_tenant_id()) AND has_role(ARRAY['owner'::text, 'admin'::text, 'branch_manager'::text])))
  WITH CHECK ((tenant_id = current_tenant_id()));

CREATE POLICY branches_insert ON public.branches AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((tenant_id = current_tenant_id()) AND has_role(ARRAY['owner'::text, 'admin'::text])));

CREATE POLICY branches_select ON public.branches AS PERMISSIVE FOR SELECT TO authenticated
  USING (((tenant_id = current_tenant_id()) AND (deleted_at IS NULL)));

CREATE POLICY branches_update ON public.branches AS PERMISSIVE FOR UPDATE TO authenticated
  USING (((tenant_id = current_tenant_id()) AND has_role(ARRAY['owner'::text, 'admin'::text])))
  WITH CHECK ((tenant_id = current_tenant_id()));

CREATE POLICY cash_sessions_insert ON public.cash_sessions AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((tenant_id = current_tenant_id()) AND has_branch_access(branch_id) AND has_role(ARRAY['owner'::text, 'admin'::text, 'branch_manager'::text, 'cashier'::text])));

CREATE POLICY cash_sessions_select ON public.cash_sessions AS PERMISSIVE FOR SELECT TO authenticated
  USING (((tenant_id = current_tenant_id()) AND has_branch_access(branch_id) AND (deleted_at IS NULL)));

CREATE POLICY cash_sessions_update ON public.cash_sessions AS PERMISSIVE FOR UPDATE TO authenticated
  USING (((tenant_id = current_tenant_id()) AND has_branch_access(branch_id) AND ((opened_by = ( SELECT auth.uid() AS uid)) OR has_role(ARRAY['owner'::text, 'admin'::text, 'branch_manager'::text]))))
  WITH CHECK (((tenant_id = current_tenant_id()) AND has_branch_access(branch_id)));

CREATE POLICY customers_delete ON public.customers AS PERMISSIVE FOR DELETE TO authenticated
  USING (((tenant_id = current_tenant_id()) AND has_role(ARRAY['owner'::text, 'admin'::text])));

CREATE POLICY customers_insert ON public.customers AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((tenant_id = current_tenant_id()) AND has_role(ARRAY['owner'::text, 'admin'::text, 'branch_manager'::text, 'cashier'::text])));

CREATE POLICY customers_select ON public.customers AS PERMISSIVE FOR SELECT TO authenticated
  USING (((tenant_id = current_tenant_id()) AND (deleted_at IS NULL)));

CREATE POLICY customers_update ON public.customers AS PERMISSIVE FOR UPDATE TO authenticated
  USING (((tenant_id = current_tenant_id()) AND has_role(ARRAY['owner'::text, 'admin'::text, 'branch_manager'::text, 'cashier'::text])))
  WITH CHECK ((tenant_id = current_tenant_id()));

-- auth.uid() wrapped in (select ...) 2026-09-03 (future-cost audit, auth_rls_initplan) --
-- semantically identical, avoids per-row re-evaluation.
CREATE POLICY daily_financial_audits_insert ON public.daily_financial_audits AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((tenant_id = current_tenant_id()) AND has_branch_access(branch_id) AND (submitted_by = (select auth.uid())) AND has_role(ARRAY['owner'::text, 'admin'::text, 'branch_manager'::text, 'cashier'::text])));

CREATE POLICY daily_financial_audits_select ON public.daily_financial_audits AS PERMISSIVE FOR SELECT TO authenticated
  USING (((tenant_id = current_tenant_id()) AND (deleted_at IS NULL) AND ((submitted_by = (select auth.uid())) OR (has_branch_access(branch_id) AND has_role(ARRAY['owner'::text, 'admin'::text, 'branch_manager'::text, 'accountant'::text])))));

CREATE POLICY daily_financial_audits_update_own_open ON public.daily_financial_audits AS PERMISSIVE FOR UPDATE TO authenticated
  USING (((tenant_id = current_tenant_id()) AND (submitted_by = (select auth.uid())) AND (status = ANY (ARRAY['DRAFT'::text, 'PENDING_SYNC'::text, 'REQUIRES_RECONCILIATION'::text])) AND (deleted_at IS NULL)))
  WITH CHECK (((tenant_id = current_tenant_id()) AND (submitted_by = (select auth.uid()))));

CREATE POLICY daily_financial_audits_update_review ON public.daily_financial_audits AS PERMISSIVE FOR UPDATE TO authenticated
  USING (((tenant_id = current_tenant_id()) AND has_branch_access(branch_id) AND has_role(ARRAY['owner'::text, 'admin'::text, 'branch_manager'::text]) AND (deleted_at IS NULL)))
  WITH CHECK ((tenant_id = current_tenant_id()));

CREATE POLICY deliveries_insert ON public.deliveries AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((tenant_id = current_tenant_id()) AND has_branch_access(branch_id) AND has_role(ARRAY['owner'::text, 'admin'::text, 'branch_manager'::text, 'cashier'::text])));

CREATE POLICY deliveries_select ON public.deliveries AS PERMISSIVE FOR SELECT TO authenticated
  USING (((tenant_id = current_tenant_id()) AND ((driver_id = ( SELECT auth.uid() AS uid)) OR has_branch_access(branch_id)) AND (deleted_at IS NULL)));

CREATE POLICY deliveries_update ON public.deliveries AS PERMISSIVE FOR UPDATE TO authenticated
  USING (((tenant_id = current_tenant_id()) AND ((driver_id = ( SELECT auth.uid() AS uid)) OR (has_branch_access(branch_id) AND has_role(ARRAY['owner'::text, 'admin'::text, 'branch_manager'::text])))))
  WITH CHECK ((tenant_id = current_tenant_id()));

CREATE POLICY document_sequences_select ON public.document_sequences AS PERMISSIVE FOR SELECT TO authenticated
  USING (((tenant_id = current_tenant_id()) AND has_role(ARRAY['owner'::text, 'admin'::text]) AND (deleted_at IS NULL)));

CREATE POLICY driver_trips_select ON public.driver_trips AS PERMISSIVE FOR SELECT TO public
  USING (((tenant_id = current_tenant_id()) AND ((driver_id = ( SELECT auth.uid() AS uid)) OR has_branch_access(branch_id)) AND (deleted_at IS NULL)));

CREATE POLICY expenses_delete ON public.expenses AS PERMISSIVE FOR DELETE TO authenticated
  USING (((tenant_id = current_tenant_id()) AND has_role(ARRAY['owner'::text, 'admin'::text])));

-- auth.uid() wrapped 2026-09-03 (future-cost audit, auth_rls_initplan).
CREATE POLICY expenses_insert ON public.expenses AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((tenant_id = current_tenant_id()) AND has_branch_access(branch_id) AND has_role(ARRAY['owner'::text, 'admin'::text, 'branch_manager'::text, 'cashier'::text, 'accountant'::text]) AND (created_by = (select auth.uid()))));

CREATE POLICY expenses_select ON public.expenses AS PERMISSIVE FOR SELECT TO authenticated
  USING (((tenant_id = current_tenant_id()) AND has_branch_access(branch_id) AND (deleted_at IS NULL)));

CREATE POLICY expenses_update ON public.expenses AS PERMISSIVE FOR UPDATE TO authenticated
  USING (((tenant_id = current_tenant_id()) AND has_branch_access(branch_id) AND has_role(ARRAY['owner'::text, 'admin'::text, 'branch_manager'::text, 'accountant'::text])))
  WITH CHECK ((tenant_id = current_tenant_id()));

CREATE POLICY ingredient_stock_levels_select ON public.ingredient_stock_levels AS PERMISSIVE FOR SELECT TO authenticated
  USING (((tenant_id = current_tenant_id()) AND has_branch_access(branch_id) AND (deleted_at IS NULL)));

CREATE POLICY ingredients_delete ON public.ingredients AS PERMISSIVE FOR DELETE TO authenticated
  USING (((tenant_id = current_tenant_id()) AND has_role(ARRAY['owner'::text, 'admin'::text])));

CREATE POLICY ingredients_insert ON public.ingredients AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((tenant_id = current_tenant_id()) AND has_role(ARRAY['owner'::text, 'admin'::text, 'branch_manager'::text])));

CREATE POLICY ingredients_select ON public.ingredients AS PERMISSIVE FOR SELECT TO authenticated
  USING (((tenant_id = current_tenant_id()) AND (deleted_at IS NULL)));

CREATE POLICY ingredients_update ON public.ingredients AS PERMISSIVE FOR UPDATE TO authenticated
  USING (((tenant_id = current_tenant_id()) AND has_role(ARRAY['owner'::text, 'admin'::text, 'branch_manager'::text])))
  WITH CHECK ((tenant_id = current_tenant_id()));

CREATE POLICY invoices_insert ON public.invoices AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((tenant_id = current_tenant_id()) AND has_branch_access(branch_id) AND has_role(ARRAY['owner'::text, 'admin'::text, 'branch_manager'::text, 'cashier'::text])));

CREATE POLICY invoices_select ON public.invoices AS PERMISSIVE FOR SELECT TO authenticated
  USING (((tenant_id = current_tenant_id()) AND has_branch_access(branch_id) AND (deleted_at IS NULL)));

CREATE POLICY invoices_update ON public.invoices AS PERMISSIVE FOR UPDATE TO authenticated
  USING (((tenant_id = current_tenant_id()) AND has_branch_access(branch_id) AND has_role(ARRAY['owner'::text, 'admin'::text, 'accountant'::text])))
  WITH CHECK ((tenant_id = current_tenant_id()));

CREATE POLICY organization_invites_insert ON public.organization_invites AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((tenant_id = current_tenant_id()) AND private.can_manage_target_role(role_id)));

CREATE POLICY organization_invites_select ON public.organization_invites AS PERMISSIVE FOR SELECT TO authenticated
  USING (((tenant_id = current_tenant_id()) AND has_role(ARRAY['owner'::text, 'admin'::text]) AND (deleted_at IS NULL)));

-- auth.uid() wrapped 2026-09-03 (future-cost audit, auth_rls_initplan).
CREATE POLICY organizations_select ON public.organizations AS PERMISSIVE FOR SELECT TO public
  USING (((deleted_at IS NULL) AND (EXISTS ( SELECT 1
   FROM user_roles ur
  WHERE ((ur.profile_id = (select auth.uid())) AND (ur.tenant_id = organizations.id) AND (ur.deleted_at IS NULL))))));

CREATE POLICY organizations_update ON public.organizations AS PERMISSIVE FOR UPDATE TO authenticated
  USING (((id = current_tenant_id()) AND has_role(ARRAY['owner'::text, 'admin'::text])))
  WITH CHECK ((id = current_tenant_id()));

CREATE POLICY payments_insert ON public.payments AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((tenant_id = current_tenant_id()) AND has_branch_access(branch_id) AND has_role(ARRAY['owner'::text, 'admin'::text, 'branch_manager'::text, 'cashier'::text])));

CREATE POLICY payments_select ON public.payments AS PERMISSIVE FOR SELECT TO authenticated
  USING (((tenant_id = current_tenant_id()) AND has_branch_access(branch_id) AND (deleted_at IS NULL)));

-- auth.uid() wrapped 2026-09-03 (future-cost audit, auth_rls_initplan).
CREATE POLICY permanent_deletion_challenges_owner ON public.permanent_deletion_challenges AS PERMISSIVE FOR SELECT TO authenticated
  USING (((requested_by = (select auth.uid())) AND (tenant_id = current_tenant_id())));

CREATE POLICY permissions_select_authenticated ON public.permissions AS PERMISSIVE FOR SELECT TO authenticated
  USING ((deleted_at IS NULL));

CREATE POLICY product_categories_delete ON public.product_categories AS PERMISSIVE FOR DELETE TO authenticated
  USING (((tenant_id = current_tenant_id()) AND has_role(ARRAY['owner'::text, 'admin'::text])));

CREATE POLICY product_categories_insert ON public.product_categories AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((tenant_id = current_tenant_id()) AND has_role(ARRAY['owner'::text, 'admin'::text, 'branch_manager'::text])));

CREATE POLICY product_categories_select ON public.product_categories AS PERMISSIVE FOR SELECT TO authenticated
  USING (((tenant_id = current_tenant_id()) AND (deleted_at IS NULL)));

CREATE POLICY product_categories_update ON public.product_categories AS PERMISSIVE FOR UPDATE TO authenticated
  USING (((tenant_id = current_tenant_id()) AND has_role(ARRAY['owner'::text, 'admin'::text, 'branch_manager'::text])))
  WITH CHECK ((tenant_id = current_tenant_id()));

CREATE POLICY product_stock_levels_select ON public.product_stock_levels AS PERMISSIVE FOR SELECT TO authenticated
  USING (((tenant_id = current_tenant_id()) AND has_branch_access(branch_id) AND (deleted_at IS NULL)));

CREATE POLICY product_variants_delete ON public.product_variants AS PERMISSIVE FOR DELETE TO authenticated
  USING (((tenant_id = current_tenant_id()) AND has_role(ARRAY['owner'::text, 'admin'::text])));

CREATE POLICY product_variants_insert ON public.product_variants AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((tenant_id = current_tenant_id()) AND has_role(ARRAY['owner'::text, 'admin'::text, 'branch_manager'::text])));

CREATE POLICY product_variants_select ON public.product_variants AS PERMISSIVE FOR SELECT TO authenticated
  USING (((tenant_id = current_tenant_id()) AND (deleted_at IS NULL)));

CREATE POLICY product_variants_update ON public.product_variants AS PERMISSIVE FOR UPDATE TO authenticated
  USING (((tenant_id = current_tenant_id()) AND has_role(ARRAY['owner'::text, 'admin'::text, 'branch_manager'::text])))
  WITH CHECK ((tenant_id = current_tenant_id()));

CREATE POLICY production_batch_ingredients_insert ON public.production_batch_ingredients AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((tenant_id = current_tenant_id()) AND has_role(ARRAY['owner'::text, 'admin'::text, 'branch_manager'::text, 'baker'::text]) AND (EXISTS ( SELECT 1
   FROM production_batches b
  WHERE ((b.id = production_batch_ingredients.batch_id) AND has_branch_access(b.branch_id))))));

CREATE POLICY production_batch_ingredients_select ON public.production_batch_ingredients AS PERMISSIVE FOR SELECT TO authenticated
  USING (((tenant_id = current_tenant_id()) AND (deleted_at IS NULL) AND (EXISTS ( SELECT 1
   FROM production_batches b
  WHERE ((b.id = production_batch_ingredients.batch_id) AND has_branch_access(b.branch_id))))));

CREATE POLICY production_batch_ingredients_update ON public.production_batch_ingredients AS PERMISSIVE FOR UPDATE TO authenticated
  USING (((tenant_id = current_tenant_id()) AND has_role(ARRAY['owner'::text, 'admin'::text, 'branch_manager'::text, 'baker'::text]) AND (EXISTS ( SELECT 1
   FROM production_batches b
  WHERE ((b.id = production_batch_ingredients.batch_id) AND has_branch_access(b.branch_id))))))
  WITH CHECK ((tenant_id = current_tenant_id()));

CREATE POLICY production_batches_insert ON public.production_batches AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((tenant_id = current_tenant_id()) AND has_branch_access(branch_id) AND has_role(ARRAY['owner'::text, 'admin'::text, 'branch_manager'::text, 'baker'::text])));

CREATE POLICY production_batches_select ON public.production_batches AS PERMISSIVE FOR SELECT TO authenticated
  USING (((tenant_id = current_tenant_id()) AND has_branch_access(branch_id) AND (deleted_at IS NULL)));

CREATE POLICY production_batches_update ON public.production_batches AS PERMISSIVE FOR UPDATE TO authenticated
  USING (((tenant_id = current_tenant_id()) AND has_branch_access(branch_id) AND has_role(ARRAY['owner'::text, 'admin'::text, 'branch_manager'::text, 'baker'::text])))
  WITH CHECK (((tenant_id = current_tenant_id()) AND has_branch_access(branch_id)));

CREATE POLICY products_delete ON public.products AS PERMISSIVE FOR DELETE TO authenticated
  USING (((tenant_id = current_tenant_id()) AND has_role(ARRAY['owner'::text, 'admin'::text])));

CREATE POLICY products_insert ON public.products AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((tenant_id = current_tenant_id()) AND has_role(ARRAY['owner'::text, 'admin'::text, 'branch_manager'::text])));

CREATE POLICY products_select ON public.products AS PERMISSIVE FOR SELECT TO authenticated
  USING (((tenant_id = current_tenant_id()) AND (deleted_at IS NULL)));

CREATE POLICY products_update ON public.products AS PERMISSIVE FOR UPDATE TO authenticated
  USING (((tenant_id = current_tenant_id()) AND has_role(ARRAY['owner'::text, 'admin'::text, 'branch_manager'::text])))
  WITH CHECK ((tenant_id = current_tenant_id()));

CREATE POLICY profiles_auth_hook_read ON public.profiles AS PERMISSIVE FOR SELECT TO supabase_auth_admin
  USING (true);

CREATE POLICY profiles_select ON public.profiles AS PERMISSIVE FOR SELECT TO public
  USING (((deleted_at IS NULL) AND ((id = ( SELECT auth.uid() AS uid)) OR (has_role(ARRAY['owner'::text, 'admin'::text, 'branch_manager'::text]) AND (EXISTS ( SELECT 1
   FROM user_roles ur
  WHERE ((ur.profile_id = profiles.id) AND (ur.tenant_id = current_tenant_id()) AND (ur.deleted_at IS NULL))))))));

CREATE POLICY profiles_update_admin ON public.profiles AS PERMISSIVE FOR UPDATE TO public
  USING ((has_role(ARRAY['owner'::text, 'admin'::text]) AND (EXISTS ( SELECT 1
   FROM user_roles ur
  WHERE ((ur.profile_id = profiles.id) AND (ur.tenant_id = current_tenant_id()) AND (ur.deleted_at IS NULL))))))
  WITH CHECK ((has_role(ARRAY['owner'::text, 'admin'::text]) AND (EXISTS ( SELECT 1
   FROM user_roles ur
  WHERE ((ur.profile_id = profiles.id) AND (ur.tenant_id = current_tenant_id()) AND (ur.deleted_at IS NULL))))));

-- auth.uid() wrapped throughout 2026-09-03 (future-cost audit, auth_rls_initplan) -- six
-- occurrences in this one policy alone.
CREATE POLICY profiles_update_self ON public.profiles AS PERMISSIVE FOR UPDATE TO public
  USING ((id = (select auth.uid())))
  WITH CHECK (((id = (select auth.uid())) AND (NOT (tenant_id IS DISTINCT FROM current_tenant_id())) AND (NOT (primary_branch_id IS DISTINCT FROM ( SELECT p.primary_branch_id
   FROM profiles p
  WHERE (p.id = (select auth.uid()))))) AND (NOT (status IS DISTINCT FROM ( SELECT p.status
   FROM profiles p
  WHERE (p.id = (select auth.uid()))))) AND (NOT (deleted_at IS DISTINCT FROM ( SELECT p.deleted_at
   FROM profiles p
  WHERE (p.id = (select auth.uid()))))) AND (NOT (deleted_by IS DISTINCT FROM ( SELECT p.deleted_by
   FROM profiles p
  WHERE (p.id = (select auth.uid()))))) AND (NOT (active_tenant_id IS DISTINCT FROM ( SELECT p.active_tenant_id
   FROM profiles p
  WHERE (p.id = (select auth.uid())))))));

CREATE POLICY recipe_ingredients_delete ON public.recipe_ingredients AS PERMISSIVE FOR DELETE TO authenticated
  USING (((tenant_id = current_tenant_id()) AND has_role(ARRAY['owner'::text, 'admin'::text])));

CREATE POLICY recipe_ingredients_insert ON public.recipe_ingredients AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((tenant_id = current_tenant_id()) AND has_role(ARRAY['owner'::text, 'admin'::text, 'branch_manager'::text])));

CREATE POLICY recipe_ingredients_select ON public.recipe_ingredients AS PERMISSIVE FOR SELECT TO authenticated
  USING (((tenant_id = current_tenant_id()) AND (deleted_at IS NULL)));

CREATE POLICY recipe_ingredients_update ON public.recipe_ingredients AS PERMISSIVE FOR UPDATE TO authenticated
  USING (((tenant_id = current_tenant_id()) AND has_role(ARRAY['owner'::text, 'admin'::text, 'branch_manager'::text])))
  WITH CHECK ((tenant_id = current_tenant_id()));

CREATE POLICY recipes_delete ON public.recipes AS PERMISSIVE FOR DELETE TO authenticated
  USING (((tenant_id = current_tenant_id()) AND has_role(ARRAY['owner'::text, 'admin'::text])));

CREATE POLICY recipes_insert ON public.recipes AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((tenant_id = current_tenant_id()) AND has_role(ARRAY['owner'::text, 'admin'::text, 'branch_manager'::text])));

CREATE POLICY recipes_select ON public.recipes AS PERMISSIVE FOR SELECT TO authenticated
  USING (((tenant_id = current_tenant_id()) AND (deleted_at IS NULL)));

CREATE POLICY recipes_update ON public.recipes AS PERMISSIVE FOR UPDATE TO authenticated
  USING (((tenant_id = current_tenant_id()) AND has_role(ARRAY['owner'::text, 'admin'::text, 'branch_manager'::text])))
  WITH CHECK ((tenant_id = current_tenant_id()));

CREATE POLICY refunds_insert ON public.refunds AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((tenant_id = current_tenant_id()) AND has_branch_access(branch_id) AND has_role(ARRAY['owner'::text, 'admin'::text, 'branch_manager'::text])));

CREATE POLICY refunds_select ON public.refunds AS PERMISSIVE FOR SELECT TO authenticated
  USING (((tenant_id = current_tenant_id()) AND has_branch_access(branch_id) AND (deleted_at IS NULL)));

-- auth.uid() wrapped 2026-09-03 (future-cost audit, auth_rls_initplan).
CREATE POLICY role_permissions_select_authenticated ON public.role_permissions AS PERMISSIVE FOR SELECT TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM user_roles ur
  WHERE ((ur.role_id = role_permissions.role_id) AND (ur.profile_id = (select auth.uid())) AND (ur.tenant_id = current_tenant_id()) AND (ur.deleted_at IS NULL)))));

CREATE POLICY roles_auth_hook_read ON public.roles AS PERMISSIVE FOR SELECT TO supabase_auth_admin
  USING (true);

CREATE POLICY roles_select ON public.roles AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

CREATE POLICY stock_movements_insert ON public.stock_movements AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((tenant_id = current_tenant_id()) AND has_branch_access(branch_id) AND has_role(ARRAY['owner'::text, 'admin'::text, 'branch_manager'::text])));

CREATE POLICY stock_movements_select ON public.stock_movements AS PERMISSIVE FOR SELECT TO authenticated
  USING (((tenant_id = current_tenant_id()) AND has_branch_access(branch_id) AND (deleted_at IS NULL)));

-- auth.uid() wrapped throughout 2026-09-03 (future-cost audit, auth_rls_initplan) -- four
-- occurrences in this one policy alone.
CREATE POLICY sync_changes_select ON public.sync_changes AS PERMISSIVE FOR SELECT TO public
  USING (((EXISTS ( SELECT 1
   FROM user_roles ur
  WHERE ((ur.profile_id = (select auth.uid())) AND (ur.tenant_id = sync_changes.tenant_id) AND (ur.deleted_at IS NULL)))) AND (EXISTS ( SELECT 1
   FROM sync_devices d
  WHERE ((d.user_id = (select auth.uid())) AND (d.revoked_at IS NULL)))) AND ((branch_id IS NULL) OR (EXISTS ( SELECT 1
   FROM (user_roles ur2
     JOIN roles r ON ((r.id = ur2.role_id)))
  WHERE ((ur2.profile_id = (select auth.uid())) AND (ur2.tenant_id = sync_changes.tenant_id) AND (ur2.deleted_at IS NULL) AND (r.deleted_at IS NULL) AND (r.key = ANY (ARRAY['owner'::text, 'admin'::text]))))) OR (EXISTS ( SELECT 1
   FROM branch_assignments ba
  WHERE ((ba.profile_id = (select auth.uid())) AND (ba.tenant_id = sync_changes.tenant_id) AND (ba.branch_id = sync_changes.branch_id) AND (ba.deleted_at IS NULL)))))));

-- auth.uid() wrapped throughout 2026-09-03 (future-cost audit, auth_rls_initplan).
CREATE POLICY sync_conflicts_resolve ON public.sync_conflicts AS PERMISSIVE FOR UPDATE TO public
  USING ((EXISTS ( SELECT 1
   FROM (user_roles ur
     JOIN roles r ON ((r.id = ur.role_id)))
  WHERE ((ur.profile_id = (select auth.uid())) AND (ur.tenant_id = sync_conflicts.tenant_id) AND (ur.deleted_at IS NULL) AND (r.deleted_at IS NULL) AND (r.key = ANY (ARRAY['owner'::text, 'admin'::text, 'branch_manager'::text]))))))
  WITH CHECK (((resolved_by = (select auth.uid())) AND (conflict_status = ANY (ARRAY['RESOLVED'::text, 'DISMISSED'::text])) AND (tenant_id = ( SELECT sc.tenant_id
   FROM sync_conflicts sc
  WHERE (sc.id = sync_conflicts.id)))));

CREATE POLICY sync_conflicts_select ON public.sync_conflicts AS PERMISSIVE FOR SELECT TO public
  USING ((((actor_id = (select auth.uid())) AND (EXISTS ( SELECT 1
   FROM user_roles ur
  WHERE ((ur.profile_id = (select auth.uid())) AND (ur.tenant_id = sync_conflicts.tenant_id) AND (ur.deleted_at IS NULL))))) OR (EXISTS ( SELECT 1
   FROM (user_roles ur
     JOIN roles r ON ((r.id = ur.role_id)))
  WHERE ((ur.profile_id = (select auth.uid())) AND (ur.tenant_id = sync_conflicts.tenant_id) AND (ur.deleted_at IS NULL) AND (r.deleted_at IS NULL) AND (r.key = ANY (ARRAY['owner'::text, 'admin'::text, 'branch_manager'::text])))))));

-- auth.uid() wrapped throughout 2026-09-03 (future-cost audit, auth_rls_initplan).
CREATE POLICY sync_devices_insert ON public.sync_devices AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((user_id = (select auth.uid())));

CREATE POLICY sync_devices_select ON public.sync_devices AS PERMISSIVE FOR SELECT TO public
  USING ((user_id = (select auth.uid())));

CREATE POLICY sync_devices_update ON public.sync_devices AS PERMISSIVE FOR UPDATE TO public
  USING ((user_id = (select auth.uid())))
  WITH CHECK ((user_id = (select auth.uid())));

CREATE POLICY sync_operations_select ON public.sync_operations AS PERMISSIVE FOR SELECT TO public
  USING (((actor_id = (select auth.uid())) AND (EXISTS ( SELECT 1
   FROM user_roles ur
  WHERE ((ur.profile_id = (select auth.uid())) AND (ur.tenant_id = sync_operations.tenant_id) AND (ur.deleted_at IS NULL))))));

-- auth.uid() wrapped throughout 2026-09-03 (future-cost audit, auth_rls_initplan) --
-- tickets/ticket_items are the busiest tables in the app, scanned on every sale.
CREATE POLICY ticket_items_delete ON public.ticket_items AS PERMISSIVE FOR DELETE TO authenticated
  USING (((tenant_id = current_tenant_id()) AND (EXISTS ( SELECT 1
   FROM tickets o
  WHERE ((o.id = ticket_items.ticket_id) AND (o.tenant_id = ticket_items.tenant_id) AND has_branch_access(o.branch_id) AND (has_role(ARRAY['owner'::text, 'admin'::text, 'branch_manager'::text, 'cashier'::text]) OR (has_role(ARRAY['driver'::text]) AND ((o.created_by = (select auth.uid())) OR (o.assigned_to = (select auth.uid())))))))));

CREATE POLICY ticket_items_insert ON public.ticket_items AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((tenant_id = current_tenant_id()) AND (EXISTS ( SELECT 1
   FROM tickets o
  WHERE ((o.id = ticket_items.ticket_id) AND (o.tenant_id = ticket_items.tenant_id) AND has_branch_access(o.branch_id) AND (has_role(ARRAY['owner'::text, 'admin'::text, 'branch_manager'::text, 'cashier'::text]) OR (has_role(ARRAY['driver'::text]) AND ((o.created_by = (select auth.uid())) OR (o.assigned_to = (select auth.uid())))))))));

CREATE POLICY ticket_items_select ON public.ticket_items AS PERMISSIVE FOR SELECT TO authenticated
  USING (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (deleted_at IS NULL) AND (EXISTS ( SELECT 1
   FROM tickets o
  WHERE ((o.id = ticket_items.ticket_id) AND (o.tenant_id = ticket_items.tenant_id) AND ( SELECT has_branch_access(o.branch_id) AS has_branch_access))))));

CREATE POLICY ticket_items_update ON public.ticket_items AS PERMISSIVE FOR UPDATE TO authenticated
  USING (((tenant_id = current_tenant_id()) AND (EXISTS ( SELECT 1
   FROM tickets o
  WHERE ((o.id = ticket_items.ticket_id) AND (o.tenant_id = ticket_items.tenant_id) AND has_branch_access(o.branch_id) AND (has_role(ARRAY['owner'::text, 'admin'::text, 'branch_manager'::text, 'cashier'::text]) OR (has_role(ARRAY['driver'::text]) AND ((o.created_by = (select auth.uid())) OR (o.assigned_to = (select auth.uid())))))))))
  WITH CHECK ((tenant_id = current_tenant_id()));

CREATE POLICY tickets_insert ON public.tickets AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((tenant_id = current_tenant_id()) AND has_branch_access(branch_id) AND has_role(ARRAY['owner'::text, 'admin'::text, 'branch_manager'::text, 'cashier'::text, 'driver'::text]) AND ((has_role(ARRAY['driver'::text]) AND (created_by = (select auth.uid()))) OR (NOT has_role(ARRAY['driver'::text])))));

CREATE POLICY tickets_select ON public.tickets AS PERMISSIVE FOR SELECT TO authenticated
  USING (((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND ( SELECT has_branch_access(tickets.branch_id) AS has_branch_access) AND (deleted_at IS NULL)));

CREATE POLICY tickets_update ON public.tickets AS PERMISSIVE FOR UPDATE TO authenticated
  USING (((tenant_id = current_tenant_id()) AND has_branch_access(branch_id) AND (has_role(ARRAY['owner'::text, 'admin'::text, 'branch_manager'::text]) OR (has_role(ARRAY['driver'::text]) AND ((created_by = (select auth.uid())) OR (assigned_to = (select auth.uid())))) OR has_role(ARRAY['cashier'::text]))))
  WITH CHECK (((tenant_id = current_tenant_id()) AND has_branch_access(branch_id) AND (has_role(ARRAY['owner'::text, 'admin'::text, 'branch_manager'::text]) OR (has_role(ARRAY['driver'::text]) AND ((created_by = (select auth.uid())) OR (assigned_to = (select auth.uid())))) OR has_role(ARRAY['cashier'::text]))));

CREATE POLICY user_roles_auth_hook_read ON public.user_roles AS PERMISSIVE FOR SELECT TO supabase_auth_admin
  USING (true);

-- auth.uid() wrapped throughout 2026-09-03 (future-cost audit, auth_rls_initplan).
CREATE POLICY user_roles_delete ON public.user_roles AS PERMISSIVE FOR DELETE TO authenticated
  USING (((tenant_id = current_tenant_id()) AND (profile_id <> (select auth.uid())) AND (has_role(ARRAY['owner'::text]) OR (has_role(ARRAY['admin'::text]) AND (EXISTS ( SELECT 1
   FROM roles r
  WHERE ((r.id = user_roles.role_id) AND (r.key <> ALL (ARRAY['owner'::text, 'admin'::text])))))))));

CREATE POLICY user_roles_insert ON public.user_roles AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((tenant_id = current_tenant_id()) AND private.can_manage_target_role(role_id) AND (profile_id <> (select auth.uid()))));

CREATE POLICY user_roles_select ON public.user_roles AS PERMISSIVE FOR SELECT TO authenticated
  USING ((((profile_id = ( SELECT auth.uid() AS uid)) OR ((tenant_id = current_tenant_id()) AND has_role(ARRAY['owner'::text, 'admin'::text, 'branch_manager'::text]))) AND (deleted_at IS NULL)));

-- auth.uid() wrapped 2026-09-03 (future-cost audit, auth_rls_initplan).
CREATE POLICY user_roles_update ON public.user_roles AS PERMISSIVE FOR UPDATE TO authenticated
  USING (((tenant_id = current_tenant_id()) AND has_role(ARRAY['owner'::text, 'admin'::text]) AND (profile_id <> (select auth.uid()))))
  WITH CHECK (((tenant_id = current_tenant_id()) AND private.can_manage_target_role(role_id) AND (profile_id <> (select auth.uid()))));

CREATE POLICY warehouses_insert ON public.warehouses AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((tenant_id = current_tenant_id()) AND has_branch_access(branch_id) AND has_role(ARRAY['owner'::text, 'admin'::text, 'branch_manager'::text])));

CREATE POLICY warehouses_select ON public.warehouses AS PERMISSIVE FOR SELECT TO authenticated
  USING (((tenant_id = current_tenant_id()) AND has_branch_access(branch_id) AND (deleted_at IS NULL)));

CREATE POLICY warehouses_update ON public.warehouses AS PERMISSIVE FOR UPDATE TO authenticated
  USING (((tenant_id = current_tenant_id()) AND has_branch_access(branch_id) AND has_role(ARRAY['owner'::text, 'admin'::text, 'branch_manager'::text])))
  WITH CHECK (((tenant_id = current_tenant_id()) AND has_branch_access(branch_id)));

-- Added 2026-09-02 (migration add_supervisor_permission_overrides, BLOCKER-025). Read-only
-- via RLS -- writes go only through set_supervisor_permission_override(), see the
-- FUNCTION EXECUTE GRANTS section below for why no write policy exists here.
CREATE POLICY user_permission_overrides_select ON public.user_permission_overrides AS PERMISSIVE FOR SELECT TO authenticated
  USING (((profile_id = ( SELECT auth.uid() AS uid)) OR ((tenant_id = current_tenant_id()) AND has_role(ARRAY['owner'::text, 'admin'::text, 'branch_manager'::text]))) AND (deleted_at IS NULL));


-- ============================================================
-- SECTION: TABLE GRANTS (to anon/authenticated/service_role/supabase_auth_admin)
-- ============================================================
-- Blanket REVOKE first, added 2026-09-01 -- same root cause and same fix shape as the
-- FUNCTION EXECUTE GRANTS section above: this project has a default privilege configured for
-- the `postgres` role in schema `public` that auto-grants INSERT/SELECT/UPDATE/DELETE to
-- `authenticated` (and `postgres`/`service_role`) on every NEW table it creates (see
-- pg_default_acl, defaclobjtype='r': {postgres=arwdDxtm,authenticated=arwdm,...}). Every
-- statement below is a precise, deliberate positive GRANT (e.g. stock_movements only ever
-- grants authenticated SELECT, never INSERT -- direct writes are RPC-only per CLAUDE.md rule
-- 7), but none of them was ever preceded by a REVOKE, so the default auto-grant silently gave
-- `authenticated` more access than intended on a fresh database. Found live 2026-09-01
-- (tests/sql/inventory_write_rls.sql A0: direct INSERT into stock_movements as authenticated
-- succeeded when it must be denied) -- the exact same class of gap as the FUNCTION EXECUTE
-- GRANTS fix just above, just for tables instead of functions.
REVOKE ALL ON ALL TABLES IN SCHEMA public, private FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.audit_log TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.audit_log TO service_role;
GRANT INSERT, SELECT, UPDATE ON TABLE public.branch_assignments TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.branch_assignments TO service_role;
GRANT INSERT, SELECT, UPDATE ON TABLE public.branches TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.branches TO service_role;
GRANT SELECT ON TABLE public.cash_sessions TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.cash_sessions TO service_role;
GRANT INSERT, SELECT, UPDATE ON TABLE public.customers TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.customers TO service_role;
GRANT INSERT, SELECT, UPDATE ON TABLE public.daily_financial_audits TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.daily_financial_audits TO service_role;
GRANT INSERT, SELECT ON TABLE public.deliveries TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.deliveries TO service_role;
-- 2026-09-04 (table_privilege_audit.sql): INSERT/UPDATE revoked -- no matching RLS policy
-- existed for either (RLS is enabled+forced, so both were dead surface, not a live bypass).
-- The real write path is next_document_number()/assign_order_number(), SECURITY DEFINER
-- trigger context, unaffected by this grant either way.
GRANT SELECT ON TABLE public.document_sequences TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.document_sequences TO service_role;
GRANT SELECT ON TABLE public.driver_trips TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.driver_trips TO service_role;
GRANT INSERT, SELECT, UPDATE ON TABLE public.expenses TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.expenses TO service_role;
-- AD-022 (2026-09-01): ingredient/raw-material tracking deactivated for MVP -- the
-- `authenticated` grant on ingredient_stock_levels/ingredients was REVOKEd, service_role
-- only below. See 20260901160000_deactivate_ingredient_tracking_for_mvp.sql.
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.ingredient_stock_levels TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.ingredients TO service_role;
GRANT SELECT ON TABLE public.invoices TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.invoices TO service_role;
GRANT SELECT ON TABLE public.organization_invites TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.organization_invites TO service_role;
GRANT SELECT, UPDATE ON TABLE public.organizations TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.organizations TO service_role;
GRANT SELECT ON TABLE public.payments TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.payments TO service_role;
GRANT SELECT ON TABLE public.permanent_deletion_challenges TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.permanent_deletion_challenges TO service_role;
GRANT SELECT ON TABLE public.permissions TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.permissions TO service_role;
GRANT INSERT, SELECT, UPDATE ON TABLE public.product_categories TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.product_categories TO service_role;
-- 2026-09-04 (table_privilege_audit.sql): INSERT/UPDATE revoked -- no matching RLS policy
-- existed for either (RLS is enabled+forced, so both were dead surface, not a live bypass).
-- The real write path is apply_stock_movement(), SECURITY DEFINER trigger context,
-- unaffected by this grant either way.
GRANT SELECT ON TABLE public.product_stock_levels TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.product_stock_levels TO service_role;
GRANT INSERT, SELECT, UPDATE ON TABLE public.product_variants TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.product_variants TO service_role;
-- AD-022 (2026-09-01): production-batch tracking deactivated for MVP (it is entirely
-- raw-ingredient/recipe machinery) -- `authenticated` grant REVOKEd, service_role only.
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.production_batch_ingredients TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.production_batches TO service_role;
GRANT INSERT, SELECT, UPDATE ON TABLE public.products TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.products TO service_role;
-- 2026-09-04 (table_privilege_audit.sql): INSERT revoked -- no matching RLS policy existed
-- for it (RLS is enabled+forced, so it was dead surface, not a live bypass). Profiles are
-- inserted only by the auth.users signup trigger (service-role context). UPDATE is kept --
-- profiles_update_self/profiles_update_admin both cover it.
GRANT SELECT, UPDATE ON TABLE public.profiles TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.profiles TO service_role;
GRANT SELECT ON TABLE public.profiles TO supabase_auth_admin;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.rate_limit_events TO service_role;
-- AD-022 (2026-09-01): recipe/BOM tracking deactivated for MVP alongside ingredients --
-- `authenticated` grant REVOKEd, service_role only.
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.recipe_ingredients TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.recipes TO service_role;
GRANT SELECT ON TABLE public.refunds TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.refunds TO service_role;
GRANT SELECT ON TABLE public.role_permissions TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.role_permissions TO service_role;
GRANT SELECT ON TABLE public.roles TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.roles TO service_role;
GRANT SELECT ON TABLE public.roles TO supabase_auth_admin;
GRANT SELECT ON TABLE public.stock_movements TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.stock_movements TO service_role;
GRANT SELECT ON TABLE public.sync_changes TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.sync_changes TO service_role;
GRANT SELECT, UPDATE ON TABLE public.sync_conflicts TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.sync_conflicts TO service_role;
GRANT INSERT, SELECT, UPDATE ON TABLE public.sync_devices TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.sync_devices TO service_role;
GRANT SELECT ON TABLE public.sync_operations TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.sync_operations TO service_role;
GRANT INSERT, SELECT, UPDATE ON TABLE public.ticket_items TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.ticket_items TO service_role;
GRANT INSERT, SELECT ON TABLE public.tickets TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.tickets TO service_role;
-- Added 2026-09-02 (migration add_supervisor_permission_overrides +
-- revoke_direct_write_grants_user_permission_overrides, BLOCKER-025). SELECT only --
-- writes go only through set_supervisor_permission_override(), see below.
GRANT SELECT ON TABLE public.user_permission_overrides TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.user_permission_overrides TO service_role;
GRANT INSERT, SELECT, UPDATE ON TABLE public.user_roles TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.user_roles TO service_role;
GRANT SELECT ON TABLE public.user_roles TO supabase_auth_admin;
GRANT INSERT, SELECT, UPDATE ON TABLE public.warehouses TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.warehouses TO service_role;


-- ============================================================
-- SECTION: FUNCTION EXECUTE GRANTS (public + private schemas)
-- ============================================================
-- Blanket REVOKE first, added 2026-09-01 (this section originally had none at all -- every
-- statement below was a positive GRANT, with nothing counteracting the default privilege this
-- project has configured for the `postgres` role in schema `public`: every NEW function it
-- creates automatically gets EXECUTE granted to postgres/anon/authenticated/service_role (see
-- `pg_default_acl`, verified live: {postgres=X,anon=X,authenticated=X,service_role=X}). On the
-- live database this was invisible because every function had already been individually
-- REVOKE'd from anon/authenticated over many prior migrations (see IMPLEMENTATION_LOG.md's
-- several SECURITY FIX / hygiene entries) -- but this file never captured those REVOKEs, only
-- the GRANTs that came after them. Applying it to a genuinely fresh database (which inherits
-- the same default-privilege auto-grant, confirmed live) left every function anon/authenticated
-- -executable regardless of what this section's GRANTs said -- caught by
-- tests/sql/function_privilege_audit.sql itself reporting 88 findings where live has zero.
-- service_role and postgres are deliberately NOT revoked here -- both need broad access and the
-- GRANTs below re-establish exactly what each function needs for authenticated/service_role.
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public, private FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION private.can_manage_target_role(p_role_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_organization_invite(p_raw_token text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_organization_invite(p_raw_token text) TO service_role;
GRANT EXECUTE ON FUNCTION public.adjust_stock(p_warehouse_id uuid, p_item_type text, p_item_id uuid, p_new_quantity numeric, p_reason text, p_note text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.adjust_stock(p_warehouse_id uuid, p_item_type text, p_item_id uuid, p_new_quantity numeric, p_reason text, p_note text) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_customer_create(p_operation sync_operations) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_customer_update(p_operation sync_operations) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_expense_create(p_operation sync_operations) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_inventory_adjust(p_operation sync_operations) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_inventory_waste(p_operation sync_operations) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_payment_create(p_operation sync_operations) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_payment_reverse(p_operation sync_operations) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_payment_to_ticket() TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_production_cancel(p_operation sync_operations) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_production_record_output(p_operation sync_operations) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_production_record_waste(p_operation sync_operations) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_production_start(p_operation sync_operations) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_stock_movement() TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_sync_operation(p_operation_id uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_ticket_create(p_operation sync_operations) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_ticket_item_update(p_operation sync_operations) TO service_role;
GRANT EXECUTE ON FUNCTION public.archive_catalog_entity(p_entity_type text, p_entity_id uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.archive_catalog_entity(p_entity_type text, p_entity_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.archive_ticket(p_ticket_id uuid, p_reason text) TO service_role;
GRANT EXECUTE ON FUNCTION public.archive_ticket(p_ticket_id uuid, p_reason text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.assert_schema_invariants() TO service_role;
GRANT EXECUTE ON FUNCTION public.assign_batch_number() TO service_role;
GRANT EXECUTE ON FUNCTION public.assign_order_number() TO service_role;
GRANT EXECUTE ON FUNCTION public.bump_cash_session_revision() TO service_role;
GRANT EXECUTE ON FUNCTION public.bump_ticket_revision() TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_ticket(p_order_id uuid, p_reason text) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_ticket(p_order_id uuid, p_reason text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_cash_session(p_session_id uuid, p_counted_amount numeric, p_note text) TO service_role;
GRANT EXECUTE ON FUNCTION public.close_cash_session(p_session_id uuid, p_counted_amount numeric, p_note text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_driver_field_sale(p_ticket_id uuid, p_warehouse_id uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_driver_field_sale(p_ticket_id uuid, p_warehouse_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_driver_trip(p_trip_id uuid, p_settlement_cash_session_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_driver_trip(p_trip_id uuid, p_settlement_cash_session_id uuid) TO service_role;
-- AD-022 (2026-09-01): production-batch tracking deactivated for MVP -- authenticated
-- EXECUTE REVOKEd (batches can't be created anyway once the table grant is gone, but
-- this closes the direct-RPC path explicitly rather than leaving it as a stale grant).
GRANT EXECUTE ON FUNCTION public.complete_production_batch(p_batch_id uuid, p_actual_quantity numeric, p_ingredient_actuals jsonb, p_warehouse_id uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_production_batch(p_batch_id uuid, p_actual_quantity numeric, p_ingredient_actuals jsonb, p_warehouse_id uuid, p_tenant_id uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_ticket(p_order_id uuid, p_warehouse_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_ticket(p_order_id uuid, p_warehouse_id uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.confirm_ticket(p_order_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_ticket(p_order_id uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.copy_batch_planned_ingredients() TO service_role;
GRANT EXECUTE ON FUNCTION public.create_organization_invite(p_email text, p_role_key text, p_branch_id uuid, p_valid_days integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_organization_invite(p_email text, p_role_key text, p_branch_id uuid, p_valid_days integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_organization_with_owner(p_name text, p_branch_name text, p_timezone text) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_organization_with_owner(p_name text, p_branch_name text, p_timezone text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_tenant_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_tenant_id() TO service_role;
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(event jsonb) TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(event jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.depart_driver_trip(p_trip_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.depart_driver_trip(p_trip_id uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.enforce_rate_limit(p_tenant_id uuid, p_actor_id uuid, p_scope text, p_limit integer, p_window_minutes integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_production_batch(p_batch_id uuid, p_reason text, p_ingredient_actuals jsonb, p_warehouse_id uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_production_batch(p_batch_id uuid, p_reason text, p_ingredient_actuals jsonb, p_warehouse_id uuid, p_tenant_id uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_daily_revenue_summary(p_branch_id uuid, p_date date) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_daily_revenue_summary(p_branch_id uuid, p_date date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.guard_cash_session_transition() TO service_role;
GRANT EXECUTE ON FUNCTION public.guard_daily_financial_audit_mutation() TO service_role;
GRANT EXECUTE ON FUNCTION public.guard_delivery_transition() TO service_role;
GRANT EXECUTE ON FUNCTION public.guard_driver_created_order_assignment() TO service_role;
GRANT EXECUTE ON FUNCTION public.guard_driver_trip_transition() TO service_role;
GRANT EXECUTE ON FUNCTION public.guard_expense_cash_session() TO service_role;
GRANT EXECUTE ON FUNCTION public.guard_order_actor_and_assignment() TO service_role;
GRANT EXECUTE ON FUNCTION public.guard_order_item_price() TO service_role;
GRANT EXECUTE ON FUNCTION public.guard_payment_relationships() TO service_role;
GRANT EXECUTE ON FUNCTION public.guard_production_batch_transition() TO service_role;
GRANT EXECUTE ON FUNCTION public.guard_profile_primary_branch() TO service_role;
GRANT EXECUTE ON FUNCTION public.guard_refund_total() TO service_role;
GRANT EXECUTE ON FUNCTION public.guard_stock_movement_warehouse_tenant() TO service_role;
GRANT EXECUTE ON FUNCTION public.guard_ticket_driver_trip_assignment() TO service_role;
GRANT EXECUTE ON FUNCTION public.guard_ticket_item_mutation() TO service_role;
GRANT EXECUTE ON FUNCTION public.guard_ticket_status_transition() TO service_role;
GRANT EXECUTE ON FUNCTION public.guard_user_role_integrity() TO service_role;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO service_role;
GRANT EXECUTE ON FUNCTION public.has_branch_access(target_branch_id uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.has_branch_access(target_branch_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_permission(required_permission text, target_branch_id uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.has_role(role_keys text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(role_keys text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.has_role_in(p_actor uuid, p_tenant uuid, p_role_keys text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.is_authorized_for_branch(p_actor uuid, p_tenant uuid, p_branch uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.is_member_of(p_actor uuid, p_tenant uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.log_audit_event(p_tenant_id uuid, p_entity_type text, p_entity_id uuid, p_action text, p_before jsonb, p_after jsonb) TO service_role;
-- 2026-09-04 (add_expenses_audit_trail): trigger function, never directly callable --
-- service_role only, matching every other trigger function's grant shape in this file.
GRANT EXECUTE ON FUNCTION public.log_expense_mutation() TO service_role;
GRANT EXECUTE ON FUNCTION public.next_document_number(p_tenant_id uuid, p_doc_type text) TO service_role;
GRANT EXECUTE ON FUNCTION public.open_cash_session(p_branch_id uuid, p_opening_float numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.open_cash_session(p_branch_id uuid, p_opening_float numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.prevent_audit_log_mutation() TO service_role;
GRANT EXECUTE ON FUNCTION public.prevent_cash_session_delete() TO service_role;
GRANT EXECUTE ON FUNCTION public.prevent_driver_trip_delete() TO service_role;
GRANT EXECUTE ON FUNCTION public.prevent_financial_mutation() TO service_role;
GRANT EXECUTE ON FUNCTION public.prevent_stock_movement_mutation() TO service_role;
GRANT EXECUTE ON FUNCTION public.process_sync_batch(p_device_id uuid, p_operations jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.process_sync_batch(p_device_id uuid, p_operations jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.process_sync_batch_context_validated(p_device_id uuid, p_operations jsonb, p_actor uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.recalculate_ticket_totals() TO service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_driver_trip(p_trip_id uuid, p_physical_cash numeric, p_variance_note text) TO service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_driver_trip(p_trip_id uuid, p_physical_cash numeric, p_variance_note text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_payment(p_order_id uuid, p_amount numeric, p_method text, p_reference text, p_cash_session_id uuid, p_driver_trip_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_payment(p_order_id uuid, p_amount numeric, p_method text, p_reference text, p_cash_session_id uuid, p_driver_trip_id uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_refund(p_payment_id uuid, p_amount numeric, p_reason text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_refund(p_payment_id uuid, p_amount numeric, p_reason text) TO service_role;
GRANT EXECUTE ON FUNCTION public.restore_catalog_entity(p_entity_type text, p_entity_id uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.restore_catalog_entity(p_entity_type text, p_entity_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.return_driver_trip(p_trip_id uuid, p_items jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.return_driver_trip(p_trip_id uuid, p_items jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.rls_auto_enable() TO service_role;
GRANT EXECUTE ON FUNCTION public.set_active_organization(p_tenant_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_active_organization(p_tenant_id uuid) TO service_role;
-- Added 2026-09-02 (migration add_supervisor_permission_overrides, BLOCKER-025). No PUBLIC/anon
-- grant, matching every other tenant-scoped RPC in this file.
GRANT EXECUTE ON FUNCTION public.set_supervisor_permission_override(p_profile_id uuid, p_permission_key text, p_granted boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_supervisor_permission_override(p_profile_id uuid, p_permission_key text, p_granted boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_updated_at() TO service_role;
GRANT EXECUTE ON FUNCTION public.start_driver_trip(p_branch_id uuid, p_warehouse_id uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.start_driver_trip(p_branch_id uuid, p_warehouse_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_pull(p_device_id uuid, p_cursor bigint, p_page_size integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_pull(p_device_id uuid, p_cursor bigint, p_page_size integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.sync_validate_device(p_device_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_validate_device(p_device_id uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.transition_delivery(p_delivery_id uuid, p_to_status text, p_proof_url text, p_recipient_name text, p_reason text, p_driver_id uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.transition_delivery(p_delivery_id uuid, p_to_status text, p_proof_url text, p_recipient_name text, p_reason text, p_driver_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.trg_dispatch_sync_operation() TO service_role;
GRANT EXECUTE ON FUNCTION public.update_delivery_details(p_delivery_id uuid, p_address_line text, p_contact_phone text, p_scheduled_at timestamp with time zone) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_delivery_details(p_delivery_id uuid, p_address_line text, p_contact_phone text, p_scheduled_at timestamp with time zone) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_invoice_due_at(p_invoice_id uuid, p_due_at timestamp with time zone) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_invoice_due_at(p_invoice_id uuid, p_due_at timestamp with time zone) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_ticket(p_order_id uuid, p_customer_id uuid, p_fulfilment_type text, p_due_at timestamp with time zone, p_discount_amount numeric, p_tax_amount numeric, p_assigned_to uuid, p_status text, p_cancelled_reason text) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_ticket(p_order_id uuid, p_customer_id uuid, p_fulfilment_type text, p_due_at timestamp with time zone, p_discount_amount numeric, p_tax_amount numeric, p_assigned_to uuid, p_status text, p_cancelled_reason text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_money_columns() TO service_role;
GRANT EXECUTE ON FUNCTION public.verify_quantity_columns() TO service_role;
GRANT EXECUTE ON FUNCTION public.verify_rls_coverage() TO service_role;
GRANT EXECUTE ON FUNCTION public.verify_stock_reconciliation() TO service_role;
GRANT EXECUTE ON FUNCTION public.verify_tenant_columns() TO service_role;
GRANT EXECUTE ON FUNCTION public.verify_trip_loading(p_trip_id uuid, p_items jsonb, p_source_warehouse_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_trip_loading(p_trip_id uuid, p_items jsonb, p_source_warehouse_id uuid) TO service_role;


-- ============================================================
-- SECTION: STORAGE BUCKETS
-- ============================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES ('avatars', 'avatars', 'f', '2097152', '{image/jpeg,image/png,image/webp}') ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES ('delivery-proofs', 'delivery-proofs', 'f', '5242880', '{image/jpeg,image/png,image/webp}') ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES ('product-images', 'product-images', 'f', '5242880', '{image/jpeg,image/png,image/webp}') ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES ('receipts', 'receipts', 'f', '10485760', '{image/jpeg,image/png,image/webp,application/pdf}') ON CONFLICT (id) DO NOTHING;


-- ============================================================
-- SECTION: STORAGE.OBJECTS POLICIES
-- ============================================================

CREATE POLICY bakeflow_objects_delete ON storage.objects AS PERMISSIVE FOR DELETE TO authenticated
  USING (((bucket_id = ANY (ARRAY['avatars'::text, 'product-images'::text])) AND ((storage.foldername(name))[1] = (current_tenant_id())::text) AND has_role(ARRAY['owner'::text, 'admin'::text, 'branch_manager'::text])));

CREATE POLICY bakeflow_objects_insert ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((bucket_id = ANY (ARRAY['avatars'::text, 'product-images'::text, 'delivery-proofs'::text, 'receipts'::text])) AND ((storage.foldername(name))[1] = (current_tenant_id())::text)));

CREATE POLICY bakeflow_objects_select ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated
  USING (((bucket_id = ANY (ARRAY['avatars'::text, 'product-images'::text, 'delivery-proofs'::text, 'receipts'::text])) AND ((storage.foldername(name))[1] = (current_tenant_id())::text)));

CREATE POLICY bakeflow_objects_update ON storage.objects AS PERMISSIVE FOR UPDATE TO authenticated
  USING (((bucket_id = ANY (ARRAY['avatars'::text, 'product-images'::text, 'delivery-proofs'::text, 'receipts'::text])) AND ((storage.foldername(name))[1] = (current_tenant_id())::text)))
  WITH CHECK (((storage.foldername(name))[1] = (current_tenant_id())::text));


