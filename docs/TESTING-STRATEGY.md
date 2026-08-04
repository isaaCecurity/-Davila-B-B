# BakeFlow — Testing Strategy

**Status:** canonical. A phase is not complete when the code runs; it is complete when the tests below pass.

---

## 1. What actually needs testing

Three things can hurt a real bakery. Everything else is secondary:

1. **Tenant leakage.** One organization seeing another's data. Catastrophic and unrecoverable in reputation terms.
2. **Financial incorrectness.** Totals that don't add up, payments double-counted, rounding drift. Violates Core Principles 2 and 3.
3. **Stock divergence.** Level tables disagreeing with the movement ledger, or stock going negative. Breaks the operational-correctness-drives-financial-correctness chain.

Test these exhaustively. Test UI rendering lightly.

---

## 2. Test layers

| Layer | Tool | Scope | When |
|---|---|---|---|
| Spec invariants | pytest | Naming and type consistency across docs | Every commit |
| Database | pgTAP or SQL scripts via Supabase CLI | RLS, constraints, triggers, RPCs | Every migration |
| Integration | Vitest + local Supabase | Client → RPC → database round trips | Every feature |
| Component | React Native Testing Library | Screens with mocked data | Selectively |
| End-to-end | Maestro or Detox | The nine steps of the core user journey | Before release |

Database tests carry the most weight. A passing RLS test is worth more than a hundred passing component snapshots.

---

## 3. Tenant isolation suite

Run against every table after every phase. Fixtures: organization A (user A1 owner, A2 baker assigned to branch A1 only), organization B (user B1 owner).

For each tenant-scoped table:

1. Rows exist for both A and B.
2. As A1, `SELECT` returns only A's rows. **Count equality is not sufficient** — assert no returned `tenant_id` equals B's.
3. As A1, `UPDATE` targeting a B row affects 0 rows.
4. As A1, `DELETE` targeting a B row affects 0 rows.
5. As A1, `INSERT` with `tenant_id = B` is rejected by `WITH CHECK`.
6. As A1, `UPDATE` of an owned row setting `tenant_id = B` is rejected. *(Catches the missing-`WITH CHECK` bug.)*
7. As an anonymous client, `SELECT` returns nothing.

For each branch-scoped table, additionally: as A2 (branch A1 only), rows belonging to branch A2 are invisible.

For each append-only table: `UPDATE` and `DELETE` both fail.

**Automate the table list.** Query `information_schema` for every table in `public`, and fail the suite if any table has `rowsecurity = false` or has zero policies. New tables then cannot be added without policies:

```sql
select c.relname
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
  and (not c.relrowsecurity
       or not exists (select 1 from pg_policy p where p.polrelid = c.oid));
```

This query must return zero rows. It is the single most valuable test in the suite.

---

## 4. Financial correctness suite

**Type enforcement.** Assert every monetary column is `numeric(19,4)`:

```sql
select table_name, column_name, numeric_precision, numeric_scale
from information_schema.columns
where table_schema = 'public'
  and (column_name like '%amount%' or column_name like '%price%'
       or column_name like '%total%' or column_name like '%cost%'
       or column_name like '%float%')
  and (data_type <> 'numeric' or numeric_precision <> 19 or numeric_scale <> 4);
```

Must return zero rows. Catches any float or `(18,2)` slipping back in.

**Invariants:**

- `orders.total_amount = subtotal − discount + tax`, always.
- `orders.subtotal_amount = SUM(order_items.line_total)`, after every item mutation.
- `order_items.line_total = ROUND(quantity × unit_price, 4)`.
- `orders.amount_paid = SUM(payments.amount)` for that order, after every payment.
- Refunds against a payment never exceed the payment amount.
- `cash_sessions.variance = counted − expected`, and `expected = float + cash payments − cash expenses`.

**Rounding:** run a batch of 1,000 randomized orders with awkward quantities (0.3333, 7 × 1.1, prices ending in odd kobo). Assert the sum of `line_total` equals the recomputed subtotal exactly. Any drift means rounding is happening mid-calculation, violating Core Principle 2.

