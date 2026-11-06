import { Stack } from "expo-router";

import { RoleGate } from "@/components/RoleGate";

export default function RecyclerLayout() {
  return (
    <RoleGate role="recycler">
      <Stack screenOptions={{ headerShown: false }} />
    </RoleGate>
  );
}
