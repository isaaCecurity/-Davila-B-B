import { Toast } from '@bakeflow/ui';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useToastStore } from '../stores/ui/toast.store';

/**
 * Renders the toast stack over every screen, below the status bar.
 *
 * `pointerEvents="box-none"` lets taps fall through the empty space around the toasts, so
 * the stack never blocks the screen beneath it.
 */
export function ToastHost(): React.JSX.Element {
  const toasts = useToastStore((s) => s.toasts);
  const insets = useSafeAreaInsets();

  return (
    <View
      pointerEvents="box-none"
      className="absolute left-0 right-0 top-0 z-50 gap-2 px-gutter"
      style={{ paddingTop: insets.top + 8 }}
    >
      {toasts.map((t) => (
        <Toast key={t.id} toast={t} />
      ))}
    </View>
  );
}
