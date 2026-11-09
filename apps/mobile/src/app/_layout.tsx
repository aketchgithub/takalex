import { useEffect } from "react";
import { Platform } from "react-native";
import { Stack } from "expo-router";
import * as Sentry from "@sentry/react-native";

import { cleanupOutboxPhotos } from "@/lib/outbox";
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/stores/authStore";

Sentry.init({
  dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
});

export default function RootLayout() {
  const isHydrated = useAuthStore((state) => state.isHydrated);

  // Once per app start, whoever signs in: remove outbox photos that no row
  // references. Native only (the outbox is not used on web).
  useEffect(() => {
    if (Platform.OS !== "web") void cleanupOutboxPhotos();
  }, []);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    let active = true;
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) {
        return;
      }

      if (event === "TOKEN_REFRESHED" && session) {
        useAuthStore.getState().setSession(session);
        return;
      }

      setTimeout(() => {
        if (active) {
          void useAuthStore.getState().loadSession(session);
        }
      }, 0);
    });

    void useAuthStore.getState().initialize();

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [isHydrated]);

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(collector)" />
      <Stack.Screen name="(manager)" />
      <Stack.Screen name="(recycler)" />
      <Stack.Screen name="(admin)" />
    </Stack>
  );
}
