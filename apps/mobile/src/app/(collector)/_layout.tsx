import { Tabs } from "expo-router";

import { RoleGate } from "@/components/RoleGate";
import { renderTabBar, tabIcon } from "@/components/TabBar";
import { useOutboxSync } from "@/lib/outbox/useOutboxSync";

export default function CollectorLayout() {
  useOutboxSync();

  return (
    <RoleGate role="collector">
      <Tabs screenOptions={{ headerShown: false }} tabBar={renderTabBar}>
        <Tabs.Screen name="index" options={{ title: "Home", tabBarIcon: tabIcon("home") }} />
        <Tabs.Screen
          name="log"
          options={{ title: "Record", tabBarAccessibilityLabel: "Record a delivery", tabBarIcon: tabIcon("plus-circle") }}
        />
        <Tabs.Screen name="history" options={{ title: "History", tabBarIcon: tabIcon("clock") }} />
        <Tabs.Screen name="account" options={{ title: "Account", tabBarIcon: tabIcon("user") }} />
      </Tabs>
    </RoleGate>
  );
}
