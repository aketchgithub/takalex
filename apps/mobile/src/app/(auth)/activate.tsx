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

// Mirror accept-invitation's input rules so most mistakes are caught before
// the request (the function enforces them again).
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_BYTES = 72;
const PASSWORD_RULE = `Password must be at least ${MIN_PASSWORD_LENGTH} characters (and at most ${MAX_PASSWORD_BYTES} bytes).`;

const emailSchema = z.string().trim().max(254).email("Enter a valid email address.");

// Codes are accepted in any case, with or without spaces or hyphens; the
// Edge Function normalises them before hashing.
const normaliseCode = (value: string) => value.toUpperCase().replace(/[\s-]/g, "");

type FieldErrors = Partial<Record<"email" | "code" | "password" | "confirmation", string>>;

export default function ActivateAccountScreen() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [signInInstead, setSignInInstead] = useState(false);
  const activateAccount = useAuthStore((state) => state.activateAccount);
  const isActivating = useAuthStore((state) => state.isActivating);

  const submit = async () => {
    const errors: FieldErrors = {};
    const emailResult = emailSchema.safeParse(email);
    if (!emailResult.success) {
      errors.email = emailResult.error.issues[0]?.message ?? "Enter a valid email address.";
    }
    if (normaliseCode(code).length === 0) {
      errors.code = "Enter the invitation code from your administrator.";
    }
    if (
      password.length < MIN_PASSWORD_LENGTH ||
      new TextEncoder().encode(password).length > MAX_PASSWORD_BYTES
    ) {
      errors.password = PASSWORD_RULE;
    }
    if (confirmation !== password) {
      errors.confirmation = "The passwords do not match.";
    }
    setFieldErrors(errors);
    setError(null);
    setSignInInstead(false);
    if (Object.keys(errors).length > 0 || !emailResult.success) {
      return;
    }

    const result = await activateAccount(emailResult.data, code, password);
    if (result.ok) {
      setPassword("");
      setConfirmation("");
      setCode("");
      router.replace("/");
      return;
    }

    setError(result.message);
    setSignInInstead(result.kind === "sign_in_failed");
  };

  return (
    <Screen
      title="Activate your account"
      subtitle="Enter the email address your administrator invited, the invitation code they gave you, and choose a password."
    >
      <Field
        autoComplete="email"
        autoCapitalize="none"
        keyboardType="email-address"
        label="Email"
        onChangeText={setEmail}
        placeholder="you@example.com"
        value={email}
        error={fieldErrors.email}
      />
      <Field
        autoCapitalize="characters"
        autoComplete="off"
        autoCorrect={false}
        label="Invitation code"
        onChangeText={setCode}
        placeholder="ABCD-EFGH-JKMN"
        value={code}
        error={fieldErrors.code}
      />
      <Field
        autoComplete="new-password"
        label="New password"
        onChangeText={setPassword}
        placeholder="At least 8 characters"
        secureTextEntry
        value={password}
        error={fieldErrors.password}
      />
      <Field
        autoComplete="new-password"
        label="Confirm password"
        onChangeText={setConfirmation}
        placeholder="Re-enter your password"
        secureTextEntry
        value={confirmation}
        error={fieldErrors.confirmation}
      />

      {error ? <Message tone="error">{error}</Message> : null}

      <PrimaryButton
        label="Activate account"
        loading={isActivating}
        onPress={() => void submit()}
      />
      <InlineLink
        label={signInInstead ? "Go to sign in" : "Back to sign in"}
        onPress={() => router.replace("/(auth)/login")}
      />
    </Screen>
  );
}
