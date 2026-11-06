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
  const authError = useAuthStore((state) => state.authError);
  const signOut = useAuthStore((state) => state.signOut);

  if (isLoading) {
    return <LoadingScreen />;
  }

  if (session) {
    // Missing, unreadable or inactive profile: a clear message and sign-out
    // only. The role layouts (RoleGate) apply the same rule, so an inactive
    // user cannot reach any role screen.
    if (authError || !profile || !profile.is_active) {
      return (
        <Screen title="Account unavailable">
          <Message tone="error">
            {authError ?? "Your account is inactive. Ask an administrator for help."}
          </Message>
          <PrimaryButton label="Sign out" onPress={() => void signOut()} />
        </Screen>
      );
    }

    switch (profile.role) {
      case "admin":
        return <Redirect href="/(admin)" />;
      case "collector":
        return <Redirect href="/(collector)" />;
      case "site_manager":
        return <Redirect href="/(manager)" />;
      case "recycler":
        return <Redirect href="/(recycler)" />;
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
