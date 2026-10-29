import { Redirect, Tabs } from "expo-router";

import { Message, Screen } from "@/components/Ui";
import { useAuthStore } from "@/stores/authStore";

export default function AdminLayout() {
  const isLoading = useAuthStore((state) => state.isLoading);
  const session = useAuthStore((state) => state.session);
  const profile = useAuthStore((state) => state.profile);
  const authError = useAuthStore((state) => state.authError);

  if (isLoading) {
    return (
      <Screen title="Loading your account">
        <Message>Please wait while Takalex verifies your account.</Message>
      </Screen>
    );
  }
  if (!session) {
    return <Redirect href="/(auth)/login" />;
  }
  if (authError || profile?.role !== "admin") {
    return <Redirect href="/" />;
  }

  return (
    <Tabs screenOptions={{ headerShown: true }}>
      <Tabs.Screen name="index" options={{ title: "Overview" }} />
      <Tabs.Screen name="access-requests" options={{ title: "Access" }} />
      <Tabs.Screen name="sites" options={{ title: "Sites" }} />
      <Tabs.Screen name="groups" options={{ title: "Groups" }} />
      <Tabs.Screen name="invite" options={{ title: "Invite" }} />
    </Tabs>
  );
}
