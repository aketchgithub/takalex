import { Redirect, Stack } from "expo-router";

import { useAuthStore } from "@/stores/authStore";

export default function AuthLayout() {
  const isLoading = useAuthStore((state) => state.isLoading);
  const session = useAuthStore((state) => state.session);
  const isResettingPassword = useAuthStore((state) => state.isResettingPassword);

  // Any signed-in user leaves the sign-in screens: "/" either routes to the
  // user's home or shows why the account is unavailable (with sign-out).
  // Except during "Forgot password?": checking the code signs the user in,
  // and they stay on the reset screen until the new password is saved.
  if (!isLoading && session && !isResettingPassword) {
    return <Redirect href="/" />;
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}
