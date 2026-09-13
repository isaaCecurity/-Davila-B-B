import { Button, EmptyState, ScreenScroll } from '@bakeflow/ui';
import { useRouter } from 'expo-router';

/**
 * A production batch deep link.
 *
 * Production batches are out of MVP scope (AD-022): client grants on `production_batches` are
 * revoked, so a batch cannot be read here. Old links land on an explanation and a way to the
 * production queue instead of an access error. The batch screen and its actions are kept in
 * git history for v2, as AD-022 intends.
 */
export default function ProductionBatchRoute(): React.JSX.Element {
  const router = useRouter();
  return (
    <ScreenScroll title="Production batch" onBack={() => (router.canGoBack() ? router.back() : router.replace('/production'))}>
      <EmptyState
        icon="flame"
        title="Batches are not tracked in this version"
        text="Production is followed order by order. Open the production queue to see what to make."
        action={<Button label="Open production" onPress={() => router.replace('/production')} />}
      />
    </ScreenScroll>
  );
}
