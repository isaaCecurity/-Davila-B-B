/**
 * Delivery write path — P4.5. **Two operations, both `SECURITY DEFINER` RPCs.**
 *
 * ## Why nothing here is a table write
 *
 * `authenticated` holds `INSERT, SELECT` and **no UPDATE** on `deliveries` (grants read
 * live). GRANTs are checked before RLS, so a transition attempted through PostgREST fails
 * at the privilege layer for every role in every branch. Asserted behaviourally rather
 * than inferred from the grant, because the claim is load-bearing:
 *
 * ```
 * UPDATE deliveries SET status='in_transit'  ->  42501 permission denied for table deliveries
 * ```
 *
 * Routing through the functions is what lets the server own the parts a client must not be
 * trusted with: `dispatched_at` and `delivered_at` are stamped by the guard, the legal
 * transition graph is enforced in one place, and an `audit_log` row is written in the same
 * transaction.
 *
 * ## The contracts, read from the live function bodies
 *
 * ```
 * transition_delivery(p_delivery_id uuid, p_to_status text, p_proof_url text,
 *                     p_recipient_name text, p_reason text, p_driver_id uuid) RETURNS jsonb
 * update_delivery_details(p_delivery_id uuid, p_address_line text, p_contact_phone text,
 *                         p_scheduled_at timestamptz) RETURNS jsonb
 * ```
 *
 * ### The legal graph is the trigger's, not the documentation's
 *
 * `guard_delivery_transition()` fires `BEFORE UPDATE OF status` and is the authority:
 *
 * ```
 * pending    -> assigned
 * assigned   -> in_transit
 * in_transit -> delivered | failed | returned
 * failed     -> returned
 * delivered  -> (terminal)
 * returned   -> (terminal)
 * ```
 *
 * ### Preconditions the RPC checks before the trigger ever runs
 *
 * - **`assigned` requires a `p_driver_id` that actually holds the `driver` role in this
 *   tenant** — the function joins `user_roles` to `roles` and checks `r.key = 'driver'`.
 *   Passing any other profile is `insufficient_role`, not a silent no-op.
 * - **`in_transit` requires the parent ticket to be `ready`.** The function reads the
 *   ticket and refuses otherwise. A dispatch button that ignores ticket status will look
 *   broken to a user, so callers should surface the ticket state rather than retry.
 *
 * ### Authorization, from the guard
 *
 * Moving *into* `assigned` requires owner/admin/branch_manager. Every other hop requires
 * the **assigned driver** (`driver_id = auth.uid()`) **or** a manager. None of it is
 * re-checked here; this module reports what the database decided.
 *
 * ### `COALESCE` means these fields can be set but never cleared
 *
 * `driver_id`, `proof_url` and `recipient_name` are each written as `coalesce(p_x, x)`, so
 * passing `null` **keeps the existing value** rather than clearing it. There is no way
 * through this RPC to unassign a driver or withdraw proof, and that is the database's
 * shape, not an omission in this wrapper.
 *
 * `failure_reason` is the exception: it is written only when the target is `failed`, as
 * `btrim(coalesce(p_reason, ''))`. A missing reason therefore becomes the empty string and
 * trips `deliveries_failed_needs_reason` (`23514`) rather than being stored blank — so the
 * reason is required here, and fails fast with a field-specific message.
 *
 * ## Precision
 *
 * Both functions return `to_jsonb` of the row, which renders `numeric` unquoted and would
 * destroy its scale — the defect recorded in `@bakeflow/types` `scalars.ts` and TD-012.
 * **`deliveries` has no `NUMERIC` column at all**, so uniquely among the write paths that
 * envelope is precision-safe as it stands.
 *
 * Both operations still re-read the row through `getDeliveryById` rather than parsing the
 * envelope, for two reasons that are not about precision: the caller gets a row shaped by
 * exactly the same projection the board and detail screens cache, so a transitioned row
 * cannot differ structurally from a listed one; and a successful re-read proves the row is
 * still visible to this caller under `deliveries_select` after the change.
 *
 * ## A gap worth naming: `returned` moves no stock
 *
 * `STATE-MACHINES.md` §3 and this package's own earlier comments state that
 * `failed -> returned` and `in_transit -> returned` each write a return stock movement,
 * under universal rule 4. **The live database does not do this.** `transition_delivery`
 * writes no movement, and `deliveries` carries only two triggers — the transition guard and
 * `set_updated_at` — neither of which touches `stock_movements` (read live, not assumed).
 *
 * So goods on a returned delivery are not restored to inventory by any current mechanism.
 * That is a backend gap, recorded as **BLOCKER-016**; it is deliberately *not* patched here
 * by having the client append a movement, which would be the exact split transaction the
 * rule exists to prevent.
 */

