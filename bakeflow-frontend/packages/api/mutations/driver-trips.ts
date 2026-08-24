/**
 * Driver trip write path — ADR-001, Phases 2-3 live 2026-08-24. **Seven RPCs, zero table
 * writes.**
 *
 * ## Why nothing here is a table write
 *
 * `authenticated` holds **no** `INSERT`/`UPDATE`/`DELETE` grant on `driver_trips` at all —
 * verified live, and the default-privilege grant Postgres gives new tables was found and
 * explicitly revoked (`revoke_direct_write_grants_on_driver_trips`). A stricter posture
 * than `deliveries` (`INSERT, SELECT`): there is no direct-write alternative to guard
 * against here, only the RPC surface below.
 *
 * ## The contracts, read from the live function bodies applied this same pass
 *
 * ```
 * start_driver_trip(p_branch_id uuid, p_warehouse_id uuid) RETURNS jsonb
 * verify_trip_loading(p_trip_id uuid, p_items jsonb, p_source_warehouse_id uuid DEFAULT NULL) RETURNS jsonb
 * depart_driver_trip(p_trip_id uuid) RETURNS jsonb
 * return_driver_trip(p_trip_id uuid, p_items jsonb) RETURNS jsonb
 * reconcile_driver_trip(p_trip_id uuid, p_physical_cash numeric, p_variance_note text DEFAULT NULL) RETURNS jsonb
 * complete_driver_trip(p_trip_id uuid, p_settlement_cash_session_id uuid) RETURNS jsonb
 * record_payment(p_order_id uuid, p_amount numeric, p_method text, p_reference text DEFAULT NULL,
 *   p_cash_session_id uuid DEFAULT NULL, p_driver_trip_id uuid DEFAULT NULL) RETURNS jsonb
 * ```
 *
 * `record_payment` is not driver-trip-specific — it is the same function every payment in
 * the system goes through. Only the trip-scoped call (`p_driver_trip_id` set,
 * `p_cash_session_id` omitted) is wrapped here as `recordDriverTripPayment`, because no
 * general payments module exists yet in this package; a till-scoped caller would need its
 * own wrapper, not this one.
 *
 * ### The legal graph is the trigger's, not this module's
 *
 * `guard_driver_trip_transition()` fires `BEFORE UPDATE OF status` and is the authority —
 * see `STATE-MACHINES.md` §6 for the full table. Linear, no branches:
 *
 * ```
 * created -> loading -> ready_to_depart -> in_transit -> returning -> reconciled -> completed
 * ```
 *
 * ### Role enforcement lives in the RPCs, not the trigger
 *
 * Unlike `guard_delivery_transition()`, the driver trip guard trigger checks only
 * transition legality and writes the audit row — each RPC independently checks
 * role/branch-access/trip-ownership before ever issuing its `UPDATE`:
 *
 * - `start_driver_trip` — the caller must hold the `driver` role and branch access.
 * - `verify_trip_loading` — owner/admin/branch_manager/supervisor/baker (the verifier,
 *   never the driver themself). Requires `status = 'created'`.
 * - `depart_driver_trip` / `return_driver_trip` — the trip's own driver
 *   (`driver_id = auth.uid()`) only, no manager override. Require `ready_to_depart` /
 *   `in_transit` respectively.
 * - `reconcile_driver_trip` — owner/admin/branch_manager/supervisor. Requires `returning`.
 * - `complete_driver_trip` — owner/admin/branch_manager. Requires `reconciled`, and the
 *   named settlement session must be open at the trip's own branch.
 *
 * ### `verify_trip_loading` / `return_driver_trip` reach two guard-checked transitions
 *
 * `verify_trip_loading` moves `created -> loading -> ready_to_depart` inside one call —
 * both are real, audit-logged transitions, but a client never observes the trip resting in
 * `loading`. See `@bakeflow/types` `driver-trip.ts` for why the UI never surfaces that
 * distinction either.
 *
 * ## Precision
 *
 * All seven functions return `to_jsonb`-shaped envelopes, which renders `numeric` unquoted
 * and would destroy its scale (`@bakeflow/types` `scalars.ts`, TD-012). Every mutation here
 * therefore only checks the envelope's *shape*, then re-reads the row through
 * `getDriverTripById` (or, for the payment, returns only non-monetary confirmation fields
 * plus the amount as the exact string this module already validated on the way in — never
 * a value parsed back out of the envelope).
 */

