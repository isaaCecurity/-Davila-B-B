/**
 * The counter sale in progress (docs/FRONTEND-STRUCTURE.md §3, `ui` store) — the prototype's
 * `APP.sale`. Held in memory so a cashier can step away to another tab and come back to
 * "Continue sale · N items"; cleared when the sale is recorded or discarded. Not persisted: a
 * half-built basket should not survive an app restart.
 */

import { create } from 'zustand';

export interface SaleCustomer {
  id: string;
  name: string;
  phone: string | null;
}

interface CounterSaleState {
  /** variant id → whole-unit count. */
  counts: Record<string, number>;
  customer: SaleCustomer | null;
  add: (variantId: string) => void;
  removeOne: (variantId: string) => void;
  setCount: (variantId: string, count: number) => void;
  setCustomer: (customer: SaleCustomer | null) => void;
  reset: () => void;
}

export const useCounterSaleStore = create<CounterSaleState>((set) => ({
  counts: {},
  customer: null,
  add: (id) => set((s) => ({ counts: { ...s.counts, [id]: (s.counts[id] ?? 0) + 1 } })),
  removeOne: (id) =>
    set((s) => {
      const next = { ...s.counts };
      const n = (next[id] ?? 0) - 1;
      if (n <= 0) delete next[id];
      else next[id] = n;
      return { counts: next };
    }),
  setCount: (id, count) =>
    set((s) => {
      const next = { ...s.counts };
      if (count <= 0) delete next[id];
      else next[id] = Math.trunc(count);
      return { counts: next };
    }),
  setCustomer: (customer) => set({ customer }),
  reset: () => set({ counts: {}, customer: null }),
}));
