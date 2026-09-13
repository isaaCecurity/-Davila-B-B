import { signInWithPassword } from '@bakeflow/auth';
import { Button, Callout, Field, Screen, Text } from '@bakeflow/ui';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, View } from 'react-native';

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
    <Screen>
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View className="flex-1 justify-center gap-5 p-gutter">
          <View className="gap-1">
            <Text variant="display">BakeFlow</Text>
            <Text variant="meta">Sign in to your bakery.</Text>
          </View>

          <Field
            label="Email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            inputMode="email"
            editable={!submitting}
            placeholder="you@bakery.ng"
          />

          <Field
            label="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            autoComplete="current-password"
            editable={!submitting}
            onSubmitEditing={() => void onSubmit()}
            returnKeyType="go"
          />

          {error !== null && <Callout tone="error" title="Could not sign in" detail={error} />}

          <Button
            label={submitting ? 'Signing in…' : 'Sign in'}
            busy={submitting}
            disabled={!canSubmit}
            onPress={() => void onSubmit()}
          />
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
