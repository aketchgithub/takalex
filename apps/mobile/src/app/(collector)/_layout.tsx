import { Redirect, Tabs } from "expo-router";

import { Screen, Message } from "@/components/Ui";
import { useAuthStore } from "@/stores/authStore";

export default function CollectorLayout() {
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
  if (authError || profile?.role !== "collector") {
    return <Redirect href="/" />;
  }

  return (
    <Tabs screenOptions={{ headerShown: true }}>
      <Tabs.Screen name="index" options={{ title: "Dashboard" }} />
      <Tabs.Screen name="log" options={{ title: "Log waste" }} />
      <Tabs.Screen name="history" options={{ title: "History" }} />
    </Tabs>
  );
}
