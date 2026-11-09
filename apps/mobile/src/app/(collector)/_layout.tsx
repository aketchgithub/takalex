import { Tabs } from "expo-router";

import { RoleGate } from "@/components/RoleGate";
import { useOutboxSync } from "@/lib/outbox/useOutboxSync";

export default function CollectorLayout() {
  useOutboxSync();

  return (
    <RoleGate role="collector">
      <Tabs screenOptions={{ headerShown: true }}>
        <Tabs.Screen name="index" options={{ title: "Home" }} />
        <Tabs.Screen name="log" options={{ title: "New delivery" }} />
        <Tabs.Screen name="history" options={{ title: "History" }} />
      </Tabs>
    </RoleGate>
  );
}
