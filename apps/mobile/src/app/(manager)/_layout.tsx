import { Stack } from "expo-router";

import { RoleGate } from "@/components/RoleGate";
import { headerOptions } from "@/theme/headerOptions";
import { useColors } from "@/theme/useTheme";

// Stack over the tabs: a delivery opens on top of Pending or Reviewed and
// Back returns to the list it came from.
export default function ManagerLayout() {
  const c = useColors();
  return (
    <RoleGate role="site_manager">
      <Stack screenOptions={headerOptions(c)}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="delivery/[id]" options={{ title: "Delivery", headerBackTitle: "Back" }} />
      </Stack>
    </RoleGate>
  );
}
