# SOFT-DELETE-AND-RETENTION.md

## Purpose

This document defines BakeFlow's repo-wide soft-delete, archive, retention, restoration, and permanent-deletion rules.

Claude Code MUST treat these rules as architectural requirements, not optional implementation details.

Core principle:

> BakeFlow does not use ordinary hard deletion for normal application workflows.

Records should normally be retained and marked as deleted/archived. Permanent destruction is exceptional, explicitly allowlisted, protected by deliberate confirmation, and never available for financial/audit records.

## 1. Terminology

### Soft delete

A soft-deleted record remains physically present in PostgreSQL.

Canonical fields:

```sql
deleted_at timestamptz NULL,
deleted_by uuid NULL REFERENCES auth.users(id) ON DELETE RESTRICT
```

Meaning:
- `deleted_at IS NULL` = active
- `deleted_at IS NOT NULL` = soft-deleted
- `deleted_by` = authenticated actor responsible for the deletion

Soft delete MUST NOT physically remove the row.

### Archive

Archive is related to, but distinct from, soft delete.

Archive means:
- hide from normal operational views
- preserve historical data
- preserve audit/history
- make available through an explicit archive/history view

Tickets use archive semantics:

```sql
archived_at timestamptz NULL,
archived_by uuid NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
archive_reason text NULL
```

### Permanent deletion

Permanent deletion physically removes data.

It is NOT a normal CRUD operation.

It is allowed only for explicitly eligible non-financial/non-audit records through the destructive-deletion workflow defined below.

Never expose a generic DELETE endpoint.

## 2. Repository-wide rule

Any persistent business table that supports normal user removal MUST use soft deletion unless explicitly documented as:
1. immutable historical data,
2. append-only audit data,
3. purely technical/ephemeral data,
4. a lifecycle-managed join/configuration table,
5. or explicitly approved for permanent deletion.

When uncertain, retain rather than destroy.

Do not introduce a normal delete button without documenting the entity's lifecycle.

## 3. Soft-delete invariants

Normal deletion sets, atomically:

```sql
deleted_at = now()
deleted_by = auth.uid()
```

The client MUST NOT provide the authoritative `deleted_by`.

Server-side code derives the actor from `auth.uid()`.

Do not permit a normal deletion state where `deleted_at` is populated but `deleted_by` is absent unless there is an explicitly documented system-operation exception.

## 4. Normal queries

Normal application queries MUST exclude soft-deleted rows.

Canonical pattern:

```sql
WHERE deleted_at IS NULL
```

Prefer repository/query-layer helpers and RLS policies so developers cannot accidentally expose deleted records.

Example:

```sql
SELECT *
FROM public.customers
WHERE tenant_id = public.current_tenant_id()
  AND deleted_at IS NULL;
```

Deleted records must not appear in normal:
- lists
- search
- autocomplete
- selectors
- dashboards
- operational reports
- active metrics

unless the screen is explicitly an archive/history view.

## 5. Archived/deleted views

Archived/deleted records remain physically present.

Dedicated history views may expose them to authorized users.

Do not mix active and archived/deleted records in ordinary operational screens.

For tickets, provide a dedicated Archived Tickets/Audit History experience.

## 6. Ticket lifecycle is stricter

After a ticket is submitted:
- nobody may update it
- nobody may cancel it
- nobody may directly delete it
- corrections/amendments create NEW tickets referencing the original
- the original remains historical
- archive is non-destructive

Do not implement Edit Submitted Ticket, Cancel Submitted Ticket, or Delete Submitted Ticket.

A correction is a new business event:

```text
Original Ticket
  ├── Correction Ticket
  ├── Correction Ticket
  └── Correction Ticket
```

## 7. Ticket archive

Ticket archive records:

```sql
archived_at timestamptz NULL,
archived_by uuid NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
archive_reason text NULL
```

Archiving:
- hides the ticket from normal operational lists
- preserves the complete ticket
- preserves audit history
- does not alter financial facts
- does not create a correction
- does not physically delete the ticket

An archive reason is required; current implementation requires at least 5 trimmed characters.

The server sets `archived_at` and `archived_by`.

## 8. Who can archive tickets

Current rule:

| Role | Archive submitted ticket |
|---|---|
| Owner | No |
| Admin | Yes |
| Manager / Branch Manager | Yes |
| Supervisor | No |
| Accountant | No |
| Cashier | No |
| Driver | No |
| Baker | No |

