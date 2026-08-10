# BakeFlow — Architecture Decisions

Locked decisions. Agents must not redesign these. A conflicting generic
recommendation loses; raise a blocker instead.

Status legend: **IMPLEMENTED** = applied and verified against the live database or
repository. **APPROVED** = decided, not yet built. **DEFERRED** = intentionally later.

---

## AD-001 — Tenancy: Organization → Branch · IMPLEMENTED
Canonical column is `tenant_id` (never `organization_id`/`bakery_id`). Branch-scoped
tables additionally carry `branch_id`. Set `tenant_id` explicitly on every insert.

## AD-002 — Multi-organization membership · IMPLEMENTED
A user may belong to many organizations. **`user_roles` is the membership model** —
no `organization_memberships` table. `profiles.tenant_id` is the originating "home"
organization, not an authorization boundary.
*Evidence:* migration `20260810141318`; `guard_user_role_integrity()` no longer
requires `user_roles.tenant_id = profiles.tenant_id`.

## AD-003 — JWT carries only the active organization · IMPLEMENTED
`tenant_id` = active organization; `roles` = roles **within that organization only**.
A flat array unioned across organizations is a privilege-escalation bug: `has_role()`
cannot tell which organization granted a role.
*Evidence:* migrations `20260810141339`, `20260810182611`; tests S5c/S5c2.

## AD-004 — Active organization is UI context, membership-validated · IMPLEMENTED
`profiles.active_tenant_id`, changed only via `set_active_organization()`. Direct
client writes are blocked by the pinned `profiles_update_self` policy.
*Evidence:* migration `20260810141258`; tests G1/G2.

## AD-005 — Devices are user-owned · IMPLEMENTED
`sync_devices` has no `tenant_id`/`branch_id`. One device legitimately serves several
organizations. Columns were dropped, not nulled: `verify_tenant_columns()` rejects a
nullable `tenant_id` outside `profiles`.
*Evidence:* migration `20260810141719`; test S10a.

## AD-006 — Sync routing is operation-authoritative · IMPLEMENTED
An operation's immutable `tenant_id` decides its destination. Never the device, never
`current_tenant_id()`, never the active organization, never a batch-level parameter.
One batch may span organizations.
*Evidence:* migration `20260810182203`; tests S1–S4, S10b.

## AD-007 — Immutable operation context · IMPLEMENTED
`operation_id`, `tenant_id`, `branch_id`, `actor_id`, `device_id`,
`device_created_at` are stored verbatim. `actor_id` comes from the authenticated
device relationship; a payload `actor_id` is ignored. The server owns `received_at`.
*Evidence:* tests S9, S12.

## AD-008 — Branch authorization order · IMPLEMENTED
Branch-belongs-to-organization is checked **before** owner/admin authority, so a
branch id from Bakery B can never be authorized by ownership in Bakery A.
*Evidence:* migration `20260810182112`; test S2.

## AD-009 — Sync gateway boundary · APPROVED
The gateway authenticates the device, authorizes per operation, preserves immutable
context, enforces idempotency, and **records** operations. It does **not** write
business tables. Per-entity application and conflict semantics are a later task.
No last-write-wins.

## AD-010 — Money and quantities · IMPLEMENTED
Money `NUMERIC(19,4)`; quantities `NUMERIC(18,4)`; percentages `NUMERIC(5,2)`.
Rounding only at final display or settlement.

## AD-011 — Ticket is the canonical order entity · IMPLEMENTED
Tables `tickets`/`ticket_items`; permissions `tickets.*`. Order means Ticket. Live RPC
arguments named `p_order_id` take a `tickets.id` — do not rename.

## AD-012 — Soft delete · IMPLEMENTED
`deleted_at`/`deleted_by` plus a hash-confirmed permanent-delete flow gated by
`records.permanent_delete`. No casual `DELETE`.

## AD-013 — Offline storage · APPROVED (not built)
One SQLCipher database **per authenticated user**, spanning that user's
organizations. Key: 32 CSPRNG bytes in SecureStore, never derived from any
application value. Never silently re-key. Expo Go is not a target runtime.

## AD-014 — Supabase auth session storage · APPROVED (not built)
AES-256-GCM via `expo-crypto`, key in SecureStore, ciphertext in `expo-file-system`.
No AsyncStorage. Auth session, SQLCipher key and business database stay separate.

## AD-015 — Web workspace deferred · IMPLEMENTED
`apps/web` stays on React 18 and is outside the active npm workspace. Do not upgrade
it for consistency; do not re-add it until web development begins.

## AD-016 — Permissions not yet enforced server-side · APPROVED (backlog)
`has_permission()` gates **zero** of 101 policies; role-based RLS is authoritative.
Do not retrofit permission enforcement without a separate decision.
