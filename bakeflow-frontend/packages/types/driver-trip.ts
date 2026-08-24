/**
 * Driver trip domain types — ADR-001 (`docs/ADR-001-Driver-Workflow-Redesign-MVP.md`),
 * Phases 2-3 live 2026-08-24.
 *
 * ## Provenance
 *
 * Written directly from the live schema and RPC bodies applied in this same pass
 * (`adr001_phase2_driver_trips_schema`, `adr001_phase3_driver_trip_lifecycle_rpcs`,
 * `adr001_phase3_payment_and_close_session_custody`), and cross-checked again against
 * `docs/STATE-MACHINES.md` §6, which was itself verified against `pg_get_functiondef` on
 * every RPC and trigger below. Not generated, not inferred from documentation alone.
 *
 * ## `driver_trips` is RPC-only
 *
 * Unlike `deliveries` (`INSERT, SELECT`) or `production_batches` (blanket `UPDATE`),
 * `authenticated` holds **no** `INSERT`/`UPDATE`/`DELETE` grant on `driver_trips` at all —
 * verified live, and the default-privilege grant Postgres gives new tables was found and
 * explicitly revoked (`revoke_direct_write_grants_on_driver_trips`). Every state change in
 * this file's write path (`@bakeflow/api` `mutations/driver-trips.ts`) is therefore a
 * `SECURITY DEFINER` RPC; there is no direct-table-write alternative to guard against.
 *
 * ## The seven states are backend/domain vocabulary, not driver vocabulary
 *
 * `docs/ADR-001-Driver-Workflow-Redesign-MVP.md` §3.1 and §15 rule 9: the driver never sees
 * `ready_to_depart` or `reconciled` as such. The mobile UI maps this lifecycle down to
 * "Load → Go → Sell → Record Payment → Repeat → Return → Reconcile" — see
 * `apps/mobile/app/driver/home.tsx` and `driverTripPhaseLabel` below, which exists
 * specifically so no screen has to invent its own copy for a raw status value.
 *
 * ## Cash fields are null until reconciliation
 *
 * `expected_cash`, `physical_cash`, `cash_variance` and `reconciled_by`/`reconciled_at` are
 * all null until `reconcile_driver_trip()` runs (`returning -> reconciled`) — the structural
 * CHECK `driver_trips_reconciled_needs_cash` requires them non-null only from `reconciled`
 * onward. `cash_variance` is the one signed money value in this schema — see
 * `@bakeflow/validation` `decimal.ts`'s `signedMoneySchema` for why.
 */

import type { Money, Timestamptz, Uuid } from './scalars';

/**
 * Live `CHECK` (`driver_trips_status_check`), matching `STATE-MACHINES.md` §6:
 *
 * ```
 * created ──► loading ──► ready_to_depart ──► in_transit ──► returning ──► reconciled ──► completed
 * ```
 *
 * Linear — `guard_driver_trip_transition()` allows exactly one next state per current
 * state, with no branching and no skipping. `loading` is real and audit-logged but is
 * reached and left within a single `verify_trip_loading()` call; no client ever observes a
 * trip resting in it.
 */
export const DRIVER_TRIP_STATUSES = [
  'created',
  'loading',
  'ready_to_depart',
  'in_transit',
  'returning',
  'reconciled',
  'completed',
] as const;
export type DriverTripStatus = (typeof DRIVER_TRIP_STATUSES)[number];

/** `completed` is the only terminal state — `guard_driver_trip_transition()`'s `else`
 *  branch is empty for it, and `prevent_driver_trip_delete()` blocks deletion outright. */
export const TERMINAL_DRIVER_TRIP_STATUSES = ['completed'] as const satisfies readonly DriverTripStatus[];

/** Advisory, mirroring the guard trigger for display purposes only — see the module
 *  header on why `driver_trips` write paths never trust the client either way. */
export function isTerminalDriverTripStatus(status: DriverTripStatus): boolean {
  return (TERMINAL_DRIVER_TRIP_STATUSES as readonly string[]).includes(status);
}