Ticket correction remains distinct from archive.

## 9. Permanent deletion authorization

Current explicit permission:

```text
records.permanent_delete
```

Current roles:

| Role | Permanent deletion |
|---|---|
| Owner | No |
| Admin | Yes |
| Manager / Branch Manager | Yes |
| Supervisor | No |
| Accountant | No |
| Cashier | No |
| Driver | No |
| Baker | No |

Do not infer this capability from role rank.

## 10. Permanent deletion is allowlisted

Never implement:

```text
if user has records.permanent_delete:
    DELETE any record
```

The permission only permits initiation of the destructive workflow for an independently eligible entity.

Current intended eligible categories are non-financial/non-audit records such as:
- customers
- products
- product_variants

The server/database must maintain an explicit allowlist.

Never add a new table to the allowlist without an explicit architecture decision.

## 11. Financial and audit retention

The application MUST NOT permanently delete:
- tickets
- ticket corrections/amendments
- payments
- refunds
- expenses
- daily financial audits
- cash-session financial records
- inventory movements
- financial transaction history
- other records forming the financial/audit trail

If financial information is wrong, use correction, reversal, amendment, or adjustment mechanisms.

Do not use DELETE to make financial reports look correct.

## 12. Destructive confirmation flow

Permanent deletion should use a GitHub-style destructive flow:

```text
Delete permanently
  -> irreversible warning
  -> show exact target
  -> exact confirmation phrase
  -> recent authentication / re-authentication
  -> server permission check
  -> entity allowlist check
  -> tenant/ownership check
  -> lifecycle check
  -> permanent deletion
```

Do not accept only:

```json
{"confirmed": true}
```

The operation must be deliberately confirmed.

## 13. permanent_deletion_challenges

The database pattern uses:

```text
permanent_deletion_challenges
```

with fields conceptually representing:
- tenant
- requesting user
- target entity category/table
- target record ID
- confirmation challenge hash
- expiration
- consumption state
- creation time

A challenge MUST be:
- temporary
- single-use
- bound to authenticated user
- bound to tenant
- bound to target entity and record
- expired after its configured time

A challenge for one record must never be reusable for another.

## 14. Never store plaintext destructive secrets

Do not persist the plaintext confirmation secret.

Store only a cryptographic verification representation.

Do not log:
- confirmation phrase
- challenge secret
- auth tokens
- sensitive deletion payloads

## 15. Permanent deletion preconditions

Before physical deletion, the server MUST verify:
1. authenticated user exists
2. target belongs to current tenant
3. explicit permanent-delete permission exists
4. entity type is allowlisted
5. target record belongs to target tenant
6. target is already soft-deleted where applicable
7. challenge exists
8. challenge belongs to authenticated user
9. challenge targets same entity/record
10. challenge targets same tenant
11. challenge is unexpired
12. challenge is unused
13. confirmation is correct
14. referential constraints will not destroy protected financial/audit data

Any failure must reject the operation.

## 16. Tenant isolation

Deletion/archive is tenant-scoped.

A user authorized in Organization A must never manipulate Organization B's records.

Never trust a client-provided `tenant_id` as proof of ownership.

Server-side operations must verify the target record belongs to:

```sql
public.current_tenant_id()
```

and branch scope where applicable.

## 17. RLS

Soft deletion does not replace RLS.

Every exposed business table must have appropriate RLS enforcing:
- tenant isolation
- role/permission scope
- normal active/deleted visibility

Do not use broad policies such as:

```sql
USING (true)
```

on tenant-owned business tables.

Deleted records should normally be hidden from ordinary API access.

Archive/history access must be explicit.

## 18. Restoration

Restoration is NOT automatically available for every entity.

Do not create a generic `restore(id)` endpoint.

For each entity, explicitly define whether restoration is permitted.

Where supported, restoration must:
1. require explicit permission
2. be tenant-scoped
3. verify the row is deleted
4. clear `deleted_at`
5. handle `deleted_by` according to the entity's audit policy
6. create an audit event
7. revalidate unique constraints
8. revalidate parent/branch relationships
9. avoid resurrecting invalid financial state

Ticket restoration must not be used to undo submitted-ticket history.

## 19. Uniqueness and soft deletion

Decide per entity whether identifiers may be reused after soft deletion.

If reuse is allowed, use a partial unique index:

