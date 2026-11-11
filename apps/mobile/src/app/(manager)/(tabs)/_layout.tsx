import { Tabs } from "expo-router";

export default function ManagerTabsLayout() {
  return (
    <Tabs screenOptions={{ headerShown: true }}>
      <Tabs.Screen name="index" options={{ title: "Pending" }} />
      <Tabs.Screen name="reviewed" options={{ title: "Reviewed" }} />
    </Tabs>
  );
}
