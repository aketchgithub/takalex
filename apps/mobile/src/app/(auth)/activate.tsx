import { useState } from "react";
import { router } from "expo-router";
import { z } from "zod";

import { AuthScreen } from "@/components/AuthScreen";
import { Field, Message, PrimaryButton } from "@/components/Ui";
import { SMS_PASSWORD_RESET } from "@/lib/features";
import { PASSWORDS_DO_NOT_MATCH, passwordRuleError } from "@/lib/passwordRules";
import { useAuthStore } from "@/stores/authStore";

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
    // Same rules as accept-invitation (the function enforces them again).
    const passwordError = passwordRuleError(password);
    if (passwordError) {
      errors.password = passwordError;
    }
    if (confirmation !== password) {
      errors.confirmation = PASSWORDS_DO_NOT_MATCH;
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
    <AuthScreen
      footer={{
        label: signInInstead ? "Go to sign in" : "Back to sign in",
        onPress: () => router.replace("/(auth)/login"),
      }}
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
        revealable
        value={password}
        error={fieldErrors.password}
      />
      <Field
        autoComplete="new-password"
        label="Confirm password"
        onChangeText={setConfirmation}
        placeholder="Re-enter your password"
        revealable
        value={confirmation}
        error={fieldErrors.confirmation}
      />

      <Message>
        {SMS_PASSWORD_RESET
          ? "After you sign in, add your phone number in your account so you can reset your password by SMS if you ever forget it."
          : "Use an email address you can open on this phone. You will need it if you ever forget your password."}
      </Message>
      {error ? <Message tone="error">{error}</Message> : null}

      <PrimaryButton
        label="Activate account"
        loading={isActivating}
        loadingLabel="Activating…"
        onPress={() => void submit()}
      />
    </AuthScreen>
  );
}
