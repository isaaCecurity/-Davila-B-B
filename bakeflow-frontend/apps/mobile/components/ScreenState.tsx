/**
 * The four states every data screen has to render, in one place.
 *
 * Not a design system — P8.1 is deliberately small. This exists because loading, empty,
 * error-with-retry and "no organization" were about to be written three times each, and
 * the *wording* of two of them is a correctness matter rather than a styling one:
 *
 * - An empty catalog and a denied catalog look identical over the wire. RLS filters rather
 *   than raising, so a user whose membership was revoked receives `[]`, exactly like a
 *   bakery that has not added products yet. Rendering both as "No products yet" tells the
 *   revoked user their data was deleted. `NoOrganizationState` exists to keep those apart.
 * - An error must always offer a retry. These are mobile users on intermittent data; a
 *   dead end with no button is a reinstall.
 */

import { ActivityIndicator, Pressable, Text, View } from 'react-native';

export function LoadingState({ label = 'Loading…' }: { label?: string }): React.JSX.Element {
  return (
    <View className="flex-1 items-center justify-center gap-3 p-6">
      <ActivityIndicator size="large" />
      <Text className="text-base text-neutral-500">{label}</Text>
    </View>
  );
}

export function EmptyState({
  title,
  detail,
}: {
  title: string;
  detail?: string;
}): React.JSX.Element {
  return (
    <View className="flex-1 items-center justify-center gap-2 p-6">
      <Text className="text-lg font-semibold text-neutral-800">{title}</Text>
      {detail !== undefined && (
        <Text className="text-center text-base text-neutral-500">{detail}</Text>
      )}
    </View>
  );
}

/**
 * An error, with the message and a retry.
 *
 * The raw message is shown rather than a generic apology. `packages/api` normalises errors
 * into `BakeflowApiError` with actionable text ("you are offline", "this record was
 * changed by someone else"), and replacing that with "Something went wrong" would discard
 * the one thing that tells the user whether to retry, reconnect, or call their manager.
 */
export function ErrorState({
  error,
  onRetry,
}: {
  error: Error;
  onRetry: () => void;
}): React.JSX.Element {
  return (
    <View className="flex-1 items-center justify-center gap-4 p-6">
      <Text className="text-lg font-semibold text-neutral-800">Something went wrong</Text>
      <Text className="text-center text-base text-neutral-500">{error.message}</Text>
      <Pressable
        accessibilityRole="button"
        onPress={onRetry}
        className="rounded-lg bg-neutral-900 px-5 py-3 active:opacity-80"
      >
        <Text className="text-base font-medium text-white">Try again</Text>
      </Pressable>
    </View>
  );
}

/**
 * Shown when the tenant claim is null.
 *
 * A distinct state, never "empty". A null claim means every policy in the database denies,
 * so *all* organization-scoped screens are empty at once — which is a session problem, not
 * a data problem, and the user's only useful action is to pick an organization again.
 */
export function NoOrganizationState({
  onChoose,
}: {
  onChoose: () => void;
}): React.JSX.Element {
  return (
    <View className="flex-1 items-center justify-center gap-4 p-6">
      <Text className="text-lg font-semibold text-neutral-800">No bakery selected</Text>
      <Text className="text-center text-base text-neutral-500">
        Choose a bakery to see its catalog.
      </Text>
      <Pressable
        accessibilityRole="button"
        onPress={onChoose}
        className="rounded-lg bg-neutral-900 px-5 py-3 active:opacity-80"
      >
        <Text className="text-base font-medium text-white">Choose a bakery</Text>
      </Pressable>
    </View>
  );
}
