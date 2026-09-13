import { rolesFromSession } from '@bakeflow/auth';
import { useMemo } from 'react';

import { personaFor, type Persona } from '../../../navigation/tabs';
import { useSessionStore } from '../../../stores/session';

/**
 * The prototype persona for the signed-in user in the active organization.
 *
 * Read from the token's `roles` claim, so it is available synchronously with the session
 * and changes exactly when the token does — including after switching organization.
 * Advisory only; see navigation/tabs.ts.
 */
export function useActivePersona(): Persona {
  const session = useSessionStore((s) => s.session);
  return useMemo(() => personaFor(rolesFromSession(session)), [session]);
}
