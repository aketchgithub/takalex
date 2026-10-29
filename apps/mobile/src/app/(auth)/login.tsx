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

const emailSchema = z.string().trim().email("Enter a valid email address.");
const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{7,14}$/, "Use an international phone number, for example +254712345678.");
const codeSchema = z
  .string()
  .trim()
  .regex(/^\d{6,8}$/, "Enter the 6–8 digit code from your SMS.");

export default function LoginScreen() {
  const [mode, setMode] = useState<"email" | "phone">("email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [phoneError, setPhoneError] = useState("");
  const [codeError, setCodeError] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const signInWithPassword = useAuthStore((state) => state.signInWithPassword);
  const requestPhoneOtp = useAuthStore((state) => state.requestPhoneOtp);
  const verifyPhoneOtp = useAuthStore((state) => state.verifyPhoneOtp);
  const isLoading = useAuthStore((state) => state.isLoading);
  const authError = useAuthStore((state) => state.authError);
  const statusMessage = useAuthStore((state) => state.statusMessage);
  const setAuthError = useAuthStore((state) => state.setAuthError);

  const signIn = async () => {
    const emailResult = emailSchema.safeParse(email);
    if (!emailResult.success) {
      setAuthError(emailResult.error.issues[0]?.message ?? "Enter a valid email address.");
      return;
    }
    if (password.length === 0) {
      setAuthError("Enter your password.");
      return;
    }

    await signInWithPassword(emailResult.data, password);
  };

  const continueWithPhone = async () => {
    const phoneResult = phoneSchema.safeParse(phone);
    setPhoneError(phoneResult.success ? "" : phoneResult.error.issues[0]?.message ?? "");
    if (!phoneResult.success) {
      return;
    }

    if (!codeSent) {
      await requestPhoneOtp(phoneResult.data);
      if (!useAuthStore.getState().authError) {
        setCodeSent(true);
      }
      return;
    }

    const codeResult = codeSchema.safeParse(code);
    setCodeError(codeResult.success ? "" : codeResult.error.issues[0]?.message ?? "");
    if (codeResult.success) {
      await verifyPhoneOtp(phoneResult.data, codeResult.data);
    }
  };

  const changeMode = (nextMode: "email" | "phone") => {
    setMode(nextMode);
    setCodeSent(false);
    setCode("");
    setPhoneError("");
    setCodeError("");
    setAuthError(null);
  };

  return (
    <Screen
      title="Welcome back"
      subtitle="Sign in to your Takalex account."
    >
      <InlineLink
        label={mode === "email" ? "Use phone verification instead" : "Use email and password instead"}
        onPress={() => changeMode(mode === "email" ? "phone" : "email")}
      />

      {mode === "email" ? (
        <>
          <Field
            autoComplete="email"
            autoCapitalize="none"
            keyboardType="email-address"
            label="Email"
            onChangeText={setEmail}
            placeholder="you@example.com"
            value={email}
          />
          <Field
            autoComplete="current-password"
            label="Password"
            onChangeText={setPassword}
            placeholder="Your password"
            secureTextEntry
            value={password}
          />
          <PrimaryButton
            label="Sign in"
            loading={isLoading}
            onPress={() => void signIn()}
          />
        </>
      ) : (
        <>
          <Field
            autoComplete="tel"
            keyboardType="phone-pad"
            label="Phone number"
            onChangeText={setPhone}
            placeholder="+254712345678"
            value={phone}
            error={phoneError}
          />
          {codeSent ? (
            <Field
              autoComplete="one-time-code"
              keyboardType="number-pad"
              label="SMS verification code"
              onChangeText={setCode}
              placeholder="Enter your code"
              value={code}
              error={codeError}
            />
          ) : null}
          <PrimaryButton
            label={codeSent ? "Verify code" : "Send SMS code"}
            loading={isLoading}
            onPress={() => void continueWithPhone()}
          />
          {codeSent ? (
            <InlineLink
              label="Use a different phone number"
              onPress={() => {
                setCodeSent(false);
                setCode("");
              }}
            />
          ) : null}
        </>
      )}

      {authError ? <Message tone="error">{authError}</Message> : null}
      {statusMessage ? <Message>{statusMessage}</Message> : null}
      <Message>New accounts are created by administrator invitation.</Message>
      <InlineLink
        label="Set up an invited account"
        onPress={() => router.push("/(auth)/register")}
      />
    </Screen>
  );
}
