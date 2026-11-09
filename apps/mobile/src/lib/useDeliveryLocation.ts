// Device location for a delivery (untrusted metadata, optional). Asked for
// when the new-delivery screen first opens: the permission prompt appears
// only while the permission is undetermined. The position fix is limited to 10 seconds; if permission is
// denied, location is off, or the fix is too slow, the delivery is saved
// without a location and the screen says so.

import * as Location from "expo-location";
import { useCallback, useEffect, useRef, useState } from "react";

import type { DeviceLocation } from "@/lib/outbox";

export const LOCATION_TIMEOUT_MS = 10_000;

export type LocationState =
  | { status: "locating" }
  | { status: "ready"; location: DeviceLocation }
  | { status: "unavailable"; reason: "denied" | "timeout" | "error" };

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
        return "Location permission was not given. Deliveries will be saved without a location.";
      }
      if (state.reason === "timeout") {
        return "Location took longer than 10 seconds. This delivery will be saved without a location.";
      }
      return "Location is not available (it may be turned off). This delivery will be saved without a location.";
  }
}

async function acquire(): Promise<LocationState> {
  try {
    // Prompt only while undetermined (first use). After a refusal the
    // collector is not asked again; they can allow it in Settings.
    let permission = await Location.getForegroundPermissionsAsync();
    if (permission.status === Location.PermissionStatus.UNDETERMINED) {
      permission = await Location.requestForegroundPermissionsAsync();
    }
    if (permission.status !== Location.PermissionStatus.GRANTED) {
      return { status: "unavailable", reason: "denied" };
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
// refresh(): starts a new attempt (used after each saved delivery).
export function useDeliveryLocation(): {
  state: LocationState;
  waitForLocation: () => Promise<DeviceLocation | null>;
  refresh: () => void;
} {
  const [state, setState] = useState<LocationState>({ status: "locating" });
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

  const waitForLocation = useCallback(async () => {
    const result = await (attempt.current ?? Promise.resolve<LocationState>({ status: "locating" }));
    return result.status === "ready" ? result.location : null;
  }, []);

  return { state, waitForLocation, refresh };
}