```sql
CREATE UNIQUE INDEX ...
ON public.customers(tenant_id, email)
WHERE deleted_at IS NULL;
```

If historical uniqueness must remain, retain full uniqueness across deleted rows.

Do not choose automatically.

## 20. Foreign keys

Soft deletion does not invoke PostgreSQL `ON DELETE` actions.

A parent with:

```text
deleted_at IS NOT NULL
```

does not automatically soft-delete children.

For each relationship explicitly choose:
- cascade soft-delete
- restrict parent deletion while active dependents exist
- preserve children for historical retention

Do not build generic recursive soft-delete behavior without reviewing the domain.

Do not treat `ON DELETE CASCADE` as a soft-delete mechanism.

## 21. Audit events

For important entities, lifecycle changes should generate auditable events including:
- actor
- timestamp
- entity
- entity ID
- tenant
- previous state where appropriate
- reason
- operation type

Examples:

```text
CUSTOMER_ARCHIVED
CUSTOMER_RESTORED
TICKET_ARCHIVED
PERMANENT_DELETE_REQUESTED
PERMANENT_DELETE_COMPLETED
```

The row's `deleted_at` is lifecycle state; an audit event records what happened.

## 22. Offline deletion

Offline deletion follows the same lifecycle/security rules.

An offline device MUST NOT physically delete server records.

Offline soft deletion becomes an encrypted outbox operation containing enough context for server validation, for example:

```text
operation_id
entity_type
entity_id
operation_type = SOFT_DELETE
tenant_id
branch_id
created_by
created_at
```

On synchronization, the server validates:
1. device
2. tenant
3. branch
4. user
5. permission
6. entity lifecycle

Then returns an explicit result such as:

```text
APPLIED
REJECTED
CONFLICT
```

Permanent deletion should require an online server-authorized flow with strong authentication/challenge verification.

Do not permit offline permanent deletion.

## 23. Offline conflicts and retries

Lifecycle operations must be idempotent where appropriate.

If two devices soft-delete the same entity, the server must converge deterministically.

Do not silently overwrite newer lifecycle state.

Use operation IDs/idempotency mechanisms in the synchronization layer.

## 24. Deleted records and sync

Soft-deleted/archived state changes must remain synchronizable.

Do not remove the entity from the sync protocol immediately after deletion.

Other authorized devices may need to receive the lifecycle change to converge.

Example:

```text
Device A
  -> archive
  -> server
  -> sync change
  -> Device B marks local record archived
```

The sync payload must remain tenant-scoped and authorized.

## 25. Encrypted local storage

Offline data is sensitive.

Use encrypted local storage/database and organization-scoped local contexts:

```text
encrypted local context
├── organization A
│   ├── active records
│   ├── required historical records
│   └── outbox
└── organization B
    ├── active records
    ├── required historical records
    └── outbox
```

Do not mix multiple organizations without explicit tenant partitioning.

When server synchronization establishes that a record is no longer available to the user, local caches must converge appropriately.

## 26. Search and reporting

Normal search/autocomplete/selectors must exclude deleted and archived records unless explicitly in a history context.

Operational reports normally use active records.

Historical/audit reports may include archived/deleted records.

Financial reports must preserve historical financial truth. Never delete or hide a financial record merely to correct a report.

## 27. API design

Avoid:

```text
DELETE /:table/:id
```

and:

```text
delete_record(table, id)
```

Prefer explicit domain operations:

```text
archive_ticket(ticket_id, reason)
soft_delete_customer(customer_id, reason)
restore_customer(customer_id)
request_permanent_deletion(...)
confirm_permanent_deletion(...)
```

Authorization and audit behavior must be explicit.

## 28. Database implementation

Soft-delete tables use:

```sql
deleted_at timestamptz NULL,
deleted_by uuid NULL REFERENCES auth.users(id) ON DELETE RESTRICT
```

Ticket archive uses:

```sql
archived_at timestamptz NULL,
archived_by uuid NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
archive_reason text NULL
```

Use partial indexes for active/archive query patterns where justified.

Example:

```sql
CREATE INDEX idx_table_active
ON public.table_name(tenant_id, ...)
WHERE deleted_at IS NULL;
```

Tickets currently use active and archived partial indexes.

Do not add indexes blindly.

## 29. Security-definer functions

Archive/delete RPCs must be hardened:

```sql
SECURITY DEFINER
SET search_path TO 'public'
```

