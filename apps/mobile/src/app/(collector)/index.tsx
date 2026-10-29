import { router } from "expo-router";

import { InlineLink, Message, PrimaryButton, Screen } from "@/components/Ui";
import { useAuthStore } from "@/stores/authStore";

export default function CollectorDashboard() {
  const profile = useAuthStore((state) => state.profile);
  const signOut = useAuthStore((state) => state.signOut);

  return (
    <Screen
      title={`Hello${profile?.full_name ? `, ${profile.full_name}` : ""}`}
      subtitle="Your collector workspace is ready."
    >
      <Message>
        Your collections, activity log, and history will appear in this workspace.
      </Message>
      <PrimaryButton
        label="Log a collection"
        onPress={() => router.push("/(collector)/log")}
      />
      <InlineLink label="Sign out" onPress={() => void signOut()} />
    </Screen>
  );
}
