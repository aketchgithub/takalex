import { Tabs } from "expo-router";

import { RoleGate } from "@/components/RoleGate";

export default function ManagerLayout() {
  return (
    <RoleGate role="site_manager">
      <Tabs screenOptions={{ headerShown: true }}>
        <Tabs.Screen name="index" options={{ title: "Pending" }} />
        <Tabs.Screen name="reviewed" options={{ title: "Reviewed" }} />
        {/* Opened from either list; not a tab of its own. */}
        <Tabs.Screen name="delivery/[id]" options={{ title: "Delivery", href: null }} />
      </Tabs>
    </RoleGate>
  );
}
