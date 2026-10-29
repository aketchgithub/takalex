import { Redirect, Stack } from "expo-router";

import { useAuthStore } from "@/stores/authStore";

export default function AuthLayout() {
  const isLoading = useAuthStore((state) => state.isLoading);
  const session = useAuthStore((state) => state.session);
  const profile = useAuthStore((state) => state.profile);
  const invitationPending = useAuthStore((state) => state.invitationPending);
  const authError = useAuthStore((state) => state.authError);

  if (!isLoading && session && profile && !authError && !invitationPending) {
    return <Redirect href="/" />;
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}