import type { DriverTrip, Quantity, Uuid } from '@bakeflow/types';
import {
  nonNegativeMoneySchema,
  positiveQuantitySchema,
  uuidSchema,
} from '@bakeflow/validation';

import type { BakeflowClient } from '../client';
import { BakeflowApiError, normalizePostgrestError, normalizeThrown } from '../errors';
import { getDriverTripById } from '../queries/driver-trips';

/** One line of a load or return manifest. Mirrors the `p_items` jsonb array both
 *  `verify_trip_loading` and `return_driver_trip` take. */
export interface DriverTripManifestItem {
  itemType: 'ingredient' | 'product';
  itemId: Uuid;
  /** Exact decimal string, never a JS `number` — see `mutations/inventory.ts`. Must be
   *  `> 0`; the RPC re-validates and this is only a fail-fast check. */
  quantity: string;
}

/** `MVP payment methods` per AD-017 — the four `record_payment` accepts. */
export type DriverTripPaymentMethod = 'cash' | 'card' | 'transfer' | 'pos';

/* -------------------------------------------------------------------------- */
/* start_driver_trip                                                          */
/* -------------------------------------------------------------------------- */

export interface StartDriverTripInput {
  branchId: Uuid;
  /** The driver's vehicle, as an existing `warehouses` row at this branch. */
  warehouseId: Uuid;
}

/**
 * Start a new trip. Driver-only.
 *
 * @throws {BakeflowApiError} `insufficient_role` when the caller is not a driver or lacks
 *   branch access; `invalid_request` when the warehouse does not belong to the branch;
 *   `invalid_transition` (`trip_already_active`) when the driver already has an open trip —
 *   `driver_trips_one_active_per_driver` refuses a second row outright.
 */
export async function startDriverTrip(
  client: BakeflowClient,
  input: StartDriverTripInput,
): Promise<DriverTrip> {
  if (!uuidSchema.safeParse(input.branchId).success) {
    throw invalid('startDriverTrip', 'branchId must be a uuid');
  }
  if (!uuidSchema.safeParse(input.warehouseId).success) {
    throw invalid('startDriverTrip', 'warehouseId must be a uuid');
  }

  const payload = await run(
    client.rpc('start_driver_trip', {
      p_branch_id: input.branchId,
      p_warehouse_id: input.warehouseId,
    }),
  );

  const tripId = extractTripId(payload, 'startDriverTrip');
  return readBack(client, tripId, 'startDriverTrip');
}

/* -------------------------------------------------------------------------- */
/* verify_trip_loading                                                        */
/* -------------------------------------------------------------------------- */

export interface VerifyTripLoadingInput {
  items: readonly DriverTripManifestItem[];
  /** Overrides the branch's default warehouse as the load source. Rarely needed. */
  sourceWarehouseId?: Uuid;
}

/**
 * Record and verify what was loaded — the one-party confirmation ADR-001 §23 item 5
 * resolved on. Never called by the driver themself; see the module header for who may.
 *
 * @throws {BakeflowApiError} `insufficient_role` when the caller is not an authorized
 *   verifier; `invalid_transition` when the trip is not freshly `created`;
 *   `invalid_request` for an empty manifest, a malformed item, or no default warehouse.
 */
export async function verifyTripLoading(
  client: BakeflowClient,
  tripId: Uuid,
  input: VerifyTripLoadingInput,
): Promise<DriverTrip> {
  if (!uuidSchema.safeParse(tripId).success) {
    throw invalid('verifyTripLoading', 'tripId must be a uuid');
  }
  if (input.items.length === 0) {
    throw invalid('verifyTripLoading', 'at least one item must be loaded');
  }

  const payload = await run(
    client.rpc('verify_trip_loading', {
      p_trip_id: tripId,
      p_items: input.items.map(parseManifestItem),
      p_source_warehouse_id: input.sourceWarehouseId ?? null,
    }),
  );

  assertEnvelopeHasTrip(payload, 'verifyTripLoading');
  return readBack(client, tripId, 'verifyTripLoading');
}

