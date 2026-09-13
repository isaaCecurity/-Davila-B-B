/**
 * The four states every data screen has to render, in one place.
 *
 * Presentation comes from `@bakeflow/ui`; what lives here is the *wording*, and for two of
 * these that is a correctness matter rather than a styling one:
 *
 * - An empty catalog and a denied catalog look identical over the wire. RLS filters rather
 *   than raising, so a user whose membership was revoked receives `[]`, exactly like a
 *   bakery that has not added products yet. Rendering both as "No products yet" tells the
 *   revoked user their data was deleted. `NoOrganizationState` exists to keep those apart.
 * - An error must always offer a retry. These are mobile users on intermittent data; a
 *   dead end with no button is a reinstall.
 */

import { Button, Text } from '@bakeflow/ui';
import { ActivityIndicator, View } from 'react-native';

/** Cocoa — ActivityIndicator takes a colour prop, not a class. */
const SPINNER = '#2A211C';

export function LoadingState({ label = 'Loading…' }: { label?: string }): React.JSX.Element {
  return (
    <View className="flex-1 items-center justify-center gap-3 p-gutter">
      <ActivityIndicator size="large" color={SPINNER} />
      <Text variant="meta">{label}</Text>
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
    <View className="flex-1 items-center justify-center gap-2 p-gutter">
      <Text variant="subtitle">{title}</Text>
      {detail !== undefined && (
        <Text variant="meta" className="text-center">
          {detail}
        </Text>
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
    <View className="flex-1 items-center justify-center gap-4 p-gutter">
      <Text variant="subtitle">Something went wrong</Text>
      <Text variant="meta" className="text-center">
        {error.message}
      </Text>
      <Button label="Try again" onPress={onRetry} />
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
    <View className="flex-1 items-center justify-center gap-4 p-gutter">
      <Text variant="subtitle">No bakery selected</Text>
      <Text variant="meta" className="text-center">
        Choose a bakery to see its catalog.
      </Text>
      <Button label="Choose a bakery" onPress={onChoose} />
    </View>
  );
}
