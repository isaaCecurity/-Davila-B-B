import type { ProductionBatchStatus } from '@bakeflow/types';
import { Text, View } from 'react-native';

/**
 * The status of a production batch, as a badge.
 *
 * Shared by the list and the detail screen so one status can never be styled two ways.
 *
 * ## Why `failed` is not styled as an error
 *
 * A failed batch is a **recorded business outcome**, not an application fault: the dough
 * did not rise, the oven went out. `fail_production_batch()` still writes the consumption
 * movements, because the flour was really used — `STATE-MACHINES.md` §2 records that a
 * failed batch consuming nothing is a data error. So it is marked as distinct and serious
 * (amber, with the reason shown beside it on the detail screen) rather than as red alarm,
 * which is reserved for states the user should act on rather than accept.
 */
const STYLES: Record<ProductionBatchStatus, { label: string; background: string; text: string }> =
  {
    scheduled: { label: 'Scheduled', background: 'bg-neutral-100', text: 'text-neutral-700' },
    in_progress: { label: 'In progress', background: 'bg-blue-100', text: 'text-blue-800' },
    completed: { label: 'Completed', background: 'bg-green-100', text: 'text-green-800' },
    failed: { label: 'Failed', background: 'bg-amber-100', text: 'text-amber-800' },
    cancelled: { label: 'Cancelled', background: 'bg-neutral-100', text: 'text-neutral-500' },
  };

export function BatchStatusBadge({
  status,
}: {
  status: ProductionBatchStatus;
}): React.JSX.Element {
  const style = STYLES[status];
  return (
    <View className={`rounded-full px-3 py-1 ${style.background}`}>
      <Text className={`text-xs font-semibold uppercase ${style.text}`}>{style.label}</Text>
    </View>
  );
}
