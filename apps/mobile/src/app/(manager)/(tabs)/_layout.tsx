import { Tabs } from "expo-router";

import { renderTextTabBar } from "@/components/TextTabBar";

export default function ManagerTabsLayout() {
  return (
    <Tabs screenOptions={{ headerShown: false }} tabBar={renderTextTabBar}>
      <Tabs.Screen name="index" options={{ title: "Pending" }} />
      <Tabs.Screen name="reviewed" options={{ title: "Reviewed" }} />
    </Tabs>
  );
}