import type { Delivery, DeliveryStatus, Uuid } from '@bakeflow/types';
import { uuidSchema } from '@bakeflow/validation';

import type { BakeflowClient } from '../client';
import { BakeflowApiError, normalizePostgrestError, normalizeThrown } from '../errors';
import { getDeliveryById } from '../queries/delivery';

/**
 * A requested transition, as a discriminated union.
 *
 * Modelled this way so the argument combinations the database rejects cannot be
 * constructed: `assigned` without a driver and `failed` without a reason are both
 * compile-time errors rather than round trips that come back `23514`.
 *
 * `pending` is absent because nothing transitions *into* it — it is the insert default.
 */
export type DeliveryTransition =
  | {
      to: 'assigned';
      /** Must hold the `driver` role in this tenant; the RPC verifies it. */
      driverId: Uuid;
    }
  | { to: 'in_transit' }
  | {
      /**
       * At least one of `proofUrl` / `recipientName` is required by
       * `deliveries_delivered_needs_proof`, a standing table CHECK. Which one is up to the
       * situation — a photo, or a name when a photo could not be taken.
       */
      to: 'delivered';
      proofUrl?: string | null;
      recipientName?: string | null;
    }
  | {
      to: 'failed';
      /** Required and non-blank — see the module header on `failure_reason`. */
      reason: string;
    }
  | { to: 'returned' };

/** The statuses `transition_delivery` will accept as a target. */
export const TRANSITIONABLE_DELIVERY_STATUSES = [
  'assigned',
  'in_transit',
  'delivered',
  'failed',
  'returned',
] as const satisfies readonly DeliveryStatus[];

/**
 * Move a delivery to its next status.
 *
 * @throws {BakeflowApiError} `invalid_transition` when the hop is illegal, the delivery is
 *   not visible in this tenant, or the parent ticket is not `ready`; `insufficient_role`
 *   when the caller is neither the assigned driver nor a manager, or when the nominated
 *   assignee is not a driver; `invalid_request` for a malformed argument.
 */
export async function transitionDelivery(
  client: BakeflowClient,
  deliveryId: Uuid,
  transition: DeliveryTransition,
): Promise<Delivery> {
  if (!uuidSchema.safeParse(deliveryId).success) {
    throw invalid('transitionDelivery', 'deliveryId must be a uuid');
  }

  // Validated locally only to fail fast with a field-specific message. The database
  // re-checks every one of these and it is the authority.
  let driverId: Uuid | null = null;
  let proofUrl: string | null = null;
  let recipientName: string | null = null;
  let reason: string | null = null;

  switch (transition.to) {
    case 'assigned': {
      if (!uuidSchema.safeParse(transition.driverId).success) {
        throw invalid('transitionDelivery', 'driverId must be a uuid');
      }
      driverId = transition.driverId;
      break;
    }
    case 'delivered': {
      proofUrl = blankToNull(transition.proofUrl);
      recipientName = blankToNull(transition.recipientName);
      if (proofUrl === null && recipientName === null) {
        throw invalid(
          'transitionDelivery',
          'marking a delivery delivered requires a proofUrl or a recipientName ' +
            '(deliveries_delivered_needs_proof)',
        );
      }
      break;
    }
    case 'failed': {
      reason = blankToNull(transition.reason);
      if (reason === null) {
        throw invalid(
          'transitionDelivery',
          'marking a delivery failed requires a non-blank reason ' +
            '(deliveries_failed_needs_reason)',
        );
      }
      break;
    }
    default:
      break;
  }

  // All six arguments are sent explicitly rather than relying on the function's defaults,
  // so this call cannot change meaning if a default is ever added or removed server-side.
  const payload = await run(
    client.rpc('transition_delivery', {
      p_delivery_id: deliveryId,
      p_to_status: transition.to,
      p_proof_url: proofUrl,
      p_recipient_name: recipientName,
      p_reason: reason,
      p_driver_id: driverId,
    }),
  );

  return readBack(client, payload, deliveryId, 'transitionDelivery');
}

