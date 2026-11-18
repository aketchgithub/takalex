import { useEffect, useState } from "react";
import { router } from "expo-router";
import { StyleSheet, View } from "react-native";
import { z } from "zod";

import { AuthScreen, Divider } from "@/components/AuthScreen";
import { Field, InlineLink, Message, PrimaryButton, SecondaryButton } from "@/components/Ui";
import { useAuthStore } from "@/stores/authStore";

const emailSchema = z.string().trim().email("Enter a valid email address.");

export default function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const signInWithPassword = useAuthStore((state) => state.signInWithPassword);
  const isLoading = useAuthStore((state) => state.isLoading);
  const authError = useAuthStore((state) => state.authError);
  const setAuthError = useAuthStore((state) => state.setAuthError);

  // A sign-in error belongs to the attempt that caused it: clear it when the
  // screen opens again (for example after "Back to home").
  useEffect(() => {
    setAuthError(null);
  }, [setAuthError]);

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

  const go = (target: () => void) => {
    setAuthError(null);
    target();
  };

  return (
    <AuthScreen
      title="Welcome back"
      subtitle="Sign in to record and review deliveries."
      footer={{ label: "Back to home", onPress: () => router.dismissTo("/") }}
    >
      <Field
        autoComplete="email"
        autoCapitalize="none"
        keyboardType="email-address"
        label="Email"
        onChangeText={(value) => {
          setEmail(value);
          if (authError) setAuthError(null);
        }}
        placeholder="you@example.com"
        value={email}
      />
      <Field
        autoComplete="current-password"
        label="Password"
        onChangeText={(value) => {
          setPassword(value);
          if (authError) setAuthError(null);
        }}
        placeholder="Your password"
        revealable
        value={password}
      />
      {/* Under the password field, on the right. */}
      <View style={styles.forgot}>
        <InlineLink
          label="Forgot password?"
          onPress={() =>
            go(() => router.push({ pathname: "/(auth)/forgot-password", params: { email: email.trim() } } as any))
          }
        />
      </View>

      {authError ? <Message tone="error">{authError}</Message> : null}

      <PrimaryButton label="Sign in" loading={isLoading} loadingLabel="Signing in…" onPress={() => void signIn()} />

      <Divider label="New to Takalex?" />

      <SecondaryButton label="I have an invitation code" onPress={() => go(() => router.push("/(auth)/activate"))} />
      <InlineLink label="Request access" onPress={() => go(() => router.push("/request-access" as any))} />
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  // Right under the password field.
  forgot: { alignItems: "flex-end", marginTop: -6 },
});
