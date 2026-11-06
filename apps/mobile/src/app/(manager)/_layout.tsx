import { Stack } from "expo-router";

import { RoleGate } from "@/components/RoleGate";

export default function ManagerLayout() {
  return (
    <RoleGate role="site_manager">
      <Stack screenOptions={{ headerShown: false }} />
    </RoleGate>
  );
}
