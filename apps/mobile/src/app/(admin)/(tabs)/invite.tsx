import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";

import { InvitationCodeCard, type IssuedInvitation } from "@/components/InvitationCodeCard";
import { InviteForm } from "@/components/InviteForm";
import { Screen } from "@/components/Ui";
import { useAuthStore } from "@/stores/authStore";

export default function InviteUserScreen() {
  const [issued, setIssued] = useState<IssuedInvitation | null>(null);
  // Bumped after each invitation so the form starts empty again.
  const [formKey, setFormKey] = useState(0);
  const inviteUser = useAuthStore((state) => state.inviteUser);
  const isInviting = useAuthStore((state) => state.isInviting);

  // Leaving the tab or screen drops the code from memory.
  useFocusEffect(
    useCallback(() => {
      return () => setIssued(null);
    }, []),
  );

  if (issued) {
    return <InvitationCodeCard issued={issued} onDone={() => setIssued(null)} />;
  }

  return (
    <Screen
      title="Invite a team member"
      subtitle="Choose the person's role and sites. You will get a one-time code to pass on to them."
    >
      <InviteForm
        key={formKey}
        submitLabel="Create invitation"
        loading={isInviting}
        onSubmit={async (values) => {
          const result = await inviteUser(values.email, values.fullName, values.role, values.siteIds);
          if (!result.ok) return result.message;
          setIssued({ code: result.code, email: values.email, role: values.role, expiresAt: result.expiresAt });
          setFormKey((k) => k + 1);
          return null;
        }}
      />
    </Screen>
  );
}
