import { Stack } from "expo-router";

import { RoleGate } from "@/components/RoleGate";
import { headerOptions } from "@/theme/headerOptions";
import { useColors } from "@/theme/useTheme";

// Stack over the tabs: Approve and invite opens on top of Access requests,
// Invite on top of Invitations, Materials on top of the overview, and Back
// returns to them.
export default function AdminLayout() {
  const c = useColors();
  return (
    <RoleGate role="admin">
      <Stack screenOptions={headerOptions(c)}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="approve/[id]" options={{ title: "Approve and invite", headerBackTitle: "Back" }} />
        <Stack.Screen name="invite" options={{ title: "Invite a team member", headerBackTitle: "Back" }} />
        <Stack.Screen name="materials" options={{ title: "Materials", headerBackTitle: "Back" }} />
      </Stack>
    </RoleGate>
  );
}
