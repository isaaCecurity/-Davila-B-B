/**
 * An invite link opened before signing in (docs/FRONTEND-STRUCTURE.md §3, `auth` store).
 *
 * Holds the raw token in memory only, for exactly as long as it takes to sign in. It is a
 * bearer secret — possession of it joins the organization — so it is never written to storage:
 * a cold start simply asks for the link again.
 */

import { create } from 'zustand';

interface PendingInviteState {
  token: string | null;
  hold: (token: string) => void;
  clear: () => void;
}

export const usePendingInviteStore = create<PendingInviteState>((set) => ({
  token: null,
  hold: (token) => set({ token }),
  clear: () => set({ token: null }),
}));
