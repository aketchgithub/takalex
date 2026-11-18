import { Tabs } from "expo-router";

import { RoleGate } from "@/components/RoleGate";
import { renderTabBar, tabIcon } from "@/components/TabBar";

export default function RecyclerLayout() {
  return (
    <RoleGate role="recycler">
      <Tabs screenOptions={{ headerShown: false }} tabBar={renderTabBar}>
        <Tabs.Screen name="index" options={{ title: "Home", tabBarIcon: tabIcon("home") }} />
        <Tabs.Screen name="account" options={{ title: "Account", tabBarIcon: tabIcon("user") }} />
      </Tabs>
    </RoleGate>
  );
}
