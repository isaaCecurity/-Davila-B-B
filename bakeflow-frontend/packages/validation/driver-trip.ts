/**
 * Zod schema for the driver trip read model — ADR-001, Phases 2-3 live 2026-08-24.
 *
 * Same provenance discipline as `@bakeflow/types` `driver-trip.ts`: every constraint below
 * was read from the migrations applied this same pass and cross-checked against
 * `docs/STATE-MACHINES.md` §6.
 *
 * ### Refinements mirror live CHECK constraints
 *
 * ```
 * driver_trips_reconciled_needs_cash   CHECK (status NOT IN ('reconciled','completed')
 *                                              OR (expected_cash IS NOT NULL
 *                                                  AND physical_cash IS NOT NULL
 *                                                  AND reconciled_by IS NOT NULL
 *                                                  AND reconciled_at IS NOT NULL))
 * driver_trips_variance_needs_note     CHECK (cash_variance IS NULL OR cash_variance = 0
 *                                              OR btrim(cash_variance_note) <> '')
 * driver_trips_loading_verified_pair   CHECK ((loading_verified_by IS NULL)
 *                                              = (loading_verified_at IS NULL))
 * ```
 *
 * Looser than the database everywhere else, on the same established principle as
 * `deliverySchema`: a reader stricter than the writer rejects rows the writer legitimately
 * stored, and one bad row would fail an entire list rather than just that row.
 */

import { DRIVER_TRIP_STATUSES, isZeroDecimalString } from '@bakeflow/types';
import { z } from 'zod';

import { signedMoneySchema, timestamptzSchema, uuidSchema } from './decimal';

/** `driver_trips`. Cash columns use `signedMoneySchema` throughout rather than mixing
 *  signed/non-negative per column: `expected_cash`/`physical_cash` never are negative in
 *  practice (both CHECK `>= 0` when set), but reading them with the same schema as
 *  `cash_variance` costs nothing and avoids three near-identical schemas for one table. */
export const driverTripSchema = z
  .object({
    id: uuidSchema,
    tenant_id: uuidSchema,
    branch_id: uuidSchema,
    driver_id: uuidSchema,
    warehouse_id: uuidSchema,
    status: z.enum(DRIVER_TRIP_STATUSES),
    loading_verified_by: uuidSchema.nullable(),
    loading_verified_at: timestamptzSchema.nullable(),
    departed_at: timestamptzSchema.nullable(),
    returned_at: timestamptzSchema.nullable(),
    expected_cash: signedMoneySchema.nullable(),
    physical_cash: signedMoneySchema.nullable(),
    cash_variance: signedMoneySchema.nullable(),
    cash_variance_note: z.string().nullable(),
    settlement_cash_session_id: uuidSchema.nullable(),
    reconciled_by: uuidSchema.nullable(),
    reconciled_at: timestamptzSchema.nullable(),
    reconciliation_note: z.string().nullable(),
    created_at: timestamptzSchema,
    updated_at: timestamptzSchema,
    revision: z.number().int().positive(),
  })
  .refine(
    (row) =>
      (row.status !== 'reconciled' && row.status !== 'completed') ||
      (row.expected_cash !== null &&
        row.physical_cash !== null &&
        row.reconciled_by !== null &&
        row.reconciled_at !== null),
    {
      error:
        'a reconciled or completed trip must carry expected_cash, physical_cash, ' +
        'reconciled_by and reconciled_at (driver_trips_reconciled_needs_cash); a row ' +
        'violating this cannot exist in the database, so the payload is not what it claims',
      path: ['expected_cash'],
    },
  )
  .refine(
    (row) =>
      row.cash_variance === null ||
      isZeroDecimalString(row.cash_variance) ||
      (row.cash_variance_note ?? '').trim().length > 0,
    {
      error:
        'a nonzero cash_variance must carry a cash_variance_note ' +
        '(driver_trips_variance_needs_note); a row violating this cannot exist in the ' +
        'database, so the payload is not what it claims',
      path: ['cash_variance_note'],
    },
  )
  .refine(
    (row) => (row.loading_verified_by === null) === (row.loading_verified_at === null),
    {
      error:
        'loading_verified_by and loading_verified_at must be both null or both set ' +
        '(driver_trips_loading_verified_pair); a row violating this cannot exist in the ' +
        'database, so the payload is not what it claims',
      path: ['loading_verified_by'],
    },
  );