/* -------------------------------------------------------------------------- */
/* depart_driver_trip                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Leave the bakery. Only the trip's own driver — no manager override, unlike most
 * transitions elsewhere in the schema.
 *
 * @throws {BakeflowApiError} `insufficient_role` when the caller is not this trip's
 *   driver; `invalid_transition` when the trip is not `ready_to_depart`.
 */
export async function departDriverTrip(client: BakeflowClient, tripId: Uuid): Promise<DriverTrip> {
  if (!uuidSchema.safeParse(tripId).success) {
    throw invalid('departDriverTrip', 'tripId must be a uuid');
  }

  const payload = await run(client.rpc('depart_driver_trip', { p_trip_id: tripId }));
  assertEnvelopeHasTrip(payload, 'departDriverTrip');
  return readBack(client, tripId, 'departDriverTrip');
}

/* -------------------------------------------------------------------------- */
/* return_driver_trip                                                         */
/* -------------------------------------------------------------------------- */

export interface ReturnDriverTripInput {
  /** What is physically coming back. Empty is legal — a driver may sell everything. */
  items: readonly DriverTripManifestItem[];
}

/**
 * Record the physical return. Only the trip's own driver.
 *
 * @throws {BakeflowApiError} `insufficient_role` when the caller is not this trip's
 *   driver; `invalid_transition` when the trip is not `in_transit`; `invalid_request` for a
 *   malformed item or no default warehouse to return into.
 */
export async function returnDriverTrip(
  client: BakeflowClient,
  tripId: Uuid,
  input: ReturnDriverTripInput,
): Promise<DriverTrip> {
  if (!uuidSchema.safeParse(tripId).success) {
    throw invalid('returnDriverTrip', 'tripId must be a uuid');
  }

  const payload = await run(
    client.rpc('return_driver_trip', {
      p_trip_id: tripId,
      p_items: input.items.map(parseManifestItem),
    }),
  );

  assertEnvelopeHasTrip(payload, 'returnDriverTrip');
  return readBack(client, tripId, 'returnDriverTrip');
}

/* -------------------------------------------------------------------------- */
/* reconcile_driver_trip                                                      */
/* -------------------------------------------------------------------------- */

export interface ReconcileDriverTripInput {
  /** What the driver actually returned, as an exact decimal string. `expected_cash` is
   *  computed server-side from the trip's own payments — never sent from here. */
  physicalCash: string;
  /** Required whenever the resulting variance is nonzero
   *  (`driver_trips_variance_needs_note`); omit only when you expect an exact match. */
  varianceNote?: string;
}

/**
 * Reconcile a returned trip's cash. Management only (owner/admin/branch_manager/
 * supervisor) — never the driver.
 *
 * @throws {BakeflowApiError} `insufficient_role` when the caller is not authorized;
 *   `invalid_transition` when the trip is not `returning`; `variance_note_required` when
 *   the resulting variance is nonzero and no note was given; `invalid_request` for a
 *   negative `physicalCash`.
 */
export async function reconcileDriverTrip(
  client: BakeflowClient,
  tripId: Uuid,
  input: ReconcileDriverTripInput,
): Promise<DriverTrip> {
  if (!uuidSchema.safeParse(tripId).success) {
    throw invalid('reconcileDriverTrip', 'tripId must be a uuid');
  }
  const parsedCash = nonNegativeMoneySchema.safeParse(input.physicalCash);
  if (!parsedCash.success) {
    throw invalid('reconcileDriverTrip', 'physicalCash must be an exact decimal string >= 0');
  }

  const payload = await run(
    client.rpc('reconcile_driver_trip', {
      p_trip_id: tripId,
      p_physical_cash: parsedCash.data,
      p_variance_note: blankToNull(input.varianceNote),
    }),
  );

  assertEnvelopeHasTrip(payload, 'reconcileDriverTrip');
  return readBack(client, tripId, 'reconcileDriverTrip');
}

/* -------------------------------------------------------------------------- */
/* complete_driver_trip                                                       */
/* -------------------------------------------------------------------------- */

