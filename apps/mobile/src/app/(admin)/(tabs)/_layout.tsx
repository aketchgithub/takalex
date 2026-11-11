import { Tabs } from "expo-router";

export default function AdminTabsLayout() {
  return (
    <Tabs screenOptions={{ headerShown: true }}>
      <Tabs.Screen name="index" options={{ title: "Overview" }} />
      <Tabs.Screen name="access-requests" options={{ title: "Access" }} />
      <Tabs.Screen name="invitations" options={{ title: "Invitations" }} />
      <Tabs.Screen name="sites" options={{ title: "Sites" }} />
      <Tabs.Screen name="invite" options={{ title: "Invite" }} />
    </Tabs>
  );
}
