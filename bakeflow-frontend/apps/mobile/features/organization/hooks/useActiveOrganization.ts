import { getSupabaseClient } from '@bakeflow/auth';
import { useMyOrganizations } from '@bakeflow/hooks';
import type { OrganizationMembership } from '@bakeflow/types';

import { useSessionStore } from '../../../stores/session';

/**
 * The organization the token says is active, resolved to its membership record.
 *
 * Keyed on `activeTenantId` from the token claim, never on the last tapped organization —
 * see stores/session.ts. `undefined` while loading or when no organization is active.
 */
export function useActiveOrganization(): OrganizationMembership | undefined {
  const userId = useSessionStore((s) => s.userId);
  const activeTenantId = useSessionStore((s) => s.activeTenantId);
  const { data } = useMyOrganizations(getSupabaseClient(), userId);
  return data?.find((org) => org.id === activeTenantId);
}