export interface CompleteDriverTripInput {
  /** The branch till session this trip's reconciled cash settles into. Must already be
   *  open at the trip's own branch — the RPC checks both. */
  settlementCashSessionId: Uuid;
}

/**
 * Close a reconciled trip out, recording which till session absorbs its cash (AD-018).
 * Management only.
 *
 * @throws {BakeflowApiError} `insufficient_role` when the caller is not authorized;
 *   `invalid_transition` when the trip is not `reconciled`, or the named session is not
 *   open; `invalid_request` when the session belongs to a different branch.
 */
export async function completeDriverTrip(
  client: BakeflowClient,
  tripId: Uuid,
  input: CompleteDriverTripInput,
): Promise<DriverTrip> {
  if (!uuidSchema.safeParse(tripId).success) {
    throw invalid('completeDriverTrip', 'tripId must be a uuid');
  }
  if (!uuidSchema.safeParse(input.settlementCashSessionId).success) {
    throw invalid('completeDriverTrip', 'settlementCashSessionId must be a uuid');
  }

  const payload = await run(
    client.rpc('complete_driver_trip', {
      p_trip_id: tripId,
      p_settlement_cash_session_id: input.settlementCashSessionId,
    }),
  );

  assertEnvelopeHasTrip(payload, 'completeDriverTrip');
  return readBack(client, tripId, 'completeDriverTrip');
}

/* -------------------------------------------------------------------------- */
/* record_payment — trip-scoped call only                                     */
/* -------------------------------------------------------------------------- */

export interface RecordDriverTripPaymentInput {
  ticketId: Uuid;
  /** Exact decimal string, never a JS `number`. Must be `> 0`. */
  amount: string;
  method: DriverTripPaymentMethod;
  reference?: string;
}

/** What this wrapper returns. Deliberately not a full `Payment` read model — none exists
 *  in this package yet, and inventing one here would be scope this domain does not need.
 *  `amount` is echoed back as the exact string this function validated on the way in, not
 *  parsed out of the RPC's `to_jsonb` envelope — see the module header on precision. */
export interface RecordDriverTripPaymentResult {
  paymentId: Uuid;
  amount: string;
  method: DriverTripPaymentMethod;
}

/**
 * Record a payment collected on the road, scoped to this trip's own cash custody rather
 * than any branch till session (AD-018) — this is what makes "Record Payment" in the
 * driver's simplified flow require no open till session to exist.
 *
 * Requires the ticket to already carry this `driver_trip_id`
 * (`guard_ticket_driver_trip_assignment()`, set at ticket creation) and the trip to be
 * `in_transit`. Callable by the trip's own driver or a manager.
 *
 * @throws {BakeflowApiError} `insufficient_role` when the caller is neither this trip's
 *   driver nor a manager; `invalid_transition` when the trip is not `in_transit`, or the
 *   ticket does not belong to it; `invalid_request` when the payment would exceed the
 *   ticket's outstanding balance (`guard_payment_relationships()`) or `amount` is not `> 0`.
 */