**Price snapshot:** create an order, change the variant's `unit_price`, assert the existing `order_items.unit_price` is unchanged and the order total is unchanged. This is the test that catches someone "helpfully" joining to live prices.

---

## 5. Stock integrity suite

**The reconciliation test** — the most important one in this section:

```sql
select l.warehouse_id, l.ingredient_id, l.quantity_on_hand, coalesce(m.total, 0) as ledger_total
from ingredient_stock_levels l
left join (
  select warehouse_id, ingredient_id, sum(quantity_delta) as total
  from stock_movements where item_type = 'ingredient'
  group by 1, 2
) m using (warehouse_id, ingredient_id)
where l.quantity_on_hand <> coalesce(m.total, 0);
```

Zero rows, always. Run it after every stock-touching test and as a production health check. If it ever returns rows, the level cache has diverged and the trigger has a bug.

**Cases:**

- Insert movement → level updates by exactly the delta.
- Movement for a key with no level row → row created.
- Concurrent movements for the same key → final level equals the sum. Run 50 parallel inserts to catch a missing row lock.
- `production_consume` that would go negative → raises, and neither movement nor level change.
- Complete a batch → exactly one consume movement per recipe ingredient plus one output movement, all in one transaction.
- Force a failure mid-completion → no movements persist at all.
- `UPDATE` and `DELETE` on `stock_movements` → both raise.

---

## 6. State machine suite

For each entity in `STATE-MACHINES.md`, generate every from/to pair and assert legal ones succeed and illegal ones raise. A table-driven test is short and catches transitions someone adds later without thinking:

- Every legal transition succeeds for an authorized role.
- Every illegal transition raises `invalid_transition`.
- Every legal transition raises `insufficient_role` for an unauthorized role.
- No transition leaves a terminal state.
- Required fields are enforced (cancellation reason, failure reason, variance note).
- `order_items` mutation is blocked once the order is ready, completed, or cancelled.
- Two concurrent `open_cash_session` calls for one branch → exactly one succeeds.

---

## 7. Journey tests

The nine steps in `PROJECT-OVERVIEW.md` §4, as one end-to-end test: sign up → create org and branch → add product, variant, recipe, ingredients → record opening stock → create and confirm an order → run a production batch → fulfil → record payment → log an expense → assert the dashboard figures.

The final assertion is the one that matters: **revenue, expenses, and stock on the dashboard must be derivable from steps 1–8 with no manual entry.** That is Core Principle 3 as an executable test. If a number on the dashboard cannot be traced to a recorded event, the test fails.

---

## 8. Per-phase gates

| Phase | Must pass before proceeding |
|---|---|
| 1 — org, branch, profiles | RLS coverage query returns zero; isolation suite; signup trigger creates a profile |
| 2 — RBAC, invites | Role-based policy tests; JWT claims contain `tenant_id` and `roles`; invite accept is atomic; users cannot self-assign roles |
| 3 — catalog, recipes | Isolation on all catalog tables; SKU uniqueness per tenant; one active recipe per variant |
| 4 — inventory | Reconciliation query; negative-stock refusal; concurrency test; append-only enforcement |
| 5 — orders, payments | All financial invariants; price snapshot; item freeze; payment append-only |
| 6 — production, delivery, cash | Batch atomicity and rollback; delivery driver scoping; one open session per branch; variance note enforcement |

---

## 9. Extending the spec tests

`tests/test_spec_coverage.py` currently guards documentation consistency. Keep extending it as decisions are made, so a regenerated document cannot silently reintroduce a resolved conflict. Current invariants worth locking: no `organization_id`, `bakery_id`, or `company_id` anywhere; no `NUMERIC(18,2)`; no `uuid_generate_v4()`; requirement IDs unique; the canonical tenant column and money type appear in the documents that define them.

These tests cost milliseconds and prevent the exact class of drift that made three documents contradict each other in the first place.
