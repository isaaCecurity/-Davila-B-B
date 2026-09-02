# BakeFlow Audit Findings

Date: 2026-09-02
Repository: `isaaCecurity/-Davila-B-B`
Scope: source code, Supabase migrations/functions, frontend dependencies, generated client artifacts, tests, and linked Supabase project advisors.

## Resolution status (updated 2026-09-02, same day)

Every finding below was independently re-verified against the live source/database before
being acted on (not taken on faith from this report). Four items fixed and deployed live;
two require a human decision and were deliberately not touched.

| Finding | Status |
|---|---|
| High: vulnerable npm dependency tree | **Not fixed — needs a planned upgrade.** This report's own caution is correct: `npm audit fix --force` pulls in breaking Expo/React Native/Metro changes. Deliberately not attempted inline; needs its own scoped task (upgrade as a compatible release group, regenerate lockfile, full typecheck/lint/test pass). |
| High-risk production attack surface: public `SECURITY DEFINER` RPCs | **Reviewed — one real, live finding, fixed.** Every `anon`/`authenticated`/`PUBLIC`-grantable `SECURITY DEFINER` function in `public` was enumerated live. All had a pinned `search_path` and `authenticated`-only grants **except** `set_supervisor_permission_override` (built earlier the same day for BLOCKER-025), which `anon` could also call — not exploitable (its own first check rejects a null `auth.uid()`), but shouldn't have been reachable at all. Root cause: `REVOKE ALL ... FROM PUBLIC` doesn't strip an explicit `anon` grant Supabase's default function privileges had already applied — the same class of gap as the table-grant finding below, on functions instead of tables. Fixed live: `REVOKE EXECUTE ... FROM anon`, migration `revoke_anon_execute_set_supervisor_permission_override`. Re-verified clean against `tests/sql/function_privilege_audit.sql`'s own three checks (all zero rows). |
| Medium: `rate_limit_events` has RLS with no policies | **Not touched — matches this report's own recommendation.** Fails closed for client roles, which is the safe posture; no client workflow needs direct access. Left as documented, deliberate no-policy state rather than inventing policies with no consumer. |
| Medium: caller-controlled invite base URL | **Fixed and deployed.** `app_url` was dead client-side plumbing — no caller anywhere in the frontend ever set it (verified by search before removing). Removed from both the Edge Function's request contract and the client SDK (`send-invite-email/index.ts`, `packages/api/mutations/invitations.ts`) rather than adding an allowlist for a parameter nothing legitimately uses. `APP_BASE_URL` (server-configured) is now the only source. Redeployed live: `send-invite-email` version 3, confirmed `ACTIVE`. |
| Medium: unexpected internal error messages returned to clients | **Fixed and deployed**, same redeploy as above. `handleFunctionError`'s unknown-`Error` branch now returns a generic `An unexpected error occurred` to the client; the real message/stack still goes to the structured server log, unchanged. |
| Low: live database lint warnings | **Fixed and verified.** The two array-literal warnings (`custom_access_token_hook`, `apply_ticket_item_update`) were behavior-preserving hardening — Postgres already inferred the correct type at runtime, but static analysis couldn't verify it; rewritten with explicit `ARRAY[]::type[]`. The unused `v_actor` in `sync_pull` was genuinely dead code (the call is for its validation side effect only) — removed. Migration `fix_db_lint_warnings_array_literals_and_unused_var`. Re-ran `supabase db lint --linked --schema public --fail-on none` live: **no schema errors found**. Zero regression confirmed against `tests/sql/p3_7_sync_apply_and_pull.sql` (11/11) and a direct live call to `custom_access_token_hook`. |

Full narrative: `IMPLEMENTATION_LOG.md` 2026-09-02.

## Findings

### High: vulnerable npm dependency tree

`npm audit --audit-level=high` reported 18 vulnerabilities: 4 high and 14 moderate.

The high-severity issue is `image-size`, reached through the React Native Metro toolchain. Other affected packages include `@xmldom/xmldom`, `decode-uri-component`, and `uuid`. The installed paths are transitive:

- `image-size` via `react-native` -> Metro
- `decode-uri-component` via `expo-router` -> `query-string`
- `@xmldom/xmldom` via Expo CLI/config tooling
- `uuid` via Expo config plugins -> `xcode`

`npm audit fix --force` proposes breaking framework changes, so upgrades should be planned and validated rather than applied blindly.

Evidence: `bakeflow-frontend/package-lock.json`; command: `npm audit --audit-level=high`.

