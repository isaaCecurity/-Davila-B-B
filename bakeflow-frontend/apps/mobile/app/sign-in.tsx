import { signInWithPassword } from '@bakeflow/auth';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

/**
 * Email/password sign-in.
 *
 * No navigation happens here on success. `signInWithPassword` persists the session, which
 * fires `onAuthStateChange`, which updates the session store, which the gate in
 * `_layout.tsx` reacts to. Navigating here as well would race that and double-push.
 *
 * The error is rendered verbatim from Supabase ("Invalid login credentials", "Email not
 * confirmed"). Those distinctions are the difference between retyping a password and
 * checking an inbox, and collapsing them into "Sign-in failed" strands the second user.
 */
export default function SignInScreen(): React.JSX.Element {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = email.trim() !== '' && password !== '' && !submitting;

  async function onSubmit(): Promise<void> {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await signInWithPassword(email, password);
      // Deliberately no router call — see the note above.
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : 'Sign-in failed.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-white">
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View className="flex-1 justify-center gap-5 p-6">
          <View className="gap-1">
            <Text className="text-3xl font-bold text-neutral-900">BakeFlow</Text>
            <Text className="text-base text-neutral-500">Sign in to your bakery.</Text>
          </View>

          <View className="gap-2">
            <Text className="text-sm font-medium text-neutral-700">Email</Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              inputMode="email"
              editable={!submitting}
              placeholder="you@bakery.ng"
              className="rounded-lg border border-neutral-300 px-4 py-3 text-base text-neutral-900"
            />
          </View>

          <View className="gap-2">
            <Text className="text-sm font-medium text-neutral-700">Password</Text>
            <TextInput
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoCapitalize="none"
              autoComplete="current-password"
              editable={!submitting}
              onSubmitEditing={() => void onSubmit()}
              returnKeyType="go"
              className="rounded-lg border border-neutral-300 px-4 py-3 text-base text-neutral-900"
            />
          </View>

          {error !== null && (
            <Text accessibilityRole="alert" className="text-base text-red-600">
              {error}
            </Text>
          )}

          <Pressable
            accessibilityRole="button"
            disabled={!canSubmit}
            onPress={() => void onSubmit()}
            className={`flex-row items-center justify-center gap-2 rounded-lg px-5 py-4 ${
              canSubmit ? 'bg-neutral-900 active:opacity-80' : 'bg-neutral-300'
            }`}
          >
            {submitting && <ActivityIndicator color="white" />}
            <Text className="text-base font-semibold text-white">
              {submitting ? 'Signing in…' : 'Sign in'}
            </Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
