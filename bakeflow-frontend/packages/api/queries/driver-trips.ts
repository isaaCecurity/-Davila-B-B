/**
 * Driver trip read service — ADR-001, Phases 2-3 live 2026-08-24. **Read path only.**
 *
 * ## Mechanism: PostgREST + RLS, not RPCs
 *
 * Same rule as every other domain (`API-CONTRACT.md` §1, `queries/delivery.ts`). No driver
 * trip read RPC exists and none should be written.
 *
 * ## The write path lives in `mutations/driver-trips.ts`
 *
 * `authenticated` holds **no** `INSERT`/`UPDATE`/`DELETE` grant on `driver_trips` at all —
 * a stricter posture than `deliveries` (`INSERT, SELECT`), verified live. Every state
 * change is a `SECURITY DEFINER` RPC; see the module header there.
 *
 * ## The SELECT policy, read live
 *
 * ```sql
 * tenant_id = current_tenant_id()
 *   AND (driver_id = auth.uid() OR has_branch_access(branch_id))
 *   AND deleted_at IS NULL
 * ```
 *
 * The same disjunction `deliveries_select` uses, for the same reason: a driver sees their
 * own trip regardless of branch assignment, and branch-scoped staff see every trip at
 * branches they can reach. `filters.branchId`/`filters.driverId` below are conveniences,
 * never the security boundary.
 *
 * ## Money columns
 *
 * `expected_cash`, `physical_cash` and `cash_variance` are all `NUMERIC(19,4)` and all
 * `::text`-cast in the projection below, for the reason given in `@bakeflow/types`
 * `scalars.ts`.
 */

import type { DriverTrip, DriverTripStatus, Uuid } from '@bakeflow/types';
import { driverTripSchema } from '@bakeflow/validation';

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

const TEXT_CAST_COLUMNS: ReadonlySet<string> = new Set([
  'expected_cash',
  'physical_cash',
  'cash_variance',
]);

const DRIVER_TRIPS: ReadEntity<DriverTrip> = {
  table: 'driver_trips',
  schema: driverTripSchema,
  columns: projectionFor(driverTripSchema as unknown as SchemaShape, TEXT_CAST_COLUMNS),
  softDeleted: true,
};

/** Statuses a trip has not yet finished — everything but `completed`. Matches the
 *  `driver_trips_one_active_per_driver` partial unique index's own definition of
 *  "active", so this filter and that constraint never disagree about what is open. */
const ACTIVE_DRIVER_TRIP_STATUSES: readonly DriverTripStatus[] = [
  'created',
  'loading',
  'ready_to_depart',
  'in_transit',
  'returning',
  'reconciled',
];

/** Filters for the trip list. All optional, combined with AND. */
export interface DriverTripFilters {
  status?: DriverTripStatus;
  /** Restrict to trips that have not reached `completed`. */
  activeOnly?: boolean;
  branchId?: Uuid;
  driverId?: Uuid;
  /** Inclusive lower bound on `created_at`, as an ISO-8601 timestamp. */
  since?: string;
}

/**
 * One page of driver trips, newest first.
 *
 * Composite `(created_at, id)` cursor — same reasoning as `listDeliveries`: rows written in
 * one transaction can share a `created_at` to the microsecond, and a single-column cursor
 * would silently drop siblings.
 */
export async function listDriverTrips(
  client: BakeflowClient,
  filters: DriverTripFilters = {},
  options: PageOptions = {},
): Promise<Page<DriverTrip>> {
  const context = 'listDriverTrips';
  const limit = resolveLimit(options.limit);

  let query = withSoftDeleteFilter(
    client.from(DRIVER_TRIPS.table).select(DRIVER_TRIPS.columns),
    DRIVER_TRIPS,
  );

  if (filters.status !== undefined) query = query.eq('status', filters.status);
  if (filters.activeOnly === true) {
    query = query.in('status', [...ACTIVE_DRIVER_TRIP_STATUSES]);
  }
  if (filters.branchId !== undefined) query = query.eq('branch_id', filters.branchId);
  if (filters.driverId !== undefined) query = query.eq('driver_id', filters.driverId);
  if (filters.since !== undefined) query = query.gte('created_at', filters.since);

  if (options.after !== undefined) {
    const { sortValue, id } = decodeCursor(options.after, context);
    const ts = quoteFilterValue(sortValue);
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
  const rows = parseRows(DRIVER_TRIPS.schema, data, context);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page.length > 0 ? page[page.length - 1] : undefined;

  return {
    rows: page,
    nextCursor: hasMore && last !== undefined ? encodeCursor(last.created_at, last.id) : null,
  };
}

/**
 * One driver trip, or `null` when it does not exist, belongs to another organization, or
 * sits in a branch the caller cannot reach and is not their own.
 */
export async function getDriverTripById(
  client: BakeflowClient,
  tripId: Uuid,
): Promise<DriverTrip | null> {
  const data = await run(
    withSoftDeleteFilter(
      client.from(DRIVER_TRIPS.table).select(DRIVER_TRIPS.columns).eq('id', tripId),
      DRIVER_TRIPS,
    ).maybeSingle(),
  );
  return parseRow(DRIVER_TRIPS.schema, data, 'getDriverTripById');
}

/**
 * The calling driver's own active (non-`completed`) trip, or `null` when they have none.
 *
 * `.maybeSingle()` is safe because `driver_trips_one_active_per_driver` is a live partial
 * unique index on `(tenant_id, driver_id) WHERE status <> 'completed' AND deleted_at IS
 * NULL` — at most one row can match, by construction. This is the query the driver Home
 * screen anchors on: "what trip, if any, am I in the middle of."
 */
export async function getCurrentDriverTrip(
  client: BakeflowClient,
  driverId: Uuid,
): Promise<DriverTrip | null> {
  const data = await run(
    withSoftDeleteFilter(
      client
        .from(DRIVER_TRIPS.table)
        .select(DRIVER_TRIPS.columns)
        .eq('driver_id', driverId)
        .in('status', [...ACTIVE_DRIVER_TRIP_STATUSES]),
      DRIVER_TRIPS,
    ).maybeSingle(),
  );
  return parseRow(DRIVER_TRIPS.schema, data, 'getCurrentDriverTrip');
}
