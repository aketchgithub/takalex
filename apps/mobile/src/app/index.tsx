import { Redirect, router } from "expo-router";

import { InlineLink, Message, PrimaryButton, Screen } from "@/components/Ui";
import { useAuthStore } from "@/stores/authStore";

function LoadingScreen() {
  return (
    <Screen title="Loading your account" subtitle="Checking your secure session.">
      <Message>Please wait while Takalex verifies your account.</Message>
    </Screen>
  );
}

export default function IndexRoute() {
  const isLoading = useAuthStore((state) => state.isLoading);
  const session = useAuthStore((state) => state.session);
  const profile = useAuthStore((state) => state.profile);
  const invitationPending = useAuthStore((state) => state.invitationPending);
  const authError = useAuthStore((state) => state.authError);
  const signOut = useAuthStore((state) => state.signOut);

  if (isLoading) {
    return <LoadingScreen />;
  }

  if (session && authError && !profile) {
    return (
      <Screen title="Account unavailable">
        <Message tone="error">
          {authError ?? "Your profile could not be loaded."}
        </Message>
        <PrimaryButton label="Sign out" onPress={() => void signOut()} />
      </Screen>
    );
  }

  if (session && invitationPending) {
    return <Redirect href="/(auth)/register" />;
  }

  if (session && profile) {
    if (profile.role === "admin") {
      return <Redirect href="/(admin)" />;
    }
    if (profile.role === "collector") {
      return <Redirect href="/(collector)" />;
    }
  }

  return (
    <Screen
      title="Public discovery, invite-only action"
      subtitle="Takalex helps communities and field teams manage verified collection work with clear onboarding and admin review."
    >
      <Message>
        Anyone can learn about the platform, but collection, admin, and operational workflows are only available after approval and invitation.
      </Message>
      <PrimaryButton label="Request access" onPress={() => router.push("/request-access" as any)} />
      <PrimaryButton label="How it works" onPress={() => router.push("/how-it-works" as any)} />
      <PrimaryButton label="About Takalex" onPress={() => router.push("/about" as any)} />
      <PrimaryButton label="View sites" onPress={() => router.push("/sites" as any)} />
      <PrimaryButton label="Sign in" onPress={() => router.push("/(auth)/login" as any)} />
      <InlineLink label="Join the waitlist" onPress={() => router.push("/waitlist" as any)} />
    </Screen>
  );
}
