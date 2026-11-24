import { useEffect, useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { z } from "zod";

import { AuthScreen } from "@/components/AuthScreen";
import { Field, InlineLink, Message, PrimaryButton } from "@/components/Ui";
import { SMS_PASSWORD_RESET } from "@/lib/features";
import { normaliseResetCode, resetCodeError, type ResetChannel } from "@/lib/passwordReset";
import { PASSWORDS_DO_NOT_MATCH, passwordRuleError } from "@/lib/passwordRules";
import { formatPhone, normalisePhone } from "@/lib/phoneNumber";
import { useAuthStore } from "@/stores/authStore";

const emailSchema = z.string().trim().max(254).email("Enter a valid email address.");

type FieldErrors = Partial<Record<"address" | "code" | "password" | "confirmation", string>>;

// "Forgot password?" (Supabase Auth), by SMS code to the phone number on the
// account (the default) or by email code. While the SMS switch is off
// (lib/features.ts), email is the only way and the phone links are hidden:
//   1. number or email -> a code is sent (the answer never says whether the
//      number or email has an account)
//   2. code + new password -> verifyOtp (signs the user in) -> updateUser
// While a checked code has not yet led to a saved password, the store's
// isResettingPassword keeps the user here; leaving signs them out.
export default function ForgotPasswordScreen() {
  const params = useLocalSearchParams<{ email?: string }>();
  const requestPasswordReset = useAuthStore((state) => state.requestPasswordReset);
  const verifyResetCode = useAuthStore((state) => state.verifyResetCode);
  const setResetPassword = useAuthStore((state) => state.setResetPassword);
  const cancelPasswordReset = useAuthStore((state) => state.cancelPasswordReset);

  const [channel, setChannel] = useState<ResetChannel>(SMS_PASSWORD_RESET ? "phone" : "email");
  const [step, setStep] = useState<"address" | "code">("address");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState(typeof params.email === "string" ? params.email : "");
  const [sentTo, setSentTo] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [verified, setVerified] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"send" | "save" | null>(null);

  // Leaving with a checked code but no new password (back button, gesture):
  // sign out rather than stay signed in on the sign-in screens.
  useEffect(
    () => () => {
      if (useAuthStore.getState().isResettingPassword) void useAuthStore.getState().cancelPasswordReset();
    },
    [],
  );

  const sendCode = async (address: string) => {
    setError(null);
    setBusy("send");
    const outcome = await requestPasswordReset(channel, address);
    setBusy(null);
    // "slow": the app stopped waiting, but the code may still arrive.
    if (outcome.kind === "sent" || outcome.kind === "already_sent" || outcome.kind === "slow") {
      setSentTo(address);
      setNotice(outcome.message);
      setStep("code");
      return;
    }
    setError(outcome.message);
  };

  const submitAddress = async () => {
    if (channel === "phone") {
      const result = normalisePhone(phone);
      if (!result.ok) {
        setFieldErrors({ address: result.message });
        return;
      }
      setFieldErrors({});
      await sendCode(result.e164);
      return;
    }
    const result = emailSchema.safeParse(email);
    if (!result.success) {
      setFieldErrors({ address: result.error.issues[0]?.message ?? "Enter a valid email address." });
      return;
    }
    setFieldErrors({});
    await sendCode(result.data);
  };

  const submitNewPassword = async () => {
    const errors: FieldErrors = {};
    if (!verified) {
      const codeError = resetCodeError(code, channel);
      if (codeError) errors.code = codeError;
    }
    const ruleError = passwordRuleError(password);
    if (ruleError) errors.password = ruleError;
    if (confirmation !== password) errors.confirmation = PASSWORDS_DO_NOT_MATCH;
    setFieldErrors(errors);
    setError(null);
    if (Object.keys(errors).length > 0) return;

    setBusy("save");
    if (!verified) {
      const check = await verifyResetCode(channel, sentTo, normaliseResetCode(code));
      if (!check.ok) {
        setBusy(null);
        setError(check.message);
        return;
      }
      setVerified(true);
      setCode("");
    }

    const result = await setResetPassword(password);
    setBusy(null);
    if (!result.ok) {
      // The code was used up; the user stays signed in here and can try
      // another password.
      setError(result.message);
      return;
    }
    setPassword("");
    setConfirmation("");
    // The sign-in screens now send the signed-in user home.
  };

  const backToSignIn = async () => {
    await cancelPasswordReset();
    router.replace("/(auth)/login");
  };

  // Back to step 1, optionally on the other channel.
  const startAgain = async (next: ResetChannel) => {
    await cancelPasswordReset();
    setChannel(next);
    setVerified(false);
    setCode("");
    setPassword("");
    setConfirmation("");
    setFieldErrors({});
    setNotice(null);
    setError(null);
    setStep("address");
  };

  const other: ResetChannel = channel === "phone" ? "email" : "phone";
  const switchLabel = channel === "phone" ? "Use email instead" : "Use phone number instead";

  if (step === "address") {
    return (
      <AuthScreen
        footer={{ label: "Back to sign in", onPress: () => void backToSignIn() }}
        title="Forgot your password?"
        subtitle={
          channel === "phone"
            ? "Enter the phone number saved on your Takalex account. We will send you a code by SMS to choose a new password."
            : "Enter the email address you use for Takalex. We will email you a code to choose a new password."
        }
      >
        {channel === "phone" ? (
          <Field
            autoComplete="tel"
            keyboardType="phone-pad"
            label="Phone number"
            onChangeText={(value) => {
              setPhone(value);
              setFieldErrors({});
            }}
            placeholder="0712 345 678"
            textContentType="telephoneNumber"
            value={phone}
            error={fieldErrors.address}
          />
        ) : (
          <Field
            autoComplete="email"
            autoCapitalize="none"
            keyboardType="email-address"
            label="Email"
            onChangeText={(value) => {
              setEmail(value);
              setFieldErrors({});
            }}
            placeholder="you@example.com"
            value={email}
            error={fieldErrors.address}
          />
        )}
        {error ? <Message tone="error">{error}</Message> : null}
        <PrimaryButton label="Send code" loading={busy === "send"} loadingLabel="Sending…" onPress={() => void submitAddress()} />
        {SMS_PASSWORD_RESET ? <InlineLink label={switchLabel} onPress={() => void startAgain(other)} /> : null}
      </AuthScreen>
    );
  }

  const shownAddress = channel === "phone" ? (formatPhone(sentTo) ?? sentTo) : sentTo;

  return (
    <AuthScreen
      footer={{ label: "Back to sign in", onPress: () => void backToSignIn() }}
      title={verified ? "Choose a new password" : "Enter the code"}
      subtitle={verified ? "Your code was accepted." : `Sent to ${shownAddress}.`}
    >
      {notice && !verified ? <Message>{notice}</Message> : null}

      {verified ? null : (
        <Field
          autoComplete={channel === "phone" ? "sms-otp" : "one-time-code"}
          autoCorrect={false}
          keyboardType="number-pad"
          label={channel === "phone" ? "Code from the SMS" : "Code from the email"}
          onChangeText={(value) => {
            setCode(value);
            setFieldErrors((current) => ({ ...current, code: undefined }));
          }}
          placeholder={channel === "phone" ? "123456" : "12345678"}
          textContentType="oneTimeCode"
          value={code}
          error={fieldErrors.code}
        />
      )}
      <Field
        autoComplete="new-password"
        label="New password"
        onChangeText={setPassword}
        placeholder="At least 8 characters"
        revealable
        value={password}
        error={fieldErrors.password}
      />
      <Field
        autoComplete="new-password"
        label="Confirm new password"
        onChangeText={setConfirmation}
        placeholder="Re-enter your new password"
        revealable
        value={confirmation}
        error={fieldErrors.confirmation}
      />

      {error ? <Message tone="error">{error}</Message> : null}

      <PrimaryButton
        label="Change password"
        loading={busy === "save"}
        loadingLabel="Changing password…"
        onPress={() => void submitNewPassword()}
      />
      {verified ? null : (
        <>
          <InlineLink label="Send a new code" onPress={() => void sendCode(sentTo)} />
          <InlineLink
            label={channel === "phone" ? "Use a different number" : "Use a different email"}
            onPress={() => void startAgain(channel)}
          />
          {SMS_PASSWORD_RESET ? <InlineLink label={switchLabel} onPress={() => void startAgain(other)} /> : null}
        </>
      )}
    </AuthScreen>
  );
}
