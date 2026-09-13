import {
  Avatar,
  Badge,
  Button,
  Chips,
  EmptyState,
  GroupLabel,
  IconTile,
  List,
  ListRow,
  ScreenScroll,
  Skeleton,
  Text,
} from '@bakeflow/ui';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { ErrorState, NoOrganizationState } from '../../components/ScreenState';
import { useBranchOptions } from '../../features/branch/hooks/useBranchOptions';
import { DELIVERY_META, deliveryWhen } from '../../features/delivery/deliveryDisplay';
import { useDeliveryBoard } from '../../features/delivery/hooks/useDeliveryBoard';

/** Unassigned stops beyond this fold sit behind "Show all" so Drivers stays in reach. */
const UNASSIGNED_SHOWN = 6;

function Stat({ value, label, tone }: { value: number; label: string; tone: string }): React.JSX.Element {
  return (
    <View className="min-w-0 flex-1 rounded-md bg-white px-3.5 py-3 shadow-e2" accessible accessibilityLabel={`${value} ${label}`}>
      <Text tabular className={`text-title-2 font-bold ${tone}`}>{String(value)}</Text>
      <Text variant="caption" numberOfLines={1}>{label}</Text>
    </View>
  );
}

/**
 * Delivery — the prototype's `delivery-monitor`: who is out, what still needs a driver, and
 * which stops went wrong.
 *
 * Every transition is `transition_delivery()` on the detail screen; this board only reads.
 * `failed` counts as open and as a problem — it is not an end state until the goods are
 * returned.
 *
 * PORT-NOTE: the prototype lists drivers only. Unassigned deliveries have no driver to sit
 * under, so they get their own section at the top — they are the ones a dispatcher acts on
 * first. Stop areas ("Ikeja") are not a column; the address line is shown instead.
 */
export default function DeliveryBoardScreen(): React.JSX.Element {
  const router = useRouter();
  const branches = useBranchOptions();
  const [branchIndex, setBranchIndex] = useState(0);
  const branch = branches.options[branchIndex] ?? branches.options[0] ?? null;
  const board = useDeliveryBoard({ branchId: branch?.branchId });
  const [showAllUnassigned, setShowAllUnassigned] = useState(false);

  if (board.tenantId === null) {
    return <NoOrganizationState onChoose={() => router.push('/select-organization')} />;
  }

  const onRoad = board.rows.filter((r) => r.delivery.status === 'in_transit').length;
  const problems = board.rows.filter((r) => r.delivery.status === 'failed').length;

  return (
    <ScreenScroll
      title="Delivery"
      sub={
        board.isLoading
          ? branch?.label
          : `${board.todayCount} stop${board.todayCount === 1 ? '' : 's'} today · ${board.rows.filter((r) => r.delivery.status !== 'delivered' && r.delivery.status !== 'returned').length} open`
      }
      onBack={router.canGoBack() ? () => router.back() : undefined}
      refreshing={board.isRefetching}
      onRefresh={board.refetch}
    >
      {branches.options.length > 1 && (
        <Chips
          className="mt-2"
          accessibilityLabel="Branch"
          options={branches.options.map((b, i) => ({ key: String(i), label: b.label }))}
          value={String(branchIndex)}
          onChange={(k) => setBranchIndex(Number(k))}
        />
      )}

      {board.isLoading || branches.isLoading ? (
        <View className="mt-5 gap-3">
          <Skeleton variant="row" className="h-[72px]" />
          <Skeleton variant="row" />
          <Skeleton variant="row" />
        </View>
      ) : board.isError ? (
        <View className="mt-5">
          <ErrorState error={board.error ?? new Error('Could not load deliveries.')} onRetry={board.refetch} />
        </View>
      ) : (
        <>
          <View className="mt-4 flex-row gap-2.5">
            <Stat value={board.unassigned.length} label="Need a driver" tone="text-warning-ink" />
            <Stat value={onRoad} label="On the road" tone="text-apricot-deep" />
            <Stat value={problems} label="Problems" tone={problems > 0 ? 'text-error-ink' : 'text-cocoa'} />
          </View>

          {board.unassigned.length > 0 && (
            <>
              <GroupLabel>Needs a driver</GroupLabel>
              <List>
                {(showAllUnassigned ? board.unassigned : board.unassigned.slice(0, UNASSIGNED_SHOWN)).map((r) => (
                  <ListRow
                    key={r.delivery.id}
                    leading={<IconTile icon="clock" tone="warn" size="sm" />}
                    title={r.delivery.address_line}
                    sub={[r.ticket?.ticket_number, r.customerName, deliveryWhen(r.delivery.scheduled_at)].filter(Boolean).join(' · ')}
                    onPress={() => router.push(`/delivery/${r.delivery.id}`)}
                  />
                ))}
              </List>
              {board.unassigned.length > UNASSIGNED_SHOWN && (
                <Button
                  className="mt-3"
                  label={showAllUnassigned ? 'Show fewer' : `Show all ${board.unassigned.length}`}
                  tone="secondary"
                  onPress={() => setShowAllUnassigned((v) => !v)}
                  block
                />
              )}
            </>
          )}

          <GroupLabel>Drivers</GroupLabel>
          {board.byDriver.length === 0 ? (
            <EmptyState
              icon="truck"
              title="No drivers yet"
              text="People with the driver role appear here with their stops for the day."
            />
          ) : (
            <List>
              {board.byDriver.map((d) => (
                <ListRow
                  key={d.driverId}
                  leading={<Avatar name={d.name} />}
                  title={d.name}
                  sub={`${d.rows.length} stop${d.rows.length === 1 ? '' : 's'}${d.problems > 0 ? ` · ${d.problems} problem${d.problems === 1 ? '' : 's'}` : ''}`}
                  trailing={d.active > 0 ? <Badge label={`${d.active} active`} tone="live" /> : undefined}
                  onPress={() => router.push(`/delivery/driver/${d.driverId}`)}
                />
              ))}
            </List>
          )}

          {board.rows.length === 0 && (
            <Text variant="meta" className="mt-4 text-center">
              No deliveries today. Orders with delivery fulfilment appear here.
            </Text>
          )}

          {problems > 0 && (
            <View className="mt-4 flex-row items-center gap-2 px-0.5">
              <Badge label={DELIVERY_META.failed.label} tone={DELIVERY_META.failed.tone} icon={DELIVERY_META.failed.icon} />
              <Text variant="caption" className="flex-1">A problem stays open until its goods are returned.</Text>
            </View>
          )}
        </>
      )}
    </ScreenScroll>
  );
}
