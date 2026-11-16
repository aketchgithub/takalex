import { Stack } from "expo-router";

import { RoleGate } from "@/components/RoleGate";

// Stack over the tabs: Approve and invite opens on top of Access requests and
// Back returns to it.
export default function AdminLayout() {
  return (
    <RoleGate role="admin">
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="approve/[id]" options={{ title: "Approve and invite", headerBackTitle: "Back" }} />
      </Stack>
    </RoleGate>
  );
}
