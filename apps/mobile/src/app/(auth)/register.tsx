import { useState } from "react";
import { router } from "expo-router";
import { z } from "zod";

import {
  Field,
  InlineLink,
  Message,
  PrimaryButton,
  Screen,
} from "@/components/Ui";
import { useAuthStore } from "@/stores/authStore";

const passwordSchema = z
  .string()
  .min(8, "Use a password with at least 8 characters.");
const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{7,14}$/, "Use an international phone number, for example +254712345678.");
const codeSchema = z
  .string()
  .trim()
  .regex(/^\d{6,8}$/, "Enter the 6-8 digit code from your SMS.");

export default function RegisterScreen() {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const session = useAuthStore((state) => state.session);
  const invitationPending = useAuthStore((state) => state.invitationPending);
  const phoneOtpPending = useAuthStore((state) => state.phoneOtpPending);
  const pendingPhone = useAuthStore((state) => state.pendingPhone);
  const isLoading = useAuthStore((state) => state.isLoading);
  const authError = useAuthStore((state) => state.authError);
  const statusMessage = useAuthStore((state) => state.statusMessage);
  const acceptInvitation = useAuthStore((state) => state.acceptInvitation);
  const verifyPhoneChange = useAuthStore((state) => state.verifyPhoneChange);
  const finishInvitationWithoutPhone = useAuthStore(
    (state) => state.finishInvitationWithoutPhone,
  );
  const setAuthError = useAuthStore((state) => state.setAuthError);

  const submit = async () => {
    const result = passwordSchema.safeParse(password);
    if (!result.success) {
      setAuthError(result.error.issues[0]?.message ?? "Choose a stronger password.");
      return;
    }
    if (password !== confirmation) {
      setAuthError("The passwords do not match.");
      return;
    }

    if (phone.length > 0) {
      const phoneResult = phoneSchema.safeParse(phone);
      if (!phoneResult.success) {
        setAuthError(phoneResult.error.issues[0]?.message ?? "Enter a valid phone number.");
        return;
      }
      await acceptInvitation(password, phoneResult.data);
      return;
    }

    await acceptInvitation(password);
  };

  const verifyPhone = async () => {
    const phoneResult = phoneSchema.safeParse(pendingPhone ?? "");
    const codeResult = codeSchema.safeParse(code);
    if (!phoneResult.success) {
      setAuthError("The invitation phone number is invalid.");
      return;
    }
    if (!codeResult.success) {
      setAuthError(codeResult.error.issues[0]?.message ?? "Enter your SMS code.");
      return;
    }

    await verifyPhoneChange(phoneResult.data, codeResult.data);
  };

  if (!session || !invitationPending) {
    return (
      <Screen
        title="Account setup"
        subtitle="Takalex accounts are invite-only. Ask an administrator to send you an invitation, then open its link on this device."
      >
        {authError ? <Message tone="error">{authError}</Message> : null}
        <InlineLink
          label="Return to sign in"
          onPress={() => router.replace("/(auth)/login")}
        />
      </Screen>
    );
  }

  return (
    <Screen
      title="Finish account setup"
      subtitle={`Choose a password for ${session.user.email ?? "your invited account"}.`}
    >
      <Field
        autoComplete="new-password"
        label="New password"
        onChangeText={setPassword}
        placeholder="At least 8 characters"
        secureTextEntry
        value={password}
      />
      <Field
        autoComplete="new-password"
        label="Confirm password"
        onChangeText={setConfirmation}
        placeholder="Re-enter your password"
        secureTextEntry
        value={confirmation}
      />
      {phoneOtpPending ? (
        <Field
          autoComplete="one-time-code"
          keyboardType="number-pad"
          label="SMS verification code"
          onChangeText={setCode}
          placeholder="Enter your code"
          value={code}
        />
      ) : (
        <Field
          autoComplete="tel"
          keyboardType="phone-pad"
          label="Phone number (optional)"
          onChangeText={setPhone}
          placeholder="+254712345678"
          value={phone}
        />
      )}
      {authError ? <Message tone="error">{authError}</Message> : null}
      {statusMessage ? <Message>{statusMessage}</Message> : null}
      {phoneOtpPending ? (
        <>
          <PrimaryButton
            label="Verify phone"
            loading={isLoading}
            onPress={() => void verifyPhone()}
          />
          <PrimaryButton
            label="Continue with email and password"
            loading={isLoading}
            onPress={() => void finishInvitationWithoutPhone()}
          />
        </>
      ) : (
        <PrimaryButton
          label={phone.length > 0 ? "Save password and verify phone" : "Save password"}
          loading={isLoading}
          onPress={() => void submit()}
        />
      )}
    </Screen>
  );
}