/**
 * The driver-facing phase a raw status maps to, per ADR-001 §3.1/§15 rule 9.
 *
 * `loading` and `ready_to_depart` both read as "Loading" to a driver — the difference
 * between them is which side of one atomic `verify_trip_loading()` call the trip is on,
 * which is exactly the kind of backend-internal boundary this ADR says not to surface.
 * `reconciled` and `completed` both read as "Reconciling" — the driver's own job (Return)
 * is done in both; only a manager acts from here on.
 */
export type DriverTripPhase = 'starting' | 'loading' | 'selling' | 'returning' | 'reconciling' | 'done';

const PHASE_BY_STATUS: Readonly<Record<DriverTripStatus, DriverTripPhase>> = {
  created: 'starting',
  loading: 'loading',
  ready_to_depart: 'loading',
  in_transit: 'selling',
  returning: 'returning',
  reconciled: 'reconciling',
  completed: 'done',
};

export function driverTripPhase(status: DriverTripStatus): DriverTripPhase {
  return PHASE_BY_STATUS[status];
}

/** Short, driver-facing label for a phase. Never render `status` directly on a driver
 *  screen — this function (or a manager-facing equivalent) is the one place that copy
 *  lives, so it cannot drift screen to screen. */
export function driverTripPhaseLabel(phase: DriverTripPhase): string {
  switch (phase) {
    case 'starting':
      return 'Waiting for loading';
    case 'loading':
      return 'Loading';
    case 'selling':
      return 'On the road';
    case 'returning':
      return 'Returning';
    case 'reconciling':
      return 'Reconciling';
    case 'done':
      return 'Trip complete';
  }
}

/**
 * A driver trip — `driver_trips`.
 *
 * `warehouse_id` is the driver's vehicle, represented as an ordinary `warehouses` row
 * (`STATE-MACHINES.md` §6 "Loading verification and inventory custody") — no separate
 * vehicle concept exists.
 *
 * `settlement_cash_session_id` is set once, by `complete_driver_trip()`, and never before —
 * it names the branch till session that absorbed this trip's reconciled cash (AD-018). It
 * is not the trip's own custody context; see `@bakeflow/api` `queries/driver-trips.ts` for
 * how a trip's own cash is read (via `payments.driver_trip_id`, not this column).
 */
export interface DriverTrip {
  id: Uuid;
  tenant_id: Uuid;
  branch_id: Uuid;
  driver_id: Uuid;
  warehouse_id: Uuid;
  status: DriverTripStatus;
  /** Set together by `verify_trip_loading()`. Null before `ready_to_depart`. */
  loading_verified_by: Uuid | null;
  loading_verified_at: Timestamptz | null;
  /** Set by `depart_driver_trip()` (`ready_to_depart -> in_transit`). */
  departed_at: Timestamptz | null;
  /** Set by `return_driver_trip()` (`in_transit -> returning`). */
  returned_at: Timestamptz | null;
  /** Null until `reconcile_driver_trip()`. Sum of the trip's own `cash`-method payments,
   *  computed server-side — never trusted from the client. */
  expected_cash: Money | null;
  /** Null until `reconcile_driver_trip()`. What the driver actually returned. */
  physical_cash: Money | null;
  /** Null until `reconcile_driver_trip()`. `physical_cash - expected_cash` — may be
   *  negative. See `signedMoneySchema` in `@bakeflow/validation`. */
  cash_variance: Money | null;
  /** Required by a standing CHECK whenever `cash_variance <> 0`. */
  cash_variance_note: string | null;
  /** Null until `complete_driver_trip()`. The branch `cash_sessions` row this trip's cash
   *  was settled into — see the interface doc comment above. */
  settlement_cash_session_id: Uuid | null;
  reconciled_by: Uuid | null;
  reconciled_at: Timestamptz | null;
  /** Column exists; no live RPC writes it yet. Always null today. */
  reconciliation_note: string | null;
  created_at: Timestamptz;
  updated_at: Timestamptz;
  /** Optimistic-concurrency counter, bumped by the (reused) `bump_cash_session_revision()`
   *  trigger on every update. Not currently read by any mutation in this package. */
  revision: number;
}
