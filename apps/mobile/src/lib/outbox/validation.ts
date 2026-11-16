// Input normalisation for outbox rows. Pure TypeScript.
// These mirror the database CHECKs on collection_logs, so a row that would
// be permanently rejected is refused before it is saved.

// NUMERIC(10,2), > 0: at most 8 integer digits and 2 decimals.
const WEIGHT_PATTERN = /^(\d{1,8})(?:[.,](\d{1,2}))?$/;

// Returns the weight as a two-decimal string ("12.5" -> "12.50"), or null if
// it is not a positive number with at most two decimals.
export function normalizeReportedWeight(input: string): string | null {
  const match = WEIGHT_PATTERN.exec(input.trim());
  if (!match) return null;
  const whole = match[1].replace(/^0+(?=\d)/, "");
  const fraction = (match[2] ?? "").padEnd(2, "0");
  if (/^0+$/.test(whole) && /^0+$/.test(fraction)) return null;
  return `${whole}.${fraction}`;
}

export type DeviceLocation = {
  latitude: number;
  longitude: number;
  accuracy: number | null;
};

export type NormalizedLocation = {
  deviceLatitude: number | null;
  deviceLongitude: number | null;
  deviceAccuracyM: number | null;
};

// Coordinates are kept only as a valid pair; accuracy only with coordinates
// and only when finite and >= 0 (collection_device_* constraints).
export function normalizeLocation(location: DeviceLocation | null): NormalizedLocation {
  if (
    !location ||
    !Number.isFinite(location.latitude) ||
    !Number.isFinite(location.longitude) ||
    location.latitude < -90 ||
    location.latitude > 90 ||
    location.longitude < -180 ||
    location.longitude > 180
  ) {
    return { deviceLatitude: null, deviceLongitude: null, deviceAccuracyM: null };
  }
  const accuracy =
    location.accuracy !== null && Number.isFinite(location.accuracy) && location.accuracy >= 0
      ? location.accuracy
      : null;
  return {
    deviceLatitude: location.latitude,
    deviceLongitude: location.longitude,
    deviceAccuracyM: accuracy,
  };
}

// The resize to apply so the long side is at most maxLongSide, or null when
// the image is already small enough. Only one dimension is given, so the
// aspect ratio is kept.
export function longSideResize(
  width: number,
  height: number,
  maxLongSide: number,
): { width: number } | { height: number } | null {
  if (Math.max(width, height) <= maxLongSide) return null;
  return width >= height ? { width: maxLongSide } : { height: maxLongSide };
}

// {collector_uid}/{client_record_id}/{photo_uuid}.jpg, lowercase, exactly as
// is_evidence_object_path() in 006_evidence_storage.sql requires.
export function evidenceStoragePath(
  userId: string,
  clientRecordId: string,
  photoUuid: string,
): string {
  return `${userId.toLowerCase()}/${clientRecordId.toLowerCase()}/${photoUuid.toLowerCase()}.jpg`;
}
