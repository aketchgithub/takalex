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

export default function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const signInWithPassword = useAuthStore((state) => state.signInWithPassword);
  const isLoading = useAuthStore((state) => state.isLoading);
  const authError = useAuthStore((state) => state.authError);
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

  return (
    <Screen
      title="Welcome back"
      subtitle="Sign in to your Takalex account."
    >
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

      {authError ? <Message tone="error">{authError}</Message> : null}
      <Message>New accounts are created by administrator invitation.</Message>
      <InlineLink
        label="I have an invitation code"
        onPress={() => {
          setAuthError(null);
          router.push("/(auth)/activate");
        }}
      />
    </Screen>
  );
}
