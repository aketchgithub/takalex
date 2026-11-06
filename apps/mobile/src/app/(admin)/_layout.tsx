import { Tabs } from "expo-router";

import { RoleGate } from "@/components/RoleGate";

export default function AdminLayout() {
  return (
    <RoleGate role="admin">
      <Tabs screenOptions={{ headerShown: true }}>
        <Tabs.Screen name="index" options={{ title: "Overview" }} />
        <Tabs.Screen name="access-requests" options={{ title: "Access" }} />
        <Tabs.Screen name="sites" options={{ title: "Sites" }} />
        <Tabs.Screen name="groups" options={{ title: "Groups" }} />
        <Tabs.Screen name="invite" options={{ title: "Invite" }} />
      </Tabs>
    </RoleGate>
  );
}