export async function recordDriverTripPayment(
  client: BakeflowClient,
  tripId: Uuid,
  input: RecordDriverTripPaymentInput,
): Promise<RecordDriverTripPaymentResult> {
  if (!uuidSchema.safeParse(tripId).success) {
    throw invalid('recordDriverTripPayment', 'tripId must be a uuid');
  }
  if (!uuidSchema.safeParse(input.ticketId).success) {
    throw invalid('recordDriverTripPayment', 'ticketId must be a uuid');
  }
  const parsedAmount = nonNegativeMoneySchema.safeParse(input.amount);
  if (!parsedAmount.success || isZeroAmount(parsedAmount.data)) {
    throw invalid('recordDriverTripPayment', 'amount must be an exact decimal string > 0');
  }

  const payload = await run(
    client.rpc('record_payment', {
      p_order_id: input.ticketId,
      p_amount: parsedAmount.data,
      p_method: input.method,
      p_reference: blankToNull(input.reference),
      p_cash_session_id: null,
      p_driver_trip_id: tripId,
    }),
  );

  if (typeof payload !== 'object' || payload === null) {
    throw new BakeflowApiError({
      code: 'response_shape_invalid',
      message: `recordDriverTripPayment: expected a jsonb envelope, received ${typeof payload}`,
    });
  }
  const envelope = payload as { payment?: { id?: unknown } };
  if (typeof envelope.payment !== 'object' || envelope.payment === null) {
    throw new BakeflowApiError({
      code: 'response_shape_invalid',
      message: 'recordDriverTripPayment: the envelope carried no payment',
    });
  }
  const paymentId = envelope.payment.id;
  if (typeof paymentId !== 'string' || !uuidSchema.safeParse(paymentId).success) {
    throw new BakeflowApiError({
      code: 'response_shape_invalid',
      message: 'recordDriverTripPayment: the envelope carried no valid payment id',
    });
  }

  return { paymentId, amount: parsedAmount.data, method: input.method };
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

function parseManifestItem(item: DriverTripManifestItem): {
  item_type: 'ingredient' | 'product';
  item_id: Uuid;
  quantity: Quantity;
} {
  if (!uuidSchema.safeParse(item.itemId).success) {
    throw invalid('driverTripManifest', `itemId must be a uuid, received "${item.itemId}"`);
  }
  const parsedQuantity = positiveQuantitySchema.safeParse(item.quantity);
  if (!parsedQuantity.success) {
    throw invalid(
      'driverTripManifest',
      `quantity for item ${item.itemId} must be an exact decimal string > 0`,
    );
  }
  return { item_type: item.itemType, item_id: item.itemId, quantity: parsedQuantity.data };
}

function isZeroAmount(value: string): boolean {
  return /^-?0+(\.0+)?$/.test(value);
}

/** Confirm the envelope carries a `trip` object before treating the mutation as applied.
 *  Does not parse it — see the module header on why every mutation re-reads instead. */
function assertEnvelopeHasTrip(payload: unknown, context: string): void {
  if (typeof payload !== 'object' || payload === null) {
    throw new BakeflowApiError({
      code: 'response_shape_invalid',
      message: `${context}: expected a jsonb envelope, received ${typeof payload}`,
    });
  }
  const envelope = payload as { trip?: unknown };
  if (typeof envelope.trip !== 'object' || envelope.trip === null) {
    throw new BakeflowApiError({
      code: 'response_shape_invalid',
      message: `${context}: the envelope carried no trip`,
    });
  }
}

/** `start_driver_trip` is the one call where the id does not already exist client-side —
 *  every other mutation is given `tripId` by its caller. Pulled from the envelope only for
 *  identity (which row to re-read), never for its field values. */
function extractTripId(payload: unknown, context: string): Uuid {
  assertEnvelopeHasTrip(payload, context);
  const id = (payload as { trip: { id?: unknown } }).trip.id;
  if (typeof id !== 'string' || !uuidSchema.safeParse(id).success) {
    throw new BakeflowApiError({
      code: 'response_shape_invalid',
      message: `${context}: the envelope's trip carried no valid id`,
    });
  }
  return id;
}

async function readBack(client: BakeflowClient, tripId: Uuid, context: string): Promise<DriverTrip> {
  const row = await getDriverTripById(client, tripId);
  if (row === null) {
    throw new BakeflowApiError({
      code: 'unexpected_error',
      message:
        `${context}: the change was applied but the row could not be read back; the RPC ` +
        'and driver_trips_select disagree for this caller',
    });
  }
  return row;
}

function blankToNull(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function invalid(context: string, message: string): BakeflowApiError {
  return new BakeflowApiError({ code: 'invalid_request', message: `${context}: ${message}` });
}

/** Local copy of the query runner, matching every other mutations module in this package. */
async function run(query: PromiseLike<{ data: unknown; error?: unknown }>): Promise<unknown> {
  let result: { data: unknown; error?: unknown };
  try {
    result = await query;
  } catch (thrown) {
    throw normalizeThrown(thrown);
  }
  if (result.error !== null && result.error !== undefined) {
    throw normalizePostgrestError(result.error as Parameters<typeof normalizePostgrestError>[0]);
  }
  return result.data;
}
