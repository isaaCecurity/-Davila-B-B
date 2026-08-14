/**
 * Delivery read service — P4.5. **Read path only.**
 *
 * ## Mechanism: PostgREST + RLS, not RPCs
 *
 * Same rule as every other domain (`API-CONTRACT.md` §1). No delivery read RPC exists and
 * none should be written.
 *
 * ## Why there is no write path
 *
 * Every delivery mutation is a guarded transition, and two of them move stock:
 * `failed → returned` and `in_transit → returned` each write a return movement
 * (`STATE-MACHINES.md` §3). Under universal rule 4 a transition that moves stock runs in
 * one transaction with the movement it causes — so those hops are RPCs by construction, in
 * exactly the way `complete_production_batch()` is, and assembling one from client calls
 * would risk marking a delivery returned with no stock movement recorded.
 *
 * Their signatures have not been read from the live database (BLOCKER-011), so none is
 * written here. `adjust_stock()` is the standing precedent for why that matters.
 *
 * ## Provenance
 *
 * Types, schema and the column set below come from `SCHEMA-REFERENCE.md` §6 and
 * `STATE-MACHINES.md` §3, not from a live read. The queries assert no RLS predicate — they
 * filter what they need explicitly and let the server decide what is visible.
 *
 * ## No money, so no `::text` cast
 *
 * `deliveries` has no `NUMERIC` column. `projectionFor` is still used rather than a
 * hand-written column list, so the projection cannot drift from the schema, but the
 * text-cast set it is given is empty and that is correct.
 */

import type { Delivery, DeliveryStatus, Uuid } from '@bakeflow/types';
import { deliverySchema } from '@bakeflow/validation';

import type { BakeflowClient } from '../client';
import {
  decodeCursor,
  encodeCursor,
  parseRow,
  parseRows,
  projectionFor,
  quoteFilterValue,
  resolveLimit,
  run,
  withSoftDeleteFilter,
  type Page,
  type PageOptions,
  type ReadEntity,
  type SchemaShape,
} from '../internal/read';

/**
 * Empty on purpose: `deliveries` carries no `NUMERIC(19,4)` or `NUMERIC(18,4)` column, so
 * there is nothing whose scale JSON transport could destroy. Passed explicitly rather than
 * omitted so the next person to add a fee or a distance column has an obvious place to put
 * it.
 */
const TEXT_CAST_COLUMNS: ReadonlySet<string> = new Set<string>();

/**
 * `softDeleted: false` — `SCHEMA-REFERENCE.md` §6 lists `[std]` alone for `deliveries`,
 * the `created_at`/`updated_at`/`created_by` trio from §0, where §4 spells out
 * `+ deleted_at, deleted_by` for `tickets` explicitly. Filtering a column that does not
 * exist would fail the whole read with `42703`, so the flag drives the predicate rather
 * than the predicate being assumed. Verified by D1c in `tests/sql/delivery_read_rls.sql`.
 */
const DELIVERIES: ReadEntity<Delivery> = {
  table: 'deliveries',
  schema: deliverySchema,
  columns: projectionFor(deliverySchema as unknown as SchemaShape, TEXT_CAST_COLUMNS),
  softDeleted: false,
};

/** Filters for the delivery list. All optional, combined with AND. */
export interface DeliveryFilters {
  status?: DeliveryStatus;
  /**
   * Restrict to deliveries that have not reached a terminal state.
   *
   * Provided as a flag rather than left to the caller because the set is easy to get
   * wrong: `failed` is **not** terminal — its exit is `returned`, and that hop writes a
   * return stock movement. A dispatch board that filtered `failed` out would drop exactly
   * the deliveries someone still has to act on.
   */
  openOnly?: boolean;
  branchId?: Uuid;
  driverId?: Uuid;
  /** Inclusive lower bound on `created_at`, as an ISO-8601 timestamp. */
  since?: string;
}