Revoke broad execute privileges and grant only the intended API role.

Example:

```sql
REVOKE ALL ON FUNCTION public.archive_ticket(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.archive_ticket(uuid, text) TO authenticated;
```

The function must perform its own authorization checks.

UI hiding is not security.

## 30. Client state

After soft delete/archive:
- remove the record from active UI collections
- invalidate/update query caches
- update encrypted local storage
- enqueue sync operation when offline
- preserve required historical state

After confirmed permanent deletion:
- remove eligible data from local stores/caches
- only consider it successful after server confirmation

Never optimistically treat failed permanent deletion as successful.

## 31. Concurrency

Deletion and permanent deletion must be transactionally safe.

Do not perform:

```text
SELECT record
check eligibility
-- time passes
DELETE
```

without suitable transaction/concurrency protection.

Permanent deletion must re-check eligibility and authorization inside the destructive transaction.

## 32. Retention policy

Soft deletion and retention are different concepts.

Soft deletion answers:

> Is this record active?

Retention answers:

> How long must this historical record remain stored?

For each important entity, document:
- active lifecycle
- soft-delete lifecycle
- archive lifecycle
- retention period
- permanent-deletion eligibility
- restoration rules
- audit/legal requirements

Do not invent automatic purge jobs just because `deleted_at` exists.

## 33. No silent background destruction

Do NOT create jobs such as:

```sql
DELETE FROM table
WHERE deleted_at < now() - interval '30 days';
```

without an explicit approved retention policy for that exact entity.

Never use automatic purge for tickets, payments, refunds, expenses, audits, inventory movements, or financial history unless a future explicit policy changes this rule.

## 34. Testing requirements

For each soft-delete-capable entity, test:

### Normal lifecycle

```text
create
-> active
-> soft delete/archive
-> hidden from normal queries
-> visible in authorized history
```

### Authorization

```text
unauthorized -> rejected
wrong tenant -> rejected
wrong branch -> rejected where branch-scoped
authorized -> accepted
```

### Audit

Verify:

```text
deleted_at != NULL
deleted_by = authenticated actor
```

### Restoration, if supported

```text
deleted
-> restore
-> active
```

### Permanent deletion

Verify:
- ineligible entity rejected
- financial/audit entity rejected
- wrong tenant rejected
- wrong role rejected
- expired challenge rejected
- used challenge rejected
- wrong confirmation rejected
- valid challenge + authorization succeeds

### Offline

Verify:

```text
offline delete
-> encrypted outbox
-> reconnect
-> server validation
-> APPLIED / REJECTED / CONFLICT
```

## 35. Claude Code instructions

When changing this repository:

1. Search all `deleted_at` and `deleted_by` usage before adding lifecycle code.
2. Search all direct `.delete()`, SQL `DELETE`, Supabase `.delete()`, and generic delete RPCs.
3. Classify each occurrence as technical cleanup, soft delete, archive, permanent deletion, or architectural bug.
4. Do not mechanically convert every delete.
5. Determine entity lifecycle first.
6. Search all `archived_at`, `archived_by`, and `permanent_deletion_challenges`.
7. Follow canonical field names/types.
8. Ensure normal queries exclude deleted records.
9. Ensure RLS does not expose deleted records accidentally.
10. Keep permanent deletion allowlisted.
11. Protect financial/audit records from permanent deletion.
12. Keep ticket immutability intact.
13. Corrections must create new tickets.
14. Offline deletion must be encrypted and synchronized.
15. Permanent deletion cannot be performed offline.
16. Do not add Manager-controlled synchronization permissions.
17. Avoid generic CRUD deletion endpoints.
18. Add tests before changing lifecycle behavior.
19. Preserve existing audit/history semantics.
20. Treat database/server enforcement as authoritative.

## 36. Code review checklist

Before merging lifecycle changes:

- [ ] `deleted_at` is `timestamptz`
- [ ] `deleted_by` references `auth.users(id)`
- [ ] actor comes from `auth.uid()`
- [ ] tenant is server-authoritative
- [ ] normal queries exclude deleted records
- [ ] archive/history access is explicit
- [ ] RLS protects deleted data
- [ ] no generic DELETE API exists
- [ ] permanent deletion is allowlisted
- [ ] Owner does not automatically receive permanent-delete authority
- [ ] Manager/Admin permissions are explicit
- [ ] financial/audit records cannot be permanently deleted
- [ ] ticket immutability remains intact
- [ ] corrections create new tickets
- [ ] offline deletion is encrypted and synchronized
- [ ] permanent deletion cannot occur offline
- [ ] idempotency/retry behavior is defined
- [ ] audit events exist where required
- [ ] restoration behavior is explicit
- [ ] retention policy is documented before automatic purge
- [ ] tests cover tenant/role/lifecycle boundaries

