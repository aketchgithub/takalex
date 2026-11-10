import { Tabs } from "expo-router";

import { RoleGate } from "@/components/RoleGate";

export default function AdminLayout() {
  return (
    <RoleGate role="admin">
      <Tabs screenOptions={{ headerShown: true }}>
        <Tabs.Screen name="index" options={{ title: "Overview" }} />
        <Tabs.Screen name="access-requests" options={{ title: "Access" }} />
        <Tabs.Screen name="invitations" options={{ title: "Invitations" }} />
        <Tabs.Screen name="sites" options={{ title: "Sites" }} />
        <Tabs.Screen name="invite" options={{ title: "Invite" }} />
        {/* Opened from Access requests; not a tab of its own. */}
        <Tabs.Screen name="approve/[id]" options={{ title: "Approve and invite", href: null }} />
      </Tabs>
    </RoleGate>
  );
}
