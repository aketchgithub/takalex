import { router } from "expo-router";

import { InlineLink, Message, PrimaryButton, Screen } from "@/components/Ui";
import { useAuthStore } from "@/stores/authStore";

export default function AdminOverview() {
  const profile = useAuthStore((state) => state.profile);
  const signOut = useAuthStore((state) => state.signOut);

  return (
    <Screen
      title="Admin overview"
      subtitle={`Signed in${profile?.full_name ? ` as ${profile.full_name}` : ""}.`}
    >
      <Message>
        Manage the Nairobi sites, SME groups, and collector invitations from this
        workspace.
      </Message>
      <PrimaryButton
        label="Review access requests"
        onPress={() => router.push("/(admin)/access-requests" as any)}
      />
      <PrimaryButton
        label="Invite a collector"
        onPress={() => router.push("/(admin)/invite" as any)}
      />
      <InlineLink label="Sign out" onPress={() => void signOut()} />
    </Screen>
  );
}