## 37. Final architectural rule

BakeFlow treats business data as auditable history, not disposable CRUD rows.

Default lifecycle:

```text
CREATED
  -> ACTIVE
  -> ARCHIVED / SOFT-DELETED
  -> RETAINED FOR HISTORY
```

Only explicitly eligible non-financial data may continue to:

```text
ARCHIVED / SOFT-DELETED
  -> DESTRUCTIVE CONFIRMATION
  -> RE-AUTHENTICATION
  -> SERVER AUTHORIZATION
  -> PERMANENTLY DELETED
```

Financial and audit history does not follow the permanent-deletion path.

Submitted tickets do not become editable or cancellable.

Corrections create new tickets.

Offline devices never bypass lifecycle rules.

Database/RLS/server enforcement is authoritative. The React Native UI only exposes operations the user is permitted to perform.

This file is the source of truth for repository-wide soft-delete, archive, retention, restoration, and permanent-deletion behavior.

## 38. Catalog entity restore UX — owner decision 2026-08-14

### What changed in the database

The five unique indexes on catalog tables that previously consumed soft-deleted names permanently have been replaced with **partial unique indexes** scoped to `deleted_at IS NULL`:

| Table | Index | Uniqueness scope |
|---|---|---|
| `products` | `products_tenant_name_key` | `(tenant_id, name) WHERE deleted_at IS NULL` |
| `ingredients` | `ingredients_tenant_name_key` | `(tenant_id, name) WHERE deleted_at IS NULL` |
| `product_categories` | `product_categories_tenant_name_key` | `(tenant_id, name) WHERE deleted_at IS NULL` |
| `product_variants` | `product_variants_tenant_sku_key` | `(tenant_id, sku) WHERE deleted_at IS NULL` |
| `recipes` | `recipes_one_active_per_variant` | `(tenant_id, product_variant_id) WHERE is_active AND deleted_at IS NULL` |

A deleted entity's name or SKU is now free to be reused. The DB will only raise `23505` when a **live** row already holds that name/SKU.

### Business rule

When a manager or supervisor tries to create a catalog entity (product, ingredient, category, product variant) whose name or SKU already belongs to a **soft-deleted** row, the system must not silently fail or show a generic error. It must:

1. Detect that the `23505` conflict is caused by a soft-deleted row (not a live duplicate).
2. Surface a specific alert to the user.
3. Gate the restore action on role.

### Application implementation contract

**Where this applies:** `products`, `ingredients`, `product_categories`, `product_variants` create/write paths. (Recipes are created through the product variant flow, not directly by name.)

**Error detection pattern (service layer):**

```typescript
// In the catalog write service, catch a 23505 from PostgREST and check for a deleted row
try {
  await supabase.from('products').insert({ tenant_id, name, ... });
} catch (error) {
  if (isPostgrestError(error, '23505')) {
    const { data: deleted } = await supabase
      .from('products')
      .select('id, name, deleted_at, deleted_by')
      .eq('tenant_id', tenantId)
      .eq('name', name)
      .not('deleted_at', 'is', null)
      .maybeSingle();

    if (deleted) {
      throw new CatalogEntityDeletedError({ entity: 'product', id: deleted.id, name: deleted.name });
    }
    // No deleted row found → genuine live duplicate → surface as DuplicateNameError
    throw new DuplicateNameError({ entity: 'product', name });
  }
  throw error;
}
```

**UI behaviour, by role:**

| Caller role | What the UI shows |
|---|---|
| `owner`, `admin`, `branch_manager` | Alert: `"[Name] already exists but was previously deleted. Would you like to restore it?"` with a **Restore** button. |
| `cashier`, `baker`, `driver`, `supervisor` | Alert: `"[Name] already exists but was previously deleted. Contact your Manager to restore it."` No restore button. |

**Restore action (manager/admin/owner only):**

