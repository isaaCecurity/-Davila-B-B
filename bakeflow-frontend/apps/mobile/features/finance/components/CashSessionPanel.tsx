import type { CashSession, Expense } from '@bakeflow/types';
import { Badge, Button, Card, Icon, IconTile, List, ListRow, Text } from '@bakeflow/ui';
import { formatNaira } from '@bakeflow/utils';
import { useState } from 'react';
import { View } from 'react-native';

import { CATEGORY_META, varianceView, when } from '../financeDisplay';
import { CloseSessionSheet } from './CashSessionSheets';

function Line({ op, label, sub, value, strong = false, tone }: {
  op?: '+' | '−';
  label: string;
  sub?: string;
  value: string;
  strong?: boolean;
  tone?: 'good' | 'bad' | 'warn';
}): React.JSX.Element {
  const color = tone === 'good' ? 'text-success' : tone === 'bad' ? 'text-error' : tone === 'warn' ? 'text-warning-ink' : 'text-cocoa';
  return (
    <View className="flex-row items-start py-2">
      <Text className="w-5 text-callout text-warm-gray-soft">{op ?? ''}</Text>
      <View className="min-w-0 flex-1">
        <Text className={strong ? 'text-body font-semibold text-cocoa' : 'text-callout text-cocoa'}>{label}</Text>
        {sub !== undefined && <Text variant="caption">{sub}</Text>}
      </View>
      <Text tabular className={`${strong ? 'text-title-3 font-bold' : 'text-callout font-semibold'} ${color}`}>{value}</Text>
    </View>
  );
}

/**
 * One cash session as the prototype's ledger: float in, cash out, expected, counted, gap.
 *
 * Every figure is the server's. While a session is open, `expected_amount` and the variance do
 * not exist yet — they are computed at close — so the ledger says so rather than estimating.
 *
 * PORT-NOTE: the prototype adds "cash handed over from staff drawers" and totals "cash out".
 * There is no drawer-handover record, and totalling is money arithmetic; cash-out expenses are
 * listed one by one instead. Whether this person may close the session is decided by the
 * database, not by a client rule.
 */
export function CashSessionPanel({
  session,
  expenses,
}: {
  session: CashSession;
  expenses: readonly Expense[];
}): React.JSX.Element {
  const [closing, setClosing] = useState(false);
  const open = session.status === 'open';
  const variance = varianceView(session.variance_amount);
  const cashOut = expenses.filter((e) => e.cash_session_id === session.id);

  return (
    <View className="gap-3">
      <Card>
        <View className="mb-1 flex-row items-center gap-2">
          <Text variant="caption" className="flex-1">Opened {when(session.opened_at)}</Text>
          <Badge label={open ? 'Open' : 'Closed'} tone={open ? 'live' : 'neutral'} icon={open ? 'clock' : 'lock'} />
        </View>

        <Line label="Opening float" value={formatNaira(session.opening_float)} />
        {cashOut.length > 0 && (
          <Line op="−" label="Cash out" sub="Listed below" value={`${cashOut.length} expense${cashOut.length === 1 ? '' : 's'}`} />
        )}
        <View className="my-1 h-px bg-border" />
        <Line
          label="Expected in the drawer"
          sub={open ? 'Worked out when the session closes' : undefined}
          value={session.expected_amount === null ? '—' : formatNaira(session.expected_amount)}
          strong
        />
        <Line
          label="Counted"
          sub={session.closed_at !== null ? when(session.closed_at) : undefined}
          value={session.counted_amount === null ? '—' : formatNaira(session.counted_amount)}
          strong
        />
        {variance !== null && (
          <>
            <View className="my-1 h-px bg-border" />
            <Line
              label={variance.label}
              value={variance.amount}
              strong
              tone={variance.tone === 'ok' ? 'good' : variance.tone === 'bad' ? 'bad' : 'warn'}
            />
          </>
        )}

        {variance !== null && variance.tone !== 'ok' && (
          <Card tone="recessed" className="mt-3 flex-row items-start gap-3 p-3">
            <IconTile icon="info" tone={variance.tile} size="sm" />
            <View className="min-w-0 flex-1">
              <Text className="text-foot font-semibold text-cocoa">
                {variance.label} {variance.amount}
              </Text>
              <Text variant="meta" className="mt-0.5">
                {session.variance_note ?? 'No note was left explaining the gap.'}
              </Text>
            </View>
          </Card>
        )}

        {open && (
          <Button label="Close session" className="mt-4" onPress={() => setClosing(true)} block />
        )}
      </Card>

      {cashOut.length > 0 && (
        <View className="mt-5 gap-3">
          <Text variant="subtitle" accessibilityRole="header">Paid from this drawer</Text>
          <List>
            {cashOut.map((e) => (
              <ListRow
                key={e.id}
                leading={<IconTile icon={CATEGORY_META[e.category].icon} size="sm" />}
                title={e.description ?? CATEGORY_META[e.category].label}
                sub={`${CATEGORY_META[e.category].label} · ${when(e.incurred_at)}`}
                end={`−${formatNaira(e.amount)}`}
              />
            ))}
          </List>
        </View>
      )}

      {open && <CloseSessionSheet session={session} visible={closing} onClose={() => setClosing(false)} />}
      {!open && variance === null && (
        <View className="flex-row items-center gap-2 px-1">
          <Icon name="info" size={13} color="textMuted" />
          <Text variant="caption">This session closed without a recorded count.</Text>
        </View>
      )}
    </View>
  );
}
