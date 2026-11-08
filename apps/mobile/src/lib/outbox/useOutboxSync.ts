// Sync triggers: when a collector is signed in (app start / sign-in), and
// whenever the app returns to the foreground. Saving a submission triggers
// a sync itself (saveSubmission), and screens can call syncNow().
// No network-status dependency: a run with no connection just leaves rows
// pending with a readable reason.

import { useEffect } from "react";
import { AppState } from "react-native";

import { syncNow } from "@/lib/outbox";
import { useAuthStore } from "@/stores/authStore";

export function useOutboxSync(): void {
  const collectorId = useAuthStore((state) =>
    state.profile?.role === "collector" && state.profile.is_active ? state.profile.id : null,
  );

  useEffect(() => {
    if (!collectorId) return;

    void syncNow();

    let previous = AppState.currentState;
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active" && previous !== "active") void syncNow();
      previous = next;
    });

    return () => subscription.remove();
  }, [collectorId]);
}
