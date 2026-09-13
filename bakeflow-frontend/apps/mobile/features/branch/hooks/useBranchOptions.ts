import { getSupabaseClient } from '@bakeflow/auth';
import { useWarehouses } from '@bakeflow/hooks';
import type { Warehouse } from '@bakeflow/types';
import { useMemo } from 'react';

import { useSessionStore } from '../../../stores/session';

export interface BranchOption {
  branchId: string;
  /** The branch's first stockroom name — branches have no read endpoint of their own yet. */
  label: string;
}

/**
 * The branches the caller can see, derived from their warehouses.
 *
 * There is no branches read in `@bakeflow/api`, and `warehouses` is branch-scoped by RLS, so
 * one entry per distinct `branch_id` is exactly "the branches this user can reach". Extracted
 * from the identical logic the Reports and Finance screens each carried.
 */
export function useBranchOptions(): { options: BranchOption[]; isLoading: boolean } {
  const tenantId = useSessionStore((s) => s.activeTenantId);
  const warehouses = useWarehouses(getSupabaseClient(), tenantId);

  const options = useMemo(() => {
    const seen = new Set<string>();
    return (warehouses.data ?? []).filter((w: Warehouse) => {
      if (seen.has(w.branch_id)) return false;
      seen.add(w.branch_id);
      return true;
    }).map((w) => ({ branchId: w.branch_id, label: w.name }));
  }, [warehouses.data]);

  return { options, isLoading: warehouses.isLoading };
}
