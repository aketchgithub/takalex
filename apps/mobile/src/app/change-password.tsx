import { useState } from "react";
import { Redirect, router } from "expo-router";

import { Field, Message, PrimaryButton, Screen } from "@/components/Ui";
import {
  PASSWORD_CHANGED_MESSAGE,
  validatePasswordChange,
  type PasswordChangeFieldErrors,
} from "@/lib/passwordRules";
import { useAuthStore } from "@/stores/authStore";

// Back to the role home this screen was opened from. This route is outside
// the role groups, so "/" (the fallback) is app/index.tsx, which routes a
// signed-in user to the correct home.
function goBack() {
  if (router.canGoBack()) {
    router.back();
  } else {
    router.replace("/");
  }
}

// For every signed-in role, so it lives outside the role groups and does its
// own signed-in check (the same conditions as RoleGate, without the role).
export default function ChangePasswordScreen() {
  const isLoading = useAuthStore((state) => state.isLoading);
  const session = useAuthStore((state) => state.session);
  const profile = useAuthStore((state) => state.profile);
  const authError = useAuthStore((state) => state.authError);
  const changePassword = useAuthStore((state) => state.changePassword);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [fieldErrors, setFieldErrors] = useState<PasswordChangeFieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [done, setDone] = useState(false);

  if (isLoading) {
    return (
      <Screen title="Loading your account">
        <Message>Please wait while Takalex verifies your account.</Message>
      </Screen>
    );
  }
  // Not signed in (or the account is unavailable): the sign-in screen. A
  // signed-in user is sent on from there to app/index.tsx, which explains.
  if (!session || authError || !profile || !profile.is_active) {
    return <Redirect href="/(auth)/login" />;
  }

  const submit = async () => {
    const errors = validatePasswordChange({ currentPassword, newPassword, confirmation });
    setFieldErrors(errors);
    setError(null);
    if (Object.keys(errors).length > 0) {
      return;
    }

    setIsSaving(true);
    try {
      const result = await changePassword(currentPassword, newPassword);
      if (result.ok) {
        setCurrentPassword("");
        setNewPassword("");
        setConfirmation("");
        setDone(true);
        return;
      }
      if (result.kind === "wrong_current") {
        setFieldErrors({ currentPassword: result.message });
      } else if (result.kind === "weak" || result.kind === "same") {
        setFieldErrors({ newPassword: result.message });
      } else {
        setError(result.message);
      }
    } finally {
      setIsSaving(false);
    }
  };

  if (done) {
    return (
      <Screen align="top" title="Change password">
        <Message tone="success">{PASSWORD_CHANGED_MESSAGE}</Message>
        <PrimaryButton label="Done" onPress={goBack} />
      </Screen>
    );
  }

  return (
    <Screen
      align="top"
      topLink={{ label: "‹ Back", onPress: goBack }}
      title="Change password"
      subtitle="Enter your current password, then choose a new one."
    >
      <Field
        autoComplete="current-password"
        label="Current password"
        onChangeText={setCurrentPassword}
        revealable
        value={currentPassword}
        error={fieldErrors.currentPassword}
      />
      <Field
        autoComplete="new-password"
        label="New password"
        onChangeText={setNewPassword}
        placeholder="At least 8 characters"
        revealable
        value={newPassword}
        error={fieldErrors.newPassword}
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

      <PrimaryButton label="Change password" loading={isSaving} loadingLabel="Changing password…" onPress={() => void submit()} />
    </Screen>
  );
}