Recommended action: update Expo/React Native/Metro as a compatible release group, regenerate the lockfile, then rerun `npm audit`, typecheck, lint, and the mobile test suite.

### High-risk production attack surface: public SECURITY DEFINER RPCs

Live Supabase advisors report that multiple public functions are `SECURITY DEFINER` and executable by `authenticated`, including:

- `public.accept_organization_invite(text)`
- `public.adjust_stock(uuid, text, uuid, numeric, text, text)`
- `public.archive_catalog_entity(text, uuid)`
- `public.archive_ticket(uuid, text)`
- `public.cancel_ticket(uuid, text)`
- `public.close_cash_session(uuid, numeric, text)`
- `public.complete_driver_field_sale(uuid, uuid)`

This is not automatically exploitable because these functions may intentionally enforce tenant and role checks internally. However, each function bypasses normal RLS while running and is exposed through `/rest/v1/rpc/...`. Their bodies and grants must be reviewed as a security boundary.

Evidence: live `mcp_supabase_get_advisors(type=security)` response; SQL definitions are present in `supabase/migrations/20260809_live_schema.sql`.

Recommended action: keep only intentionally public RPCs exposed; revoke `EXECUTE` from `PUBLIC`/`authenticated` where unnecessary; ensure every retained function has a pinned `search_path`, explicit `auth.uid()` validation, authoritative tenant lookup, role/permission checks, and strict input validation.

### Medium: `rate_limit_events` has RLS with no policies

The live project reports `public.rate_limit_events` has RLS enabled but zero policies. This currently fails closed for client roles, which is preferable to a leak, but the posture is ambiguous and the table is part of the rate-limit security mechanism.

Evidence: live Supabase security advisor `rls_enabled_no_policy`; live table listing confirms RLS enabled; direct policy count query returned zero policies.

Recommended action: document the deliberate no-client-access posture and verify that only the privileged rate-limit function can read/write it. Add explicit policies only if a client workflow genuinely needs access.

### Medium: caller-controlled invite base URL

`send-invite-email` accepts `app_url` from the request and uses it to construct a link containing the raw invitation token:

- [supabase/functions/send-invite-email/index.ts](../supabase/functions/send-invite-email/index.ts#L149-L156)

An authorized caller can therefore cause an invitation email to contain a token-bearing link to an arbitrary host. This enables phishing-style invitations and can disclose invite tokens to an untrusted domain.

Recommended action: remove `app_url` from the request contract, or validate it against a strict server-side allowlist of approved HTTPS origins. Keep the configured server URL authoritative.

### Medium: unexpected internal error messages are returned to clients

The generic Edge Function error path logs and returns `err.message`:

- [supabase/functions/_shared/errors.ts](../supabase/functions/_shared/errors.ts#L103-L116)

Unexpected errors may contain database details, provider responses, paths, or other implementation information. The stack is logged server-side, but the response should remain generic.

Recommended action: return a stable message such as `An unexpected error occurred` for unknown errors while retaining the detailed message and stack only in structured server logs.

### Low: live database lint warnings

`supabase db lint --linked --schema public --fail-on none` completed successfully but reported:

- `custom_access_token_hook`: assigning a `text` expression to `text[]` variable `v_roles`.
- `apply_ticket_item_update`: assigning a `text` expression to `uuid[]` variable `v_item_ids`.
- `sync_pull`: variable `v_actor` is never read.

These are currently warnings rather than confirmed security defects, but the first two deserve correction because type coercion in authorization or mutation functions can conceal malformed values.

## Validation completed

- Repository Python tests: `12 passed`
- Frontend Jest: `39 passed`
- Mobile TypeScript: passed
- Mobile ESLint: passed
- Expo dependency check: passed using the local offline dependency map
- Invitation hashing/link/HTML escaping checks: passed
- No service-role credentials found in tracked source or built client artifacts
- Local `.env` files are ignored and untracked
- All public tables returned by live table listing had RLS enabled

## Audit limitations

- No application or database files were modified during the audit.
- The GitHub secret-scanning MCP tool was not available in the active tool list, so the local credential scan was used instead.
- The live SQL definition query returned large output and should be reviewed function-by-function before changing RPC grants.
- Dependency vulnerabilities are reported from the current lockfile and may include tooling-only paths; reachability should be confirmed during the upgrade.

## Installed audit skills

- `.agents/skills/supabase`
- `.agents/skills/supabase-postgres-best-practices`