/** Fields `update_delivery_details` can change. Each is optional; omitting one leaves it. */
export interface UpdateDeliveryDetailsInput {
  addressLine?: string;
  contactPhone?: string;
  /** ISO-8601. */
  scheduledAt?: string;
}

/**
 * Correct a delivery's address, contact number or scheduled time.
 *
 * Requires owner/admin/branch_manager/**cashier** — a wider set than any transition,
 * because fixing a mistyped address is a front-counter job rather than a dispatch decision.
 *
 * **Fields can be changed but not cleared.** Every column is written as `coalesce(p_x, x)`,
 * so omitting a field leaves it and there is no way to blank a phone number or unschedule a
 * delivery through this call.
 *
 * Note this does **not** rewrite history for a completed delivery: `address_line` is
 * duplicated onto the delivery precisely so a past drop records where it actually went, and
 * editing a delivered row would defeat that. The database does not prevent it, so the
 * restraint belongs at the call site.
 *
 * @throws {BakeflowApiError} `insufficient_role` when the caller's role is inadequate,
 *   `invalid_request` when the delivery is not visible in this tenant or no field was given.
 */
export async function updateDeliveryDetails(
  client: BakeflowClient,
  deliveryId: Uuid,
  input: UpdateDeliveryDetailsInput,
): Promise<Delivery> {
  if (!uuidSchema.safeParse(deliveryId).success) {
    throw invalid('updateDeliveryDetails', 'deliveryId must be a uuid');
  }

  const addressLine = blankToNull(input.addressLine);
  const contactPhone = blankToNull(input.contactPhone);
  const scheduledAt = blankToNull(input.scheduledAt);

  // Every argument null is a call that reads, locks and rewrites the row to its current
  // values — an audit-visible no-op. Refused here rather than sent.
  if (addressLine === null && contactPhone === null && scheduledAt === null) {
    throw invalid(
      'updateDeliveryDetails',
      'give at least one of addressLine, contactPhone or scheduledAt; a call with none ' +
        'would rewrite the row to its current values',
    );
  }
  if (scheduledAt !== null && Number.isNaN(new Date(scheduledAt).getTime())) {
    throw invalid('updateDeliveryDetails', 'scheduledAt must be an ISO-8601 timestamp');
  }

  const payload = await run(
    client.rpc('update_delivery_details', {
      p_delivery_id: deliveryId,
      p_address_line: addressLine,
      p_contact_phone: contactPhone,
      p_scheduled_at: scheduledAt,
    }),
  );

  return readBack(client, payload, deliveryId, 'updateDeliveryDetails');
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Confirm the envelope is the shape the function promises, then return the row as the read
 * path sees it. See the module header for why the envelope itself is not parsed.
 */
async function readBack(
  client: BakeflowClient,
  payload: unknown,
  deliveryId: Uuid,
  context: string,
): Promise<Delivery> {
  if (typeof payload !== 'object' || payload === null) {
    throw new BakeflowApiError({
      code: 'response_shape_invalid',
      message: `${context}: expected a jsonb envelope, received ${typeof payload}`,
    });
  }
  const envelope = payload as { delivery?: unknown };
  if (typeof envelope.delivery !== 'object' || envelope.delivery === null) {
    throw new BakeflowApiError({
      code: 'response_shape_invalid',
      message: `${context}: the envelope carried no delivery`,
    });
  }

  const row = await getDeliveryById(client, deliveryId);
  if (row === null) {
    throw new BakeflowApiError({
      code: 'unexpected_error',
      message:
        `${context}: the change was applied but the row could not be read back; the RPC ` +
        'and deliveries_select disagree for this caller',
    });
  }
  return row;
}

/** Treat whitespace-only input as absent, so a stray space cannot satisfy a CHECK the
 *  database evaluates with `btrim`. */
function blankToNull(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function invalid(context: string, message: string): BakeflowApiError {
  return new BakeflowApiError({ code: 'invalid_request', message: `${context}: ${message}` });
}

/** Local copy of the query runner, for the reason given in `mutations/inventory.ts`. */
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
