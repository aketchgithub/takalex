import { useState } from "react";
import { Redirect, router } from "expo-router";

import { Field, InlineLink, Message, PrimaryButton, Screen } from "@/components/Ui";
import { SMS_PASSWORD_RESET } from "@/lib/features";
import { PHONE_CODE_SENT_MESSAGE, PHONE_SAVED_MESSAGE, normaliseResetCode, resetCodeError } from "@/lib/passwordReset";
import { formatPhone, normalisePhone, samePhone } from "@/lib/phoneNumber";
import { useAuthStore } from "@/stores/authStore";

function goBack() {
  if (router.canGoBack()) {
    router.back();
  } else {
    router.replace("/");
  }
}

// Adds or changes the phone number used for "Forgot password?". An SMS code
// goes to the new number (updateUser), and the number is saved only once the
// code is confirmed (verifyOtp type "phone_change"), so it is always one the
// user can receive texts on. For every signed-in role, so it lives outside the
// role groups and does its own signed-in check, like change-password.
export default function PhoneNumberScreen() {
  const isLoading = useAuthStore((state) => state.isLoading);
  const session = useAuthStore((state) => state.session);
  const profile = useAuthStore((state) => state.profile);
  const authError = useAuthStore((state) => state.authError);
  const sendPhoneCode = useAuthStore((state) => state.sendPhoneCode);
  const confirmPhoneCode = useAuthStore((state) => state.confirmPhoneCode);

  const [phone, setPhone] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"send" | "confirm" | null>(null);
  const [saved, setSaved] = useState(false);

  if (isLoading) {
    return (
      <Screen title="Loading your account">
        <Message>Please wait while Takalex verifies your account.</Message>
      </Screen>
    );
  }
  if (!session || authError || !profile || !profile.is_active) {
    return <Redirect href="/(auth)/login" />;
  }
  // The account card hides the way here while SMS is switched off; this
  // covers an old link.
  if (!SMS_PASSWORD_RESET) {
    return (
      <Screen topLink={{ label: "‹ Back", onPress: goBack }} title="Phone number">
        <Message>Adding a phone number is not available yet.</Message>
        <PrimaryButton label="Back" onPress={goBack} />
      </Screen>
    );
  }

  const current = formatPhone(session.user.phone);

  const send = async (number: string) => {
    setError(null);
    setBusy("send");
    const result = await sendPhoneCode(number);
    setBusy(null);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setPending(number);
    setCode("");
  };

  const submitNumber = async () => {
    const result = normalisePhone(phone);
    if (!result.ok) {
      setFieldError(result.message);
      return;
    }
    if (samePhone(result.e164, session.user.phone)) {
      setFieldError("This is already your saved number.");
      return;
    }
    setFieldError(null);
    await send(result.e164);
  };

  const submitCode = async () => {
    if (!pending) return;
    const problem = resetCodeError(code, "phone");
    setFieldError(problem);
    setError(null);
    if (problem) return;

    setBusy("confirm");
    const result = await confirmPhoneCode(pending, normaliseResetCode(code));
    setBusy(null);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setSaved(true);
  };

  if (saved) {
    return (
      <Screen topLink={{ label: "‹ Back", onPress: goBack }} title="Phone number saved">
        <Message tone="success">{PHONE_SAVED_MESSAGE}</Message>
        <PrimaryButton label="Done" onPress={goBack} />
      </Screen>
    );
  }

  if (pending) {
    return (
      <Screen
        topLink={{ label: "‹ Back", onPress: goBack }}
        title="Enter the code"
        subtitle={`Sent to ${formatPhone(pending) ?? pending}.`}
      >
        <Message>{PHONE_CODE_SENT_MESSAGE}</Message>
        <Field
          autoComplete="sms-otp"
          autoCorrect={false}
          keyboardType="number-pad"
          label="Code from the SMS"
          onChangeText={(value) => {
            setCode(value);
            setFieldError(null);
          }}
          placeholder="123456"
          textContentType="oneTimeCode"
          value={code}
          error={fieldError ?? undefined}
        />
        {error ? <Message tone="error">{error}</Message> : null}
        <PrimaryButton label="Confirm number" loading={busy === "confirm"} loadingLabel="Checking…" onPress={() => void submitCode()} />
        <InlineLink label="Send a new code" onPress={() => void send(pending)} />
        <InlineLink
          label="Use a different number"
          onPress={() => {
            setPending(null);
            setCode("");
            setFieldError(null);
            setError(null);
          }}
        />
      </Screen>
    );
  }

  return (
    <Screen
      topLink={{ label: "‹ Back", onPress: goBack }}
      title={current ? "Change phone number" : "Add phone number"}
      subtitle="If you forget your password, we send a code to this number so you can choose a new one."
    >
      {current ? <Message>Saved number: {current}</Message> : null}
      <Field
        autoComplete="tel"
        keyboardType="phone-pad"
        label={current ? "New phone number" : "Phone number"}
        onChangeText={(value) => {
          setPhone(value);
          setFieldError(null);
        }}
        placeholder="0712 345 678"
        textContentType="telephoneNumber"
        value={phone}
        error={fieldError ?? undefined}
      />
      {error ? <Message tone="error">{error}</Message> : null}
      <PrimaryButton label="Send code" loading={busy === "send"} loadingLabel="Sending…" onPress={() => void submitNumber()} />
    </Screen>
  );
}
