import { getSupabaseClient } from '@bakeflow/auth';
import { useCashSessions, useCreateExpense } from '@bakeflow/hooks';
import {
  EXPENSE_CATEGORIES,
  EXPENSE_PAID_METHODS,
  type ExpenseCategory,
  type ExpensePaidMethod,
} from '@bakeflow/types';
import {
  Button,
  Callout,
  Chips,
  Field,
  Icon,
  IconButton,
  PressableScale,
  ScreenScroll,
  Text,
} from '@bakeflow/ui';
import { formatNaira } from '@bakeflow/utils';
import { positiveMoneySchema } from '@bakeflow/validation';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { NoOrganizationState } from '../components/ScreenState';
import { useBranchOptions } from '../features/branch/hooks/useBranchOptions';
import { CATEGORY_META, METHOD_LABEL } from '../features/finance/financeDisplay';
import { useSessionStore } from '../stores/session';
import { toast } from '../stores/ui/toast.store';

/**
 * Add expense — the prototype's `add-expense`: the amount big and first, then what it was for
 * and how it was paid.
 *
 * The amount stays the exact decimal string typed, validated by the API's own money schema.
 * A cash expense is attached to the branch's open till, the same rule the finance screen uses;
 * without an open till, cash is refused here rather than recorded against nothing.
 *
 * PORT-NOTE: the prototype hides "Cash" from supervisors ("you can't open a till"). That is an
 * authorization rule; whether a supervisor may record a cash expense is the database's call, so
 * the method is offered and a refusal is shown as returned. Receipt photos wait for an upload
 * flow.
 */
export default function AddExpenseScreen(): React.JSX.Element {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const client = getSupabaseClient();
  const tenantId = useSessionStore((s) => s.activeTenantId);
  const userId = useSessionStore((s) => s.userId);
  const branches = useBranchOptions();
  const [branchIndex, setBranchIndex] = useState(0);
  const branch = branches.options[branchIndex] ?? branches.options[0] ?? null;

  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<ExpenseCategory>('ingredients');
  const [method, setMethod] = useState<ExpensePaidMethod>('cash');
  const [description, setDescription] = useState('');

  const sessions = useCashSessions(client, tenantId, branch?.branchId);
  const create = useCreateExpense(client, tenantId, userId);

  const openTill = (sessions.data ?? []).find((s) => s.status === 'open');
  const parsed = positiveMoneySchema.safeParse(amount.trim());
  const amountBad = amount.trim() !== '' && !parsed.success;
  const needsTill = method === 'cash' && openTill === undefined;
  const leave = (): void => (router.canGoBack() ? router.back() : router.replace('/expenses'));

  if (tenantId === null) {
    return <NoOrganizationState onChoose={() => router.push('/select-organization')} />;
  }

  function save(): void {
    if (!parsed.success || branch === null || needsTill) return;
    const spent = parsed.data;
    create.mutate(
      {
        input: {
          branchId: branch.branchId,
          category,
          amount: spent,
          paidMethod: method,
          cashSessionId: method === 'cash' ? (openTill?.id ?? null) : null,
          description: description.trim() === '' ? null : description.trim(),
        },
      },
      {
        onSuccess: () => {
          toast({ tone: 'success', title: 'Expense recorded', text: `${formatNaira(spent)} · ${CATEGORY_META[category].label}` });
          leave();
        },
      }
    );
  }

  return (
    <View className="flex-1 bg-cream">
      <ScreenScroll title="Add expense" right={<IconButton icon="close" label="Close" onPress={leave} />}>
        {branches.options.length > 1 && (
          <View className="gap-2 pt-2">
            <Text variant="label">Branch</Text>
            <Chips
              accessibilityLabel="Branch"
              options={branches.options.map((b, i) => ({ key: String(i), label: b.label }))}
              value={String(branchIndex)}
              onChange={(k) => setBranchIndex(Number(k))}
            />
          </View>
        )}

        {/* The prototype's `.amount-input`: the money moment. */}
        <View className="mt-3 flex-row items-center justify-center gap-2 rounded-md bg-cream-deep px-4 py-5">
          <Text className="text-title-2 font-semibold text-warm-gray">₦</Text>
          <TextInput
            value={amount}
            onChangeText={setAmount}
            keyboardType="decimal-pad"
            inputMode="decimal"
            placeholder="0"
            autoFocus
            accessibilityLabel="Amount in naira"
            className="min-w-[120px] text-center text-[38px] font-bold tracking-[-1.3px] text-cocoa"
            style={{ fontVariant: ['tabular-nums'] }}
          />
        </View>
        {amountBad && (
          <Text accessibilityRole="alert" variant="meta" className="mt-2 text-center text-error">
            Enter an amount like 5000 or 5000.50
          </Text>
        )}

        <View className="mt-5 gap-3">
          <Text variant="subtitle" accessibilityRole="header">Category</Text>
          <View className="flex-row flex-wrap gap-2">
            {EXPENSE_CATEGORIES.map((c) => {
              const on = c === category;
              return (
                <PressableScale
                  key={c}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  aria-selected={on}
                  accessibilityLabel={CATEGORY_META[c].label}
                  onPress={() => setCategory(c)}
                  scaleTo={0.96}
                  className={`min-h-tap w-[48.5%] flex-row items-center gap-2.5 rounded-sm px-3 py-3 ${on ? 'bg-white shadow-e2' : 'bg-white/60'}`}
                >
                  <View className={`h-8 w-8 items-center justify-center rounded-[10px] ${on ? 'bg-ink' : 'bg-cream-deep'}`}>
                    <Icon name={CATEGORY_META[c].icon} size={16} color={on ? 'white' : 'cocoa'} />
                  </View>
                  <Text className={`text-callout ${on ? 'font-semibold text-cocoa' : 'text-warm-gray'}`}>{CATEGORY_META[c].label}</Text>
                </PressableScale>
              );
            })}
          </View>
        </View>

        <View className="mt-6">
          <Field label="What was it for?" value={description} onChangeText={setDescription} placeholder="e.g. 2 bags of flour" />
        </View>

        <View className="mt-6 gap-3">
          <Text variant="subtitle" accessibilityRole="header">Paid with</Text>
          <Chips
            accessibilityLabel="Payment method"
            options={EXPENSE_PAID_METHODS.map((m) => ({ key: m, label: METHOD_LABEL[m] }))}
            value={method}
            onChange={setMethod}
          />
          {needsTill && (
            <Callout
              tone="warning"
              title="No open till"
              detail="Cash expenses come out of the till, and none is open at this branch. Open a cash session first, or choose another method."
            />
          )}
          {create.isError && <Callout tone="error" title="Expense not saved" detail={create.error.message} />}
        </View>
        <View className="h-28" />
      </ScreenScroll>

      <View
        className="absolute bottom-0 left-0 right-0 border-t border-border bg-white px-gutter pt-3 shadow-e4"
        style={{ paddingBottom: Math.max(insets.bottom, 16) }}
      >
        <Button
          label="Save expense"
          busy={create.isPending}
          disabled={!parsed.success || branch === null || needsTill}
          onPress={save}
          block
        />
      </View>
    </View>
  );
}
