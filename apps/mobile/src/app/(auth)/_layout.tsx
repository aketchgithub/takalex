import { Redirect, Stack } from "expo-router";

import { useAuthStore } from "@/stores/authStore";

export default function AuthLayout() {
  const isLoading = useAuthStore((state) => state.isLoading);
  const session = useAuthStore((state) => state.session);

  // Any signed-in user leaves the sign-in screens: "/" either routes to the
  // user's home or shows why the account is unavailable (with sign-out).
  if (!isLoading && session) {
    return <Redirect href="/" />;
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}
