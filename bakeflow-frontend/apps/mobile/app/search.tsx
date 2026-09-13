import { getSupabaseClient } from '@bakeflow/auth';
import { useCustomerPages, useCustomersByPhone, useProducts, useTickets } from '@bakeflow/hooks';
import { Avatar, EmptyState, GroupLabel, IconTile, List, ListRow, ScreenScroll, SearchBar, Skeleton, Text } from '@bakeflow/ui';
import { formatNaira } from '@bakeflow/utils';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { NoOrganizationState } from '../components/ScreenState';
import { useActivePersona } from '../features/auth/hooks/useActivePersona';
import { STATUS_META, ticketTime } from '../features/tickets/ticketDisplay';
import { useSessionStore } from '../stores/session';

const PAGE = { limit: 200 } as const;
const SHOWN = 6;
const looksLikePhone = (q: string): boolean => /^[+\d][\d\s-]{5,}$/.test(q);

/**
 * Search — the prototype's `search`: one box across customers, orders and products, scoped to
 * what each role can already see.
 *
 * A phone-shaped query asks the server for that exact number; anything else filters recently
 * loaded rows (the newest 200 orders, the first 200 products and customers). Every result opens
 * its own screen. RLS bounds every read, so a role only ever matches rows it could open.
 *
 * PORT-NOTE: the prototype searches its whole fictional dataset in memory. There is no
 * full-text search endpoint, so older orders beyond the newest 200 are not matched — the screen
 * says which sets it searched. Deliveries and production categories are reached from their own
 * screens.
 */
export default function SearchScreen(): React.JSX.Element {
  const router = useRouter();
  const client = getSupabaseClient();
  const persona = useActivePersona();
  const tenantId = useSessionStore((s) => s.activeTenantId);
  const userId = useSessionStore((s) => s.userId);
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const active = q.length >= 2;
  const phone = looksLikePhone(q);

  const seesCatalog = persona !== 'driver';
  const ownOrdersOnly = persona === 'cashier' || persona === 'driver';

  const customers = useCustomerPages(client, active ? tenantId : null, { isWalkIn: false });
  const byPhone = useCustomersByPhone(client, tenantId, phone ? q : '');
  const tickets = useTickets(client, active ? tenantId : null, ownOrdersOnly && userId !== null ? { createdBy: userId } : {}, PAGE);
  const products = useProducts(client, active && seesCatalog ? tenantId : null, PAGE);

  const results = useMemo(() => {
    if (!active) return { customers: [], orders: [], products: [] };
    const loaded = customers.data?.pages.flatMap((p) => p.rows) ?? [];
    return {
      customers: phone ? (byPhone.data ?? []) : loaded.filter((c) => c.full_name.toLowerCase().includes(q) || (c.phone ?? '').includes(q)),
      orders: (tickets.data?.rows ?? []).filter((t) => t.ticket_number.toLowerCase().includes(q)),
      products: (products.data?.rows ?? []).filter((p) => p.name.toLowerCase().includes(q)),
    };
  }, [active, phone, q, customers.data, byPhone.data, tickets.data, products.data]);

  if (tenantId === null) {
    return <NoOrganizationState onChoose={() => router.push('/select-organization')} />;
  }

  const loading = active && (customers.isLoading || tickets.isLoading || (seesCatalog && products.isLoading));
  const count = results.customers.length + results.orders.length + results.products.length;

  return (
    <ScreenScroll title="Search" onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))}>
      <View className="mt-2">
        <SearchBar value={query} onChangeText={setQuery} placeholder="Customers, order numbers, products" autoFocus />
      </View>

      {!active ? (
        <Text variant="meta" className="mt-6 text-center">Type at least two letters, an order number, or a phone number.</Text>
      ) : loading ? (
        <View className="mt-4 gap-2"><Skeleton variant="row" /><Skeleton variant="row" /></View>
      ) : count === 0 ? (
        <EmptyState icon="search" title={`Nothing matches “${query.trim()}”`} text="Try part of a name, a full phone number, or an order number like TKT-000081." />
      ) : (
        <>
          {results.customers.length > 0 && (
            <>
              <GroupLabel>Customers</GroupLabel>
              <List>
                {results.customers.slice(0, SHOWN).map((c) => (
                  <ListRow key={c.id} leading={<Avatar name={c.full_name} />} title={c.full_name} sub={c.phone ?? undefined} onPress={() => router.push(`/customer/${c.id}`)} />
                ))}
              </List>
            </>
          )}
          {results.orders.length > 0 && (
            <>
              <GroupLabel>Orders</GroupLabel>
              <List>
                {results.orders.slice(0, SHOWN).map((t) => (
                  <ListRow
                    key={t.id}
                    leading={<IconTile icon="bag" size="sm" />}
                    title={t.ticket_number}
                    sub={`${STATUS_META[t.status].label} · ${ticketTime(t.created_at)}`}
                    end={formatNaira(t.total_amount)}
                    onPress={() => router.push(`/order/${t.id}`)}
                  />
                ))}
              </List>
            </>
          )}
          {results.products.length > 0 && (
            <>
              <GroupLabel>Products</GroupLabel>
              <List>
                {results.products.slice(0, SHOWN).map((p) => (
                  <ListRow key={p.id} leading={<IconTile icon="box" size="sm" />} title={p.name} onPress={() => router.push(`/product/${p.id}`)} />
                ))}
              </List>
            </>
          )}
          <Text variant="caption" className="mt-4 text-center">
            Searched {phone ? 'customers by phone' : 'loaded customers'}, the newest {ownOrdersOnly ? 'of your ' : ''}orders{seesCatalog ? ' and products' : ''}.
          </Text>
        </>
      )}
    </ScreenScroll>
  );
}
