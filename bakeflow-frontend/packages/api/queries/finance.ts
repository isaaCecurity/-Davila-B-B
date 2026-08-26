import type { CashSession } from '@bakeflow/types';
import { cashSessionSchema } from '@bakeflow/validation';

import type { BakeflowClient } from '../client';
import {
  parseRows,
  projectionFor,
  run,
  withSoftDeleteFilter,
  type ReadEntity,
} from '../internal/read';

const TEXT_CAST_COLUMNS: ReadonlySet<string> = new Set([
  'opening_float',
  'expected_amount',
  'counted_amount',
  'variance_amount',
]);

const CASH_SESSIONS: ReadEntity<CashSession> = {
  table: 'cash_sessions',
  schema: cashSessionSchema,
  columns: projectionFor(cashSessionSchema, TEXT_CAST_COLUMNS),
  softDeleted: true,
};

export async function listCashSessions(
  client: BakeflowClient,
  branchId?: string,
): Promise<CashSession[]> {
  let query = withSoftDeleteFilter(
    client.from(CASH_SESSIONS.table).select(CASH_SESSIONS.columns),
    CASH_SESSIONS,
  );
  if (branchId !== undefined) query = query.eq('branch_id', branchId);

  const data = await run(query.order('opened_at', { ascending: false }));
  return parseRows(CASH_SESSIONS.schema, data, 'listCashSessions');
}