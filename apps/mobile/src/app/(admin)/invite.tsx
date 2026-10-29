import { useState } from "react";
import { z } from "zod";

import {
  Field,
  Message,
  PrimaryButton,
  Screen,
} from "@/components/Ui";
import { useAuthStore } from "@/stores/authStore";

const emailSchema = z.string().trim().email("Enter a valid email address.");
const nameSchema = z.string().trim().max(120, "Name must be 120 characters or fewer.");

export default function InviteCollectorScreen() {
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const inviteCollector = useAuthStore((state) => state.inviteCollector);
  const isInviting = useAuthStore((state) => state.isInviting);
  const authError = useAuthStore((state) => state.authError);
  const statusMessage = useAuthStore((state) => state.statusMessage);
  const setAuthError = useAuthStore((state) => state.setAuthError);

  const submit = async () => {
    const emailResult = emailSchema.safeParse(email);
    const nameResult = nameSchema.safeParse(fullName);
    if (!emailResult.success) {
      setValidationError(emailResult.error.issues[0]?.message ?? "Enter a valid email address.");
      return;
    }
    if (!nameResult.success) {
      setValidationError(nameResult.error.issues[0]?.message ?? "Enter a valid name.");
      return;
    }

    setValidationError(null);
    setAuthError(null);
    await inviteCollector(emailResult.data, nameResult.data);
    if (!useAuthStore.getState().authError) {
      setEmail("");
      setFullName("");
    }
  };

  return (
    <Screen
      title="Invite a collector"
      subtitle="The invitation creates a collector account. Role assignment is not exposed to the invited user."
    >
      <Field
        autoCapitalize="words"
        label="Full name"
        onChangeText={setFullName}
        placeholder="Collector name"
        value={fullName}
      />
      <Field
        autoComplete="email"
        keyboardType="email-address"
        label="Email"
        onChangeText={setEmail}
        placeholder="collector@example.com"
        value={email}
      />
      {validationError ? <Message tone="error">{validationError}</Message> : null}
      {authError ? <Message tone="error">{authError}</Message> : null}
      {statusMessage ? <Message>{statusMessage}</Message> : null}
      <PrimaryButton
        label="Send invitation"
        loading={isInviting}
        onPress={() => void submit()}
      />
    </Screen>
  );
}
