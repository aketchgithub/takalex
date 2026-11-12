// Sync triggers: when a collector is signed in (app start / sign-in),
// whenever the app returns to the foreground, and every 30 seconds while the
// app is open with a delivery waiting (so it uploads when the network comes
// back without the collector doing anything). Saving a submission triggers
// a sync itself (saveSubmission), and screens can call syncNow().
// No network-status dependency: a run with no connection just leaves rows
// pending with a readable reason.

import { useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

import { syncNow } from "@/lib/outbox";
import {
  AUTO_RETRY_INTERVAL_MS,
  countRetryable,
  shouldAutoRetry,
  shouldStartTick,
} from "@/lib/outbox/autoRetry";
import { useWaitingDeliveries } from "@/lib/outbox/useWaitingDeliveries";
import { useAuthStore } from "@/stores/authStore";

export function useOutboxSync(): void {
  const collectorId = useAuthStore((state) =>
    state.profile?.role === "collector" && state.profile.is_active ? state.profile.id : null,
  );
  // currentState can be unknown for a moment at start; the hook only mounts
  // while the app is on screen, so treat that as the foreground.
  const [appState, setAppState] = useState<string>(AppState.currentState ?? "active");

  useEffect(() => {
    if (!collectorId) return;

    void syncNow();

    let previous = AppState.currentState;
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active" && previous !== "active") void syncNow();
      previous = next;
      setAppState(next);
    });

    return () => subscription.remove();
  }, [collectorId]);

  // Re-read after every outbox change, so the timer stops as soon as the
  // last waiting delivery has uploaded.
  const waiting = useWaitingDeliveries();
  const autoRetry = shouldAutoRetry({
    collectorId,
    appState,
    retryableCount: countRetryable(waiting.rows),
  });

  const tickInFlight = useRef(false);
  useEffect(() => {
    if (!autoRetry) return;

    const timer = setInterval(() => {
      if (!shouldStartTick({ enabled: true, tickInFlight: tickInFlight.current })) return;
      tickInFlight.current = true;
      // syncNow never rejects, and its runs never overlap (singleFlight).
      void syncNow().finally(() => {
        tickInFlight.current = false;
      });
    }, AUTO_RETRY_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [autoRetry]);
}
