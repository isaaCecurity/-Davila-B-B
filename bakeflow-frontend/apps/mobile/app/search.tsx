import { getSupabaseClient } from '@bakeflow/auth';
import { useWorkspaceSearch } from '@bakeflow/hooks';
import { EmptyState, GroupLabel, IconTile, List, ListRow, ScreenScroll, SearchBar, Skeleton, Text } from '@bakeflow/ui';
import { formatNaira } from '@bakeflow/utils';
import { formatPhone, toE164Phone } from '@bakeflow/validation';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { ErrorState, NoOrganizationState } from '../components/ScreenState';
import { useActivePersona } from '../features/auth/hooks/useActivePersona';
import type { Persona } from '../navigation/tabs';
import { useSessionStore } from '../stores/session';

/** The prototype's 180ms settle before searching. */
const DEBOUNCE_MS = 180;

type Group = 'customers' | 'orders' | 'products';

/**
 * Which groups each persona searches — the prototype's `SEARCH_CATEGORIES.roles`, mapped onto what
 * exists. Cashier ("staff") and driver see only their own orders, as on their own lists.
 */
function groupsFor(persona: Persona): { groups: Group[]; ordersLabel: string; onlyMyOrders: boolean } {
  switch (persona) {
    case 'driver':
      return { groups: ['customers', 'orders'], ordersLabel: 'Tickets', onlyMyOrders: true };
    case 'cashier':
      return { groups: ['customers', 'orders', 'products'], ordersLabel: 'Orders', onlyMyOrders: true };
    case 'baker':
    case 'supervisor':
      return { groups: ['orders', 'products'], ordersLabel: 'Orders', onlyMyOrders: false };
    default:
      return { groups: ['customers', 'orders', 'products'], ordersLabel: 'Orders', onlyMyOrders: false };
  }
}

function phoneLine(phone: string | null): string | undefined {
  if (phone === null || phone === '') return undefined;
  const e164 = toE164Phone(phone);
  return e164 === null ? phone : formatPhone(e164);
}

/**
 * Search — the prototype's `search`: one box, results grouped by kind, up to six each, every row
 * opening its own screen.
 *
 * `search_workspace()` (P9.9 Q6) runs with the caller's own RLS, so a role only ever finds rows it
 * could open. Customers match by name or phone (0803… finds +234 803…), orders by number or customer
 * name, products by name, size or SKU; starts-with matches first.
 *
 * PORT-NOTE: the prototype's Deliveries and Production groups (drivers, bakers, supervisors) are
 * reached from their own screens; production in this version is the order queue (AD-022), so bakers
 * and supervisors search orders and products. A product row shows its lowest price instead of the
 * prototype's "N left" — stock is per stockroom and is on the product screen.
 */
export default function SearchScreen(): React.JSX.Element {
  const router = useRouter();
  const persona = useActivePersona();
  const tenantId = useSessionStore((s) => s.activeTenantId);
  const [query, setQuery] = useState('');
  const [settled, setSettled] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setSettled(query), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);

  const scope = groupsFor(persona);
  const search = useWorkspaceSearch(getSupabaseClient(), tenantId, settled, { onlyMyOrders: scope.onlyMyOrders });

  if (tenantId === null) {
    return <NoOrganizationState onChoose={() => router.push('/select-organization')} />;
  }

  const q = settled.trim();
  const active = q.length >= 2;
  const data = search.data;
  const shows = (g: Group): boolean => scope.groups.includes(g);
  const customers = data !== undefined && shows('customers') ? data.customers : [];
  const orders = data !== undefined && shows('orders') ? data.orders : [];
  const products = data !== undefined && shows('products') ? data.products : [];
  const count = customers.length + orders.length + products.length;
  const labels = scope.groups.map((g) => (g === 'orders' ? scope.ordersLabel.toLowerCase() : g));

  return (
    <ScreenScroll title="Search" onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))}>
      <View className="mt-2">
        <SearchBar value={query} onChangeText={setQuery} accessibilityLabel="Search" iconPosition="end" autoFocus />
      </View>

      {!active ? (
        <Text variant="meta" className="mt-4">Search {labels.join(', ')}.</Text>
      ) : search.isError ? (
        <View className="mt-4">
          <ErrorState error={search.error} onRetry={() => void search.refetch()} />
        </View>
      ) : data === undefined ? (
        <View className="mt-4 gap-2">
          <Skeleton variant="row" />
          <Skeleton variant="row" />
        </View>
      ) : count === 0 ? (
        <EmptyState icon="search" title="No matches" text="Try a different name, reference or phone number." />
      ) : (
        <>
          {customers.length > 0 && (
            <>
              <GroupLabel>Customers</GroupLabel>
              <List>
                {customers.map((c) => (
                  <ListRow
                    key={c.id}
                    leading={<IconTile icon="user" size="sm" />}
                    title={c.full_name}
                    sub={phoneLine(c.phone)}
                    onPress={() => router.push(`/customer/${c.id}`)}
                  />
                ))}
              </List>
            </>
          )}
          {orders.length > 0 && (
            <>
              <GroupLabel>{scope.ordersLabel}</GroupLabel>
              <List>
                {orders.map((t) => (
                  <ListRow
                    key={t.id}
                    leading={<IconTile icon={persona === 'driver' ? 'ticket' : 'bag'} size="sm" />}
                    title={t.ticket_number}
                    sub={`${t.customer_name ?? 'Walk-in'} · ${formatNaira(t.total_amount)}`}
                    onPress={() => router.push(`/order/${t.id}`)}
                  />
                ))}
              </List>
            </>
          )}
          {products.length > 0 && (
            <>
              <GroupLabel>Products</GroupLabel>
              <List>
                {products.map((p) => (
                  <ListRow
                    key={p.id}
                    leading={<IconTile icon="box" size="sm" />}
                    title={p.name}
                    sub={[
                      p.price_from === null ? 'No active price' : `${p.variant_count > 1 ? 'from ' : ''}${formatNaira(p.price_from)}`,
                      p.variant_count > 1 ? `${p.variant_count} sizes` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                    onPress={() => router.push(`/product/${p.id}`)}
                  />
                ))}
              </List>
            </>
          )}
        </>
      )}
    </ScreenScroll>
  );
}
