// The phone's current position, for "Use my current location" when an admin
// stands at a site. Asks for location permission whenever Android still
// allows it (lib/locationPermission.ts), waits up to 20 seconds for a precise
// fix, and never invents a position: on any problem it returns a message.

import * as Location from "expo-location";

import { permissionOutcome, shouldRequestPermission } from "@/lib/locationPermission";

const FIX_TIMEOUT_MS = 20_000;

export type PositionResult =
  | { ok: true; latitude: number; longitude: number; accuracyM: number | null }
  | { ok: false; message: string };

export async function currentPosition(): Promise<PositionResult> {
  try {
    let permission = await Location.getForegroundPermissionsAsync();
    if (shouldRequestPermission(permission)) permission = await Location.requestForegroundPermissionsAsync();
    const outcome = permissionOutcome(permission);
    if (outcome === "blocked") {
      return { ok: false, message: "Location is blocked for this app. Allow it in phone Settings, then try again." };
    }
    if (outcome !== "granted") return { ok: false, message: "Location permission was not given." };
  } catch {
    return { ok: false, message: "Location is not available (it may be turned off)." };
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<PositionResult>((resolve) => {
    timer = setTimeout(
      () => resolve({ ok: false, message: "No position after 20 seconds. Go outside or near a window and try again." }),
      FIX_TIMEOUT_MS,
    );
  });
  const fix = Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High })
    .then(
      (position): PositionResult => ({
        ok: true,
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracyM: position.coords.accuracy,
      }),
    )
    .catch((): PositionResult => ({ ok: false, message: "Location is not available (it may be turned off)." }));
  try {
    return await Promise.race([fix, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