```typescript
// Restore = clear soft-delete fields + write audit event
await supabase.rpc('restore_catalog_entity', {
  p_entity_type: 'product',  // 'product' | 'product_category' | 'product_variant'
  p_entity_id: deletedRow.id,
});
```

**Built 2026-09-01** (migration `20260901200000_add_archive_restore_catalog_entity_rpcs.sql`,
resolving BLOCKER-010(c) — see `BLOCKERS.md`), live-verified 5/5 in
`tests/sql/catalog_write_rls.sql` (W17-W21). Its actual contract, differing from the
sketch above in three places (each for a concrete reason, not drift):

- `SECURITY DEFINER`, `SET search_path TO 'public'`.
- Role gate is `has_permission('products.manage', NULL)`, **not** `has_role(...)` — the
  RLS policies on these tables use the JWT-claim-based `has_role()`, but the established
  RPC convention (`archive_ticket()`) uses the DB-backed permission catalog instead;
  `products.manage` is held by exactly owner/admin/branch_manager, the same set, so the
  practical gate is unchanged.
- **`p_entity_type` does NOT include `'ingredient'`.** The sketch above listed it, but
  AD-022 (2026-09-01, same day) fully revoked `authenticated`'s grants on
  `ingredients`/`recipes`/`recipe_ingredients` for the MVP descope. Since this RPC is
  `SECURITY DEFINER`, including `'ingredient'` would silently bypass that revocation
  rather than honour it. Only `'product'`, `'product_category'`, `'product_variant'` are
  accepted; anything else is a rejected `22023`.
- Verify `tenant_id = current_tenant_id()` and `deleted_at IS NOT NULL` in the same
  `UPDATE ... WHERE` (not a separate `SELECT` first) — matches `archive_ticket()`'s own
  pattern, and collapses "not found" / "wrong tenant" / "not archived" into one generic
  error rather than leaking which case applied.
- Set `deleted_at = NULL`, `deleted_by = NULL` atomically; write via
  `log_audit_event(tenant_id, entity_type, entity_id, 'update', before, after)` — action
  is `'update'`, not a new `'CATALOG_ENTITY_RESTORED'` value: `audit_log`'s own
  `action` CHECK constraint only allows `insert`/`update`/`delete`/`status_change`
  (confirmed live), the same convention `archive_ticket()` already uses for its own
  archive event.
- Return the restored row as `jsonb` (`to_jsonb`, with `unit_price` cast to `::text` for
  the `product_variant` case per the money-in-jsonb hazard documented for
  `get_daily_revenue_summary`) — not a typed `RETURNS products`/etc., since one function
  serves three different row shapes.
- `REVOKE ALL ... FROM PUBLIC, anon, authenticated; GRANT EXECUTE ... TO authenticated`.

**`archive_catalog_entity` was built in the same migration, symmetric to restore, and
was NOT anticipated by this section originally** — the write-path test suite proved live
that a direct PostgREST `UPDATE` can never set `deleted_at` at all (Postgres refuses any
write that would make the new row fail the table's own SELECT policy), so archiving
needed exactly the same kind of RPC restoring did. Same contract shape, same role gate,
opposite `deleted_at`/`deleted_by` direction.

**Error type definitions (add to `packages/api/errors/index.ts`):**

```typescript
export class CatalogEntityDeletedError extends BakeflowApiError {
  readonly code = 'catalog_entity_deleted';
  constructor(public readonly meta: { entity: string; id: string; name: string }) {
    super(`${meta.entity} "${meta.name}" exists but is soft-deleted`);
  }
}

export class DuplicateNameError extends BakeflowApiError {
  readonly code = 'duplicate_name';
  constructor(public readonly meta: { entity: string; name: string }) {
    super(`${meta.entity} "${meta.name}" already exists`);
  }
}
```

**Query cache invalidation after restore:**

After a successful restore, invalidate the TanStack Query cache keys for that entity type's list query so the restored entity immediately appears in the catalog list without a manual refresh.

### What Claude Code must NOT do

- Do not show a generic "Name already taken" error when a deleted row caused the conflict.
- Do not allow `cashier`, `baker`, `driver`, or `supervisor` roles to initiate a restore.
- Do not restore by directly calling `UPDATE products SET deleted_at = NULL` from the client — route through the `restore_catalog_entity` RPC.
- Do not skip the `audit_log` entry on restore.
- Do not re-grant `EXECUTE` on `restore_catalog_entity` to `anon`.
