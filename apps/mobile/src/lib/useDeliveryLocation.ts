// Device location for a delivery (untrusted metadata, optional). Asked for
// when the new-delivery screen first opens; the permission prompt appears
// whenever the system still allows it (lib/locationPermission.ts). The
// position fix is limited to 10 seconds; if permission is refused, location
// is off, or the fix is too slow, the delivery is saved without a location
// and the screen says so. A failed attempt is retried when the app comes
// back to the foreground (for example after changing phone Settings) and
// from the screen's "Try again" link.

import * as Location from "expo-location";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

import { permissionOutcome, shouldRequestPermission } from "@/lib/locationPermission";
import type { DeviceLocation } from "@/lib/outbox";

export const LOCATION_TIMEOUT_MS = 10_000;

export type LocationState =
  | { status: "locating" }
  | { status: "ready"; location: DeviceLocation }
  | { status: "unavailable"; reason: "denied" | "blocked" | "timeout" | "error" };

export function locationMessage(state: LocationState): string {
  switch (state.status) {
    case "locating":
      return "Getting your location…";
    case "ready":
      return state.location.accuracy !== null
        ? `Location attached (accurate to about ${Math.round(state.location.accuracy)} m).`
        : "Location attached.";
    case "unavailable":
      if (state.reason === "denied") {
        return "Location permission was not given. Tap Try again to allow it, or deliveries will be saved without a location.";
      }
      if (state.reason === "blocked") {
        return "Location is blocked for this app. Allow it in phone Settings, or deliveries will be saved without a location.";
      }
      if (state.reason === "timeout") {
        return "Location took longer than 10 seconds. This delivery will be saved without a location.";
      }
      return "Location is not available (it may be turned off). This delivery will be saved without a location.";
  }
}

async function acquire(): Promise<LocationState> {
  try {
    let permission = await Location.getForegroundPermissionsAsync();
    if (shouldRequestPermission(permission)) {
      permission = await Location.requestForegroundPermissionsAsync();
    }
    const outcome = permissionOutcome(permission);
    if (outcome !== "granted") {
      return { status: "unavailable", reason: outcome };
    }
  } catch {
    return { status: "unavailable", reason: "error" };
  }

  // The timeout covers the fix only, not the time spent answering the prompt.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<LocationState>((resolve) => {
    timer = setTimeout(() => resolve({ status: "unavailable", reason: "timeout" }), LOCATION_TIMEOUT_MS);
  });
  const fix = Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
    .then(
      (position): LocationState => ({
        status: "ready",
        location: {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
        },
      }),
    )
    .catch((): LocationState => ({ status: "unavailable", reason: "error" }));

  try {
    return await Promise.race([fix, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

// state: for display. waitForLocation(): resolves when the current attempt
// finishes (at most 10 s after permission), with the location or null.
// refresh(): starts a new attempt (after each saved delivery, and "Try again").
export function useDeliveryLocation(): {
  state: LocationState;
  waitForLocation: () => Promise<DeviceLocation | null>;
  refresh: () => void;
} {
  const [state, setState] = useState<LocationState>({ status: "locating" });
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  const attempt = useRef<Promise<LocationState> | null>(null);
  const mounted = useRef(true);

  const start = useCallback(() => {
    const current = acquire();
    attempt.current = current;
    void current.then((result) => {
      if (mounted.current && attempt.current === current) setState(result);
    });
  }, []);

  const refresh = useCallback(() => {
    setState({ status: "locating" });
    start();
  }, [start]);

  // First attempt when the screen opens (state starts as "locating").
  useEffect(() => {
    mounted.current = true;
    start();
    return () => {
      mounted.current = false;
    };
  }, [start]);

  // Back from phone Settings (or any other app): retry a failed attempt.
  // Only after "background": a permission prompt can briefly make the app
  // "inactive", and retrying then would show the prompt again straight away.
  useEffect(() => {
    let previous = AppState.currentState;
    const subscription = AppState.addEventListener("change", (next) => {
      const cameBack = previous === "background" && next === "active";
      previous = next;
      if (cameBack && stateRef.current.status === "unavailable") refresh();
    });
    return () => subscription.remove();
  }, [refresh]);

  const waitForLocation = useCallback(async () => {
    const result = await (attempt.current ?? Promise.resolve<LocationState>({ status: "locating" }));
    return result.status === "ready" ? result.location : null;
  }, []);

  return { state, waitForLocation, refresh };
}
