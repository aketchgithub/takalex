import { useEffect } from "react";
import { AppState, Platform } from "react-native";
import { Stack } from "expo-router";
import * as Sentry from "@sentry/react-native";

import { cleanupOutboxPhotos } from "@/lib/outbox";
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/stores/authStore";

const PROFILE_RETRY_MS = 30_000;

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

  // While the profile could not be checked (offline), re-check it when the
  // app returns to the foreground and every 30 s while it is in use.
  const offline = useAuthStore((state) => state.offline);
  useEffect(() => {
    if (!offline) return;
    const retry = () => void useAuthStore.getState().refreshProfile();
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active") retry();
    });
    const timer = setInterval(() => {
      if (AppState.currentState === "active") retry();
    }, PROFILE_RETRY_MS);
    return () => {
      subscription.remove();
      clearInterval(timer);
    };
  }, [offline]);

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

      // Startup is handled by initialize() below, which reads the same
      // session. Offline with an expired token, INITIAL_SESSION carries
      // null although supabase-js kept the session, and must not sign the
      // store out.
      if (event === "INITIAL_SESSION") {
        return;
      }

      if (event === "TOKEN_REFRESHED" && session) {
        useAuthStore.getState().setSession(session);
        // A successful refresh means the server is reachable again.
        if (useAuthStore.getState().offline) {
          void useAuthStore.getState().refreshProfile();
        }
        return;
      }

      setTimeout(() => {
        if (!active) {
          return;
        }

        // The same user, already loaded, signed in again or was updated
        // (change password re-authenticates, then updates the user): keep
        // the screens mounted and re-check the profile in the background
        // instead of showing the loading screen.
        const current = useAuthStore.getState();
        if (
          session &&
          (event === "SIGNED_IN" || event === "USER_UPDATED") &&
          current.session?.user.id === session.user.id &&
          current.profile &&
          !current.authError &&
          !current.isLoading
        ) {
          current.setSession(session);
          void current.refreshProfile();
          return;
        }

        void useAuthStore.getState().loadSession(session);
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
