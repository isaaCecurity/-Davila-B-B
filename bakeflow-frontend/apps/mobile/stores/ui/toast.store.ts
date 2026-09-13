/**
 * Toast queue — global UI state (docs/FRONTEND-STRUCTURE.md §3, `ui` store).
 *
 * Presentation lives in `@bakeflow/ui` `Toast`; this owns ordering, timing and dismissal.
 * Timers are held outside React so a toast raised from a mutation's `onSuccess` still
 * dismisses on schedule even if the screen that raised it has unmounted.
 */

import { duration, type ToastData } from '@bakeflow/ui';
import { create } from 'zustand';

/** The prototype stacks a few at once; older ones are dropped rather than queued forever. */
const MAX_VISIBLE = 3;

interface ToastState {
  toasts: ToastData[];
  show: (toast: Omit<ToastData, 'id'>, visibleMs?: number) => string;
  dismiss: (id: string) => void;
}

const timers = new Map<string, ReturnType<typeof setTimeout>>();
let seq = 0;

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],

  show: (toast, visibleMs = duration.toastVisible) => {
    seq += 1;
    const id = `t${seq}`;
    set((s) => ({ toasts: [{ ...toast, id }, ...s.toasts].slice(0, MAX_VISIBLE) }));
    timers.set(
      id,
      setTimeout(() => get().dismiss(id), visibleMs)
    );
    return id;
  },

  dismiss: (id) => {
    const timer = timers.get(id);
    if (timer !== undefined) clearTimeout(timer);
    timers.delete(id);
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
}));

/** Raise a toast from anywhere, including outside components. */
export function toast(t: Omit<ToastData, 'id'>): string {
  return useToastStore.getState().show(t);
}

/**
 * A reversible action's confirmation with a five-second Undo, as in the prototype.
 *
 * Only for mutations that genuinely have a reversal. Anything audit-logged or financially
 * final gets a confirmation sheet up front instead — an Undo that cannot actually undo is
 * worse than none.
 */
export function undoToast(t: { title: string; text?: string; onUndo: () => void }): string {
  const store = useToastStore.getState();
  let id = '';
  id = store.show(
    {
      title: t.title,
      text: t.text,
      tone: 'success',
      action: {
        label: 'Undo',
        onPress: () => {
          store.dismiss(id);
          t.onUndo();
        },
      },
    },
    duration.undoWindow
  );
  return id;
}
