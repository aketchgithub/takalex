import { Tabs } from "expo-router";

import { renderTabBar, tabIcon } from "@/components/TabBar";

// Five tabs; "Invite a team member" opens from Invitations
// (app/(admin)/invite.tsx, on the stack above the tabs).
export default function AdminTabsLayout() {
  return (
    <Tabs screenOptions={{ headerShown: false }} tabBar={renderTabBar}>
      <Tabs.Screen name="index" options={{ title: "Overview", tabBarIcon: tabIcon("grid") }} />
      <Tabs.Screen
        name="access-requests"
        options={{ title: "Access", tabBarAccessibilityLabel: "Access requests", tabBarIcon: tabIcon("user-check") }}
      />
      <Tabs.Screen name="invitations" options={{ title: "Invitations", tabBarIcon: tabIcon("mail") }} />
      <Tabs.Screen name="sites" options={{ title: "Sites", tabBarIcon: tabIcon("map-pin") }} />
      <Tabs.Screen name="account" options={{ title: "Account", tabBarIcon: tabIcon("user") }} />
    </Tabs>
  );
}
