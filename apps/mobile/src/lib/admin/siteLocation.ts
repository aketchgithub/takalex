// Site locations (migration 012): reading what the admin typed or pasted,
// showing it, and the messages. Pure TypeScript, tested by
// siteLocation.test.ts. admin_set_site_location() checks the same rules.

import { isNetworkError } from "../outbox/errors.ts";
import type { RemoteError } from "../outbox/types.ts";

export type Coordinates = { latitude: number; longitude: number };

export const LOCATION_HINT = "Latitude, longitude in decimal degrees, e.g. -1.2667, 36.8833";

// Two decimal numbers separated by a comma, semicolon or spaces, latitude
// first (the way Google Maps copies a dropped pin). Rounded to 6 decimals,
// as the database stores them.
export function parseCoordinates(input: string): Coordinates | { error: string } {
  const parts = input.trim().split(/\s*[,;]\s*|\s+/).filter(Boolean);
  if (parts.length === 0) return { error: "Enter the latitude and longitude." };
  const number = /^[+-]?(\d+(\.\d*)?|\.\d+)$/;
  if (parts.length !== 2 || !parts.every((part) => number.test(part))) {
    return { error: `Enter two numbers. ${LOCATION_HINT}.` };
  }
  const [latitude, longitude] = parts.map((part) => Math.round(Number(part) * 1e6) / 1e6);
  if (latitude < -90 || latitude > 90) return { error: "The latitude must be between -90 and 90." };
  if (longitude < -180 || longitude > 180) return { error: "The longitude must be between -180 and 180." };
  if (latitude === 0 && longitude === 0) return { error: "0, 0 is not a real site. Check the numbers." };
  return { latitude, longitude };
}

export function hasLocation(site: { latitude?: number | null; longitude?: number | null }): site is Coordinates {
  return typeof site.latitude === "number" && typeof site.longitude === "number";
}

// "-1.26670, 36.88333" (5 decimals, about 1 m, enough to read and compare).
export function formatCoordinates(c: Coordinates): string {
  return `${c.latitude.toFixed(5)}, ${c.longitude.toFixed(5)}`;
}

// Same point after rounding to what the database keeps.
export function sameCoordinates(a: Coordinates, b: Coordinates): boolean {
  const r = (x: number) => Math.round(x * 1e6);
  return r(a.latitude) === r(b.latitude) && r(a.longitude) === r(b.longitude);
}

// Opens the point in Google Maps (app or browser), to check it.
export function mapsUrl(c: Coordinates): string {
  return `https://www.google.com/maps/search/?api=1&query=${c.latitude},${c.longitude}`;
}

export const LOCATION_MESSAGES = {
  network: "Could not reach Takalex. Check your connection and try again.",
  notAdmin: "Only an active administrator can manage sites.",
  notFound: "This site no longer exists. Pull down to refresh.",
  invalid: "Check the latitude and longitude and try again.",
  other: "The location could not be saved. Try again.",
} as const;

export function locationWriteErrorMessage(error: RemoteError): string {
  if (isNetworkError(error)) return LOCATION_MESSAGES.network;
  switch (error.code) {
    case "42501":
      return LOCATION_MESSAGES.notAdmin;
    case "P0002":
      return LOCATION_MESSAGES.notFound;
    case "22023":
      return LOCATION_MESSAGES.invalid;
    default:
      return LOCATION_MESSAGES.other;
  }
}

export const REMOVE_LOCATION_CONFIRMATION =
  "The site will have no pin on the map until a location is set again. Its history keeps the old coordinates.";
