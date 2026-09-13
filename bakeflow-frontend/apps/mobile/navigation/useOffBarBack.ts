import { useRouter } from 'expo-router';

import { useActivePersona } from '../features/auth/hooks/useActivePersona';
import { PERSONA_TABS, type TabRoute } from './tabs';

/**
 * A back action for a tab screen reached from somewhere other than the tab bar.
 *
 * The prototype gives a tab screen a back arrow exactly when the current role's bar does not
 * contain it (`back: !ROLE_TABS[role].includes(tab)`) — an owner opening Production from More
 * needs a way back; a baker on their own Production tab does not. Returns `undefined` when the
 * tab is on this persona's bar.
 */
export function useOffBarBack(tab: TabRoute): (() => void) | undefined {
  const router = useRouter();
  const persona = useActivePersona();
  if (PERSONA_TABS[persona].includes(tab)) return undefined;
  return () => (router.canGoBack() ? router.back() : router.replace('/more'));
}
