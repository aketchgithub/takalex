import { Tabs } from "expo-router";

import { renderTabBar, tabIcon } from "@/components/TabBar";

export default function ManagerTabsLayout() {
  return (
    <Tabs screenOptions={{ headerShown: false }} tabBar={renderTabBar}>
      <Tabs.Screen name="index" options={{ title: "Pending", tabBarIcon: tabIcon("inbox") }} />
      <Tabs.Screen name="reviewed" options={{ title: "Reviewed", tabBarIcon: tabIcon("check-circle") }} />
      <Tabs.Screen name="account" options={{ title: "Account", tabBarIcon: tabIcon("user") }} />
    </Tabs>
  );
}
