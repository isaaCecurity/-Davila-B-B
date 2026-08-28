import { getSupabaseClient } from '@bakeflow/auth';
import {
  useCashSessions,
  useCloseCashSession,
  useCreateExpense,
  useExpenses,
  useOpenCashSession,
  usePaymentTickets,
  useRecordPayment,
  useWarehouses,
} from '@bakeflow/hooks';
import { PAYMENT_METHODS, type PaymentMethod } from '@bakeflow/api';
import {
  EXPENSE_CATEGORIES,
  EXPENSE_PAID_METHODS,
  type CashSession,
  type ExpenseCategory,
  type ExpensePaidMethod,
} from '@bakeflow/types';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState, ErrorState, LoadingState, NoOrganizationState } from '../../components/ScreenState';
import { useSessionStore } from '../../stores/session';

export default function FinanceScreen(): React.JSX.Element {
  const client = getSupabaseClient();
  const router = useRouter();
  const tenantId = useSessionStore((state) => state.activeTenantId);
  const userId = useSessionStore((state) => state.userId);
  const sessions = useCashSessions(client, tenantId);
  const warehouses = useWarehouses(client, tenantId);
  const openSession = useOpenCashSession(client, tenantId);
  const closeSession = useCloseCashSession(client, tenantId);
  const paymentTickets = usePaymentTickets(client, tenantId);
  const recordPayment = useRecordPayment(client, tenantId);
  const expenses = useExpenses(client, tenantId);
  const createExpense = useCreateExpense(client, tenantId, userId);
  const [openingFloat, setOpeningFloat] = useState('0');
  const [countedAmounts, setCountedAmounts] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [selectedTicketId, setSelectedTicketId] = useState('');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [paymentReference, setPaymentReference] = useState('');
  const [expenseCategory, setExpenseCategory] = useState<ExpenseCategory>('other');
  const [expenseAmount, setExpenseAmount] = useState('');
  const [expensePaidMethod, setExpensePaidMethod] = useState<ExpensePaidMethod | null>(null);
  const [expenseDescription, setExpenseDescription] = useState('');

  const branchOptions = useMemo(() => {
    const seen = new Set<string>();
    return (warehouses.data ?? []).filter((warehouse) => {
      if (seen.has(warehouse.branch_id)) return false;
      seen.add(warehouse.branch_id);
      return true;
    });
  }, [warehouses.data]);

  if (tenantId === null) {
    return (
      <SafeAreaView className="flex-1 bg-white">
        <NoOrganizationState onChoose={() => router.push('/select-organization')} />
      </SafeAreaView>
    );
  }

  const openSessions = (sessions.data ?? []).filter((session) => session.status === 'open');
  const eligibleTickets = (paymentTickets.data?.rows ?? []).filter(
    (ticket) => ticket.status !== 'draft' && ticket.status !== 'cancelled',
  );
  const selectedTicket = eligibleTickets.find((ticket) => ticket.id === selectedTicketId);
  const openTill = openSessions.find((session) => session.status === 'open');

  return (
    <SafeAreaView className="flex-1 bg-white">
      <View className="flex-row items-center justify-between border-b border-neutral-200 p-6 pb-4">
        <View className="flex-1 gap-1 pr-3">
          <Text className="text-2xl font-bold text-neutral-900">Finance</Text>
          <Text className="text-sm text-neutral-500">Cash sessions and till control</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/')}
          className="rounded-lg border border-neutral-300 px-4 py-2 active:opacity-70"
        >
          <Text className="text-sm font-medium text-neutral-900">Catalog</Text>
        </Pressable>
      </View>

      {sessions.isPending ? (
        <LoadingState label="Loading cash sessions…" />
      ) : sessions.isError ? (
        <ErrorState error={sessions.error} onRetry={() => void sessions.refetch()} />
      ) : (
        <FlatList
          data={sessions.data}
          keyExtractor={(session) => session.id}
          contentContainerClassName="gap-4 p-6"
          refreshing={sessions.isRefetching}
          onRefresh={() => void sessions.refetch()}
          ListHeaderComponent={
            <View className="gap-3">
              <View className="gap-3 rounded-xl border border-neutral-200 p-4">
                <Text className="text-base font-semibold text-neutral-900">Record payment</Text>
                <Text className="text-sm text-neutral-500">
                  Choose an invoiced ticket. The server rejects payments above the outstanding balance.
                </Text>
                <View className="gap-2">
                  {eligibleTickets.slice(0, 8).map((ticket) => (
                    <Pressable
                      key={ticket.id}
                      accessibilityRole="button"
                      onPress={() => setSelectedTicketId(ticket.id)}
                      className={`rounded-lg border p-3 ${selectedTicketId === ticket.id ? 'border-neutral-900 bg-neutral-100' : 'border-neutral-200'}`}
                    >
                      <Text className="font-medium text-neutral-900">{ticket.ticket_number}</Text>
                      <Text className="text-sm text-neutral-500">
                        Outstanding: {ticket.total_amount} minus {ticket.amount_paid}
                      </Text>
                    </Pressable>
                  ))}
                  {eligibleTickets.length === 0 && (
                    <Text className="text-sm text-neutral-500">No invoiced tickets are available.</Text>
                  )}
                </View>
                {selectedTicket !== undefined && (
                  <View className="gap-2">
                    <TextInput
                      accessibilityLabel="Payment amount"
                      value={paymentAmount}
                      onChangeText={setPaymentAmount}
                      keyboardType="decimal-pad"
                      placeholder="Amount received"
                      className="rounded-lg border border-neutral-300 px-3 py-2 text-base text-neutral-900"
                    />
                    <View className="flex-row flex-wrap gap-2">
                      {PAYMENT_METHODS.map((method) => (
                        <Pressable
                          key={method}
                          accessibilityRole="button"
                          onPress={() => setPaymentMethod(method)}
                          className={`rounded-lg border px-3 py-2 ${paymentMethod === method ? 'border-neutral-900 bg-neutral-900' : 'border-neutral-300'}`}
                        >
                          <Text className={paymentMethod === method ? 'text-white' : 'text-neutral-900'}>
                            {method}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                    {paymentMethod !== 'cash' && (
                      <TextInput
                        accessibilityLabel="Payment reference"
                        value={paymentReference}
                        onChangeText={setPaymentReference}
                        placeholder="Reference (optional)"
                        className="rounded-lg border border-neutral-300 px-3 py-2 text-base text-neutral-900"
                      />
                    )}
                    {paymentMethod === 'cash' && openTill === undefined && (
                      <Text className="text-sm text-amber-800">Open a till before recording cash.</Text>
                    )}
                    <Pressable
                      accessibilityRole="button"
                      disabled={
                        recordPayment.isPending ||
                        paymentAmount.length === 0 ||
                        (paymentMethod === 'cash' && openTill === undefined)
                      }
                      onPress={() =>
                        recordPayment.mutate({
                          input: {
                            ticketId: selectedTicket.id,
                            amount: paymentAmount,
                            method: paymentMethod,
                            reference: paymentReference || null,
                            cashSessionId: paymentMethod === 'cash' ? (openTill?.id ?? null) : null,
                          },
                        })
                      }
                      className="rounded-lg bg-neutral-900 px-4 py-3 active:opacity-70 disabled:opacity-40"
                    >
                      {recordPayment.isPending ? <ActivityIndicator color="white" /> : <Text className="text-center font-semibold text-white">Record payment</Text>}
                    </Pressable>
                    {recordPayment.isError && (
                      <Text className="text-sm text-red-700">{recordPayment.error.message}</Text>
                    )}
                  </View>
                )}
              </View>
              <View className="rounded-xl border border-neutral-200 bg-neutral-50 p-4">
                <Text className="text-base font-semibold text-neutral-900">Open a till</Text>
                <Text className="mt-1 text-sm text-neutral-500">
                  Opening float is an exact amount. The server rejects a second open session per branch.
                </Text>
                <View className="mt-3 flex-row gap-2">
                  <TextInput
                    accessibilityLabel="Opening float"
                    value={openingFloat}
                    onChangeText={setOpeningFloat}
                    keyboardType="decimal-pad"
                    className="flex-1 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-base text-neutral-900"
                    placeholder="0.0000"
                  />
                  <Pressable
                    accessibilityRole="button"
                    disabled={openSession.isPending || branchOptions.length === 0}
                    onPress={() =>
                      openSession.mutate({
                        input: { branchId: branchOptions[0]?.branch_id ?? '', openingFloat },
                      })
                    }
                    className="rounded-lg bg-neutral-900 px-4 py-2 active:opacity-70 disabled:opacity-40"
                  >
                    {openSession.isPending ? (
                      <ActivityIndicator color="white" />
                    ) : (
                      <Text className="font-semibold text-white">Open</Text>
                    )}
                  </Pressable>
                </View>
                {branchOptions.length === 0 && (
                  <Text className="mt-2 text-sm text-amber-800">No branch stockroom is available to select.</Text>
                )}
                {openSession.isError && (
                  <Text className="mt-2 text-sm text-red-700">{openSession.error.message}</Text>
                )}
              </View>
              <View className="gap-3 rounded-xl border border-neutral-200 p-4">
                <Text className="text-base font-semibold text-neutral-900">Record expense</Text>
                <Text className="text-sm text-neutral-500">
                  Cash expenses require the currently open till; other methods do not.
                </Text>
                <View className="flex-row flex-wrap gap-2">
                  {EXPENSE_CATEGORIES.map((category) => (
                    <Pressable
                      key={category}
                      accessibilityRole="button"
                      onPress={() => setExpenseCategory(category)}
                      className={`rounded-lg border px-3 py-2 ${expenseCategory === category ? 'border-neutral-900 bg-neutral-900' : 'border-neutral-300'}`}
                    >
                      <Text className={expenseCategory === category ? 'text-white' : 'text-neutral-900'}>
                        {category}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                <TextInput
                  accessibilityLabel="Expense amount"
                  value={expenseAmount}
                  onChangeText={setExpenseAmount}
                  keyboardType="decimal-pad"
                  placeholder="Amount"
                  className="rounded-lg border border-neutral-300 px-3 py-2 text-base text-neutral-900"
                />
                <View className="flex-row flex-wrap gap-2">
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setExpensePaidMethod(null)}
                    className={`rounded-lg border px-3 py-2 ${expensePaidMethod === null ? 'border-neutral-900 bg-neutral-900' : 'border-neutral-300'}`}
                  >
                    <Text className={expensePaidMethod === null ? 'text-white' : 'text-neutral-900'}>
                      unspecified
                    </Text>
                  </Pressable>
                  {EXPENSE_PAID_METHODS.map((method) => (
                    <Pressable
                      key={method}
                      accessibilityRole="button"
                      onPress={() => setExpensePaidMethod(method)}
                      className={`rounded-lg border px-3 py-2 ${expensePaidMethod === method ? 'border-neutral-900 bg-neutral-900' : 'border-neutral-300'}`}
                    >
                      <Text className={expensePaidMethod === method ? 'text-white' : 'text-neutral-900'}>
                        {method}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                {expensePaidMethod === 'cash' && openTill === undefined && (
                  <Text className="text-sm text-amber-800">Open a till before recording a cash expense.</Text>
                )}
                <TextInput
                  accessibilityLabel="Expense description"
                  value={expenseDescription}
                  onChangeText={setExpenseDescription}
                  placeholder="Description (optional)"
                  className="rounded-lg border border-neutral-300 px-3 py-2 text-base text-neutral-900"
                />
                <Pressable
                  accessibilityRole="button"
                  disabled={
                    createExpense.isPending ||
                    expenseAmount.length === 0 ||
                    branchOptions.length === 0 ||
                    (expensePaidMethod === 'cash' && openTill === undefined)
                  }
                  onPress={() =>
                    createExpense.mutate(
                      {
                        input: {
                          branchId: branchOptions[0]?.branch_id ?? '',
                          category: expenseCategory,
                          amount: expenseAmount,
                          paidMethod: expensePaidMethod,
                          cashSessionId: expensePaidMethod === 'cash' ? (openTill?.id ?? null) : null,
                          description: expenseDescription || null,
                        },
                      },
                      {
                        onSuccess: () => {
                          setExpenseAmount('');
                          setExpenseDescription('');
                        },
                      },
                    )
                  }
                  className="rounded-lg bg-neutral-900 px-4 py-3 active:opacity-70 disabled:opacity-40"
                >
                  {createExpense.isPending ? (
                    <ActivityIndicator color="white" />
                  ) : (
                    <Text className="text-center font-semibold text-white">Record expense</Text>
                  )}
                </Pressable>
                {createExpense.isError && (
                  <Text className="text-sm text-red-700">{createExpense.error.message}</Text>
                )}
                {expenses.data !== undefined && expenses.data.length > 0 && (
                  <View className="mt-2 gap-1 border-t border-neutral-200 pt-2">
                    <Text className="text-xs font-semibold uppercase text-neutral-500">Recent expenses</Text>
                    {expenses.data.slice(0, 5).map((expense) => (
                      <Text key={expense.id} className="text-sm text-neutral-700">
                        {expense.category} — {expense.amount}
                        {expense.paid_method !== null ? ` (${expense.paid_method})` : ''}
                      </Text>
                    ))}
                  </View>
                )}
              </View>
              {openSessions.length > 0 && (
                <Text className="text-lg font-semibold text-neutral-900">Open sessions</Text>
              )}
            </View>
          }
          ListEmptyComponent={
            <EmptyState title="No cash sessions yet" detail="Open a till when a branch is ready for trading." />
          }
          renderItem={({ item }) => (
            <CashSessionCard
              session={item}
              countedAmount={countedAmounts[item.id] ?? ''}
              note={notes[item.id] ?? ''}
              onCountedAmountChange={(value) =>
                setCountedAmounts((current) => ({ ...current, [item.id]: value }))
              }
              onNoteChange={(value) => setNotes((current) => ({ ...current, [item.id]: value }))}
              onClose={() =>
                closeSession.mutate({
                  input: {
                    sessionId: item.id,
                    countedAmount: countedAmounts[item.id] ?? '',
                    note: notes[item.id] ?? null,
                  },
                })
              }
              isClosing={closeSession.isPending}
              closeError={closeSession.isError ? closeSession.error.message : null}
            />
          )}
        />
      )}
    </SafeAreaView>
  );
}

function CashSessionCard({
  session,
  countedAmount,
  note,
  onCountedAmountChange,
  onNoteChange,
  onClose,
  isClosing,
  closeError,
}: {
  session: CashSession;
  countedAmount: string;
  note: string;
  onCountedAmountChange: (value: string) => void;
  onNoteChange: (value: string) => void;
  onClose: () => void;
  isClosing: boolean;
  closeError: string | null;
}): React.JSX.Element {
  const isOpen = session.status === 'open';
  return (
    <View className="gap-3 rounded-xl border border-neutral-200 p-4">
      <View className="flex-row items-center justify-between">
        <Text className="font-semibold text-neutral-900">Branch {session.branch_id.slice(0, 8)}</Text>
        <Text className="text-xs font-semibold uppercase text-neutral-500">{session.status}</Text>
      </View>
      <Text className="text-sm text-neutral-500">Opening float: {session.opening_float}</Text>
      {!isOpen && (
        <View className="gap-1">
          <Text className="text-sm text-neutral-500">Expected: {session.expected_amount ?? '—'}</Text>
          <Text className="text-sm text-neutral-500">Counted: {session.counted_amount ?? '—'}</Text>
          <Text className="text-sm font-semibold text-neutral-900">
            Variance: {session.variance_amount ?? '—'}
          </Text>
        </View>
      )}
      {isOpen && (
        <View className="gap-2">
          <TextInput
            accessibilityLabel="Counted amount"
            value={countedAmount}
            onChangeText={onCountedAmountChange}
            keyboardType="decimal-pad"
            className="rounded-lg border border-neutral-300 px-3 py-2 text-base text-neutral-900"
            placeholder="Counted amount"
          />
          <TextInput
            accessibilityLabel="Variance note"
            value={note}
            onChangeText={onNoteChange}
            className="rounded-lg border border-neutral-300 px-3 py-2 text-base text-neutral-900"
            placeholder="Note if the drawer does not balance"
          />
          <Pressable
            accessibilityRole="button"
            disabled={isClosing || countedAmount.length === 0}
            onPress={onClose}
            className="rounded-lg bg-neutral-900 px-4 py-3 active:opacity-70 disabled:opacity-40"
          >
            {isClosing ? <ActivityIndicator color="white" /> : <Text className="text-center font-semibold text-white">Close session</Text>}
          </Pressable>
          {closeError !== null && <Text className="text-sm text-red-700">{closeError}</Text>}
        </View>
      )}
    </View>
  );
}