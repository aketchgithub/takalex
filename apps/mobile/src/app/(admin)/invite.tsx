import { useCallback, useState } from "react";
import { router, useFocusEffect } from "expo-router";

import { InvitationCodeCard, type IssuedInvitation } from "@/components/InvitationCodeCard";
import { InviteForm } from "@/components/InviteForm";
import { Screen } from "@/components/Ui";
import { useAuthStore } from "@/stores/authStore";

// Opened from Invitations, on the stack above the admin tabs.
// Done returns there (the Invitations list reloads when it comes back).
function goBack() {
  if (router.canGoBack()) router.back();
  else router.replace("/(admin)/(tabs)/invitations");
}

export default function InviteUserScreen() {
  const [issued, setIssued] = useState<IssuedInvitation | null>(null);
  const inviteUser = useAuthStore((state) => state.inviteUser);
  const isInviting = useAuthStore((state) => state.isInviting);

  // Leaving the screen drops the code from memory.
  useFocusEffect(
    useCallback(() => {
      return () => setIssued(null);
    }, []),
  );

  if (issued) {
    return <InvitationCodeCard brand={false} issued={issued} onDone={goBack} />;
  }

  return (
    <Screen
      align="top"
      brand={false}
      subtitle="Choose the person's role and sites. You will get a one-time code to pass on to them."
    >
      <InviteForm
        submitLabel="Create invitation"
        loading={isInviting}
        onSubmit={async (values) => {
          const result = await inviteUser(values.email, values.fullName, values.role, values.siteIds);
          if (!result.ok) return result.message;
          setIssued({ code: result.code, email: values.email, role: values.role, expiresAt: result.expiresAt });
          return null;
        }}
      />
    </Screen>
  );
}