/** The four statuses a delivery can still leave. `failed` is one of them. */
const OPEN_DELIVERY_STATUSES: readonly DeliveryStatus[] = [
  'pending',
  'assigned',
  'in_transit',
  'failed',
];

/**
 * One page of deliveries, **newest first**.
 *
 * Composite `(created_at, id)` cursor, for the same reason tickets and the stock ledger use
 * one: rows created together in a sync batch share a `created_at` to the microsecond, and a
 * single-column cursor would silently drop every sibling sharing that instant.
 *
 * Ordered on `created_at` rather than the more natural-looking `scheduled_at`, which is
 * **nullable**: an unscheduled delivery would sort into a NULL group whose position depends
 * on `NULLS FIRST`/`LAST`, and a cursor comparison against NULL yields NULL — which reads
 * as "no more rows" and would truncate the list without an error.
 */
export async function listDeliveries(
  client: BakeflowClient,
  filters: DeliveryFilters = {},
  options: PageOptions = {},
): Promise<Page<Delivery>> {
  const context = 'listDeliveries';
  const limit = resolveLimit(options.limit);

  let query = withSoftDeleteFilter(
    client.from(DELIVERIES.table).select(DELIVERIES.columns),
    DELIVERIES,
  );

  if (filters.status !== undefined) query = query.eq('status', filters.status);
  if (filters.openOnly === true) query = query.in('status', [...OPEN_DELIVERY_STATUSES]);
  if (filters.branchId !== undefined) query = query.eq('branch_id', filters.branchId);
  if (filters.driverId !== undefined) query = query.eq('driver_id', filters.driverId);
  if (filters.since !== undefined) query = query.gte('created_at', filters.since);

  if (options.after !== undefined) {
    const { sortValue, id } = decodeCursor(options.after, context);
    const ts = quoteFilterValue(sortValue);
    // (created_at, id) < (cursor.created_at, cursor.id) under DESC ordering.
    query = query.or(
      `created_at.lt.${ts},and(created_at.eq.${ts},id.lt.${quoteFilterValue(id)})`,
    );
  }

  const data = await run(
    query
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1),
  );
  const rows = parseRows(DELIVERIES.schema, data, context);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page.length > 0 ? page[page.length - 1] : undefined;

  return {
    rows: page,
    nextCursor: hasMore && last !== undefined ? encodeCursor(last.created_at, last.id) : null,
  };
}

/**
 * One delivery, or `null` when it does not exist, belongs to another organization, or sits
 * in a branch the caller cannot reach. All three are indistinguishable by design.
 */
export async function getDeliveryById(
  client: BakeflowClient,
  deliveryId: Uuid,
): Promise<Delivery | null> {
  const data = await run(
    withSoftDeleteFilter(
      client.from(DELIVERIES.table).select(DELIVERIES.columns).eq('id', deliveryId),
      DELIVERIES,
    ).maybeSingle(),
  );
  return parseRow(DELIVERIES.schema, data, 'getDeliveryById');
}

/**
 * The delivery for one ticket, or `null` when the ticket is a pickup, has no delivery
 * raised yet, or is not visible to the caller.
 *
 * `maybeSingle()` is safe because `deliveries.ticket_id` is `NOT NULL UNIQUE` (§6) — at
 * most one row can match.
 *
 * **This is the lookup that answers "may this ticket move `ready → delivered`?"** — but it
 * only *reports* the answer. The guard trigger performs the same lookup itself and is the
 * authority; see `isDeliveryVerified` in `@bakeflow/types` `delivery.ts`.
 */
export async function getDeliveryForTicket(
  client: BakeflowClient,
  ticketId: Uuid,
): Promise<Delivery | null> {
  const data = await run(
    withSoftDeleteFilter(
      client.from(DELIVERIES.table).select(DELIVERIES.columns).eq('ticket_id', ticketId),
      DELIVERIES,
    ).maybeSingle(),
  );
  return parseRow(DELIVERIES.schema, data, 'getDeliveryForTicket');
}
