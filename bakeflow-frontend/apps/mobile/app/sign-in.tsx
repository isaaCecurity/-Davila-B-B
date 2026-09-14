import { requestPhoneCode, signInWithPassword, verifyPhoneCode } from '@bakeflow/auth';
import { Button, Callout, Chips, Field, Screen, Text } from '@bakeflow/ui';
import { formatPhone, toE164Phone } from '@bakeflow/validation';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, View } from 'react-native';

import { usePendingInviteStore } from '../stores/auth/pendingInvite.store';

type Method = 'email' | 'phone';

/**
 * Supabase's phone errors, in words a bakery worker can act on. Anything unrecognised is shown
 * verbatim, for the same reason as the email path below.
 */
function phoneError(message: string): string {
  if (/unsupported phone provider|phone.*(signups?|logins?|provider).*disabled|sms.*not.*(enabled|configured)/i.test(message)) {
    return 'Signing in by phone is not switched on yet. Use email for now, or ask the bakery owner.';
  }
  if (/token has expired|invalid.*(token|otp)|otp.*(expired|invalid)/i.test(message)) {
    return 'That code is wrong or has expired. Check the text message, or send a new code.';
  }
  if (/rate limit|too many|security purposes/i.test(message)) {
    return 'Too many codes requested. Wait a minute, then send a new code.';
  }
  return message;
}

/**
 * Sign-in: email and password, or a code texted to a phone (AD-026).
 *
 * No navigation happens here on success. Both paths persist the session, which fires
 * `onAuthStateChange`, which updates the session store, which the gate in `_layout.tsx` reacts
 * to (including carrying a pending invite link to its screen). Navigating here as well would race
 * that and double-push.
 *
 * Email errors are rendered verbatim from Supabase ("Invalid login credentials", "Email not
 * confirmed"). Those distinctions are the difference between retyping a password and checking an
 * inbox, and collapsing them into "Sign-in failed" strands the second user.
 *
 * Phone: the first code sent to a new number creates the account — that is how someone invited by
 * phone gets one — so when an invite link is waiting, the screen also asks for their name.
 */
export default function SignInScreen(): React.JSX.Element {
  const invited = usePendingInviteStore((s) => s.token !== null);
  const [method, setMethod] = useState<Method>('email');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [fullName, setFullName] = useState('');
  const [code, setCode] = useState('');
  const [codeSentTo, setCodeSentTo] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const e164 = toE164Phone(phone);
  const canSubmitEmail = email.trim() !== '' && password !== '' && !submitting;
  const canSendCode = e164 !== null && !submitting;
  const canVerify = /^\d{6}$/.test(code.trim()) && !submitting;

  async function run(task: () => Promise<void>, describe: (m: string) => string = (m) => m): Promise<void> {
    setSubmitting(true);
    setError(null);
    try {
      await task();
    } catch (thrown) {
      setError(describe(thrown instanceof Error ? thrown.message : 'Sign-in failed.'));
    } finally {
      setSubmitting(false);
    }
  }

  function onEmailSubmit(): void {
    if (!canSubmitEmail) return;
    // Deliberately no router call — see the note above.
    void run(async () => {
      await signInWithPassword(email, password);
    });
  }

  function onSendCode(): void {
    if (e164 === null || submitting) return;
    void run(async () => {
      await requestPhoneCode(e164, invited ? fullName : undefined);
      setCode('');
      setCodeSentTo(e164);
    }, phoneError);
  }

  function onVerify(): void {
    if (codeSentTo === null || !canVerify) return;
    void run(async () => {
      await verifyPhoneCode(codeSentTo, code);
    }, phoneError);
  }

  function switchMethod(next: Method): void {
    setMethod(next);
    setError(null);
  }

  return (
    <Screen>
      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View className="flex-1 justify-center gap-5 p-gutter">
          <View className="gap-1">
            <Text variant="display">BakeFlow</Text>
            <Text variant="meta">
              {invited ? 'Sign in to accept your invite — with the email or phone number it was sent to.' : 'Sign in to your bakery.'}
            </Text>
          </View>

          {codeSentTo === null && (
            // Chips is a horizontal ScrollView; unwrapped in this centred column it grows to fill it.
            <View>
              <Chips
                accessibilityLabel="Sign in with"
                options={[
                  { key: 'email', label: 'Email' },
                  { key: 'phone', label: 'Phone number' },
                ]}
                value={method}
                onChange={switchMethod}
              />
            </View>
          )}

          {method === 'email' ? (
            <>
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
                onSubmitEditing={onEmailSubmit}
                returnKeyType="go"
              />
            </>
          ) : codeSentTo === null ? (
            <>
              <Field
                label="Phone number"
                value={phone}
                onChangeText={setPhone}
                keyboardType="phone-pad"
                autoComplete="tel"
                editable={!submitting}
                placeholder="0803 123 4567"
                error={phone.trim() === '' || e164 !== null ? null : 'Enter the full number, like 0803 123 4567'}
                hint="We text you a 6-digit code. Standard SMS rates may apply."
                onSubmitEditing={onSendCode}
                returnKeyType="send"
              />
              {invited && (
                <Field
                  label="Your name"
                  value={fullName}
                  onChangeText={setFullName}
                  autoComplete="name"
                  autoCapitalize="words"
                  editable={!submitting}
                  placeholder="As your team knows you"
                  hint="Used if this is your first time signing in."
                />
              )}
            </>
          ) : (
            <>
              <Text variant="meta">Enter the 6-digit code sent to {formatPhone(codeSentTo)}.</Text>
              <Field
                label="Code"
                value={code}
                onChangeText={(t) => setCode(t.replace(/[^0-9]/g, '').slice(0, 6))}
                keyboardType="number-pad"
                autoComplete="one-time-code"
                textContentType="oneTimeCode"
                editable={!submitting}
                placeholder="123456"
                onSubmitEditing={onVerify}
                returnKeyType="go"
              />
            </>
          )}

          {error !== null && <Callout tone="error" title="Could not sign in" detail={error} />}

          {method === 'email' ? (
            <Button label={submitting ? 'Signing in…' : 'Sign in'} busy={submitting} disabled={!canSubmitEmail} onPress={onEmailSubmit} />
          ) : codeSentTo === null ? (
            <Button label={submitting ? 'Sending code…' : 'Send code'} busy={submitting} disabled={!canSendCode} onPress={onSendCode} />
          ) : (
            <View className="gap-2.5">
              <Button label={submitting ? 'Checking…' : 'Sign in'} busy={submitting} disabled={!canVerify} onPress={onVerify} />
              <Button label="Send a new code" tone="secondary" disabled={submitting} onPress={onSendCode} />
              <Button
                label="Use a different number"
                tone="secondary"
                disabled={submitting}
                onPress={() => {
                  setCodeSentTo(null);
                  setCode('');
                  setError(null);
                }}
              />
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
