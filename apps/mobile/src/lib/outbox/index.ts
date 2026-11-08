// Collector submission outbox (docs/demo-plan.md section 2, "Submission
// path"): every delivery is written to SQLite with its photo on disk first,
// then synced, even when online. Nothing exists only in memory.

import { randomUUID } from "expo-crypto";

import { insertOutboxRow, listOutboxRowsForUser, sqliteOutboxStore } from "@/lib/outbox/db";
import { outboxPhotoFiles, processPhoto, storeOutboxPhoto } from "@/lib/outbox/photo";
import { supabaseOutboxRemote, supabaseSessionPort } from "@/lib/outbox/remote";
import { singleFlight, syncOutbox } from "@/lib/outbox/syncEngine";
import type { OutboxRow, SyncSummary } from "@/lib/outbox/types";
import {
  normalizeLocation,
  normalizeReportedWeight,
  type DeviceLocation,
} from "@/lib/outbox/validation";
import { useAuthStore } from "@/stores/authStore";

export type { OutboxRow, SyncSummary } from "@/lib/outbox/types";
export type { DeviceLocation } from "@/lib/outbox/validation";

// The signed-in, active collector's id, or null.
function currentCollectorId(): string | null {
  const { session, profile } = useAuthStore.getState();
  if (!session || !profile || !profile.is_active || profile.role !== "collector") return null;
  if (profile.id !== session.user.id) return null;
  return session.user.id;
}

const now = () => new Date().toISOString();

const runSync = singleFlight(async (): Promise<SyncSummary> => {
  const userId = currentCollectorId();
  if (!userId) return { status: "signed_out" };
  return syncOutbox(
    {
      store: sqliteOutboxStore,
      remote: supabaseOutboxRemote,
      files: outboxPhotoFiles,
      session: supabaseSessionPort,
      now,
    },
    userId,
  );
});

// Sync the signed-in collector's pending rows now. Safe to call at any time
// and from several places: runs never overlap.
export async function syncNow(): Promise<SyncSummary> {
  try {
    return await runSync();
  } catch (error: unknown) {
    // A local failure (e.g. SQLite) must never crash a trigger.
    const reason = error instanceof Error ? error.message : "Sync failed.";
    return { status: "session_error", reason };
  }
}

export type NewSubmission = {
  siteId: string;
  materialCode: string;
  // As typed by the collector, e.g. "12.5".
  reportedWeight: string;
  capturedAt: Date;
  location: DeviceLocation | null;
  // The camera's temporary file.
  photoUri: string;
};

// Saves a delivery to the outbox (photo processed and moved into the
// document directory first), then starts a sync without waiting for it.
export async function saveSubmission(input: NewSubmission): Promise<OutboxRow> {
  const userId = currentCollectorId();
  if (!userId) throw new Error("Sign in as an active collector to log a delivery.");

  const reportedWeightKg = normalizeReportedWeight(input.reportedWeight);
  if (!reportedWeightKg) {
    throw new Error("Enter a weight above 0 kg with at most two decimals.");
  }
  if (Number.isNaN(input.capturedAt.getTime())) throw new Error("Invalid capture time.");

  const clientRecordId = randomUUID().toLowerCase();
  const photoUuid = randomUUID().toLowerCase();

  const processed = await processPhoto(input.photoUri);
  const photoPath = await storeOutboxPhoto(processed.uri, photoUuid);

  const at = now();
  const row = {
    clientRecordId,
    userId,
    siteId: input.siteId,
    materialCode: input.materialCode,
    reportedWeightKg,
    capturedAt: input.capturedAt.toISOString(),
    ...normalizeLocation(input.location),
    photoUuid,
    photoPath,
  };

  try {
    await insertOutboxRow(row, at);
  } catch (error: unknown) {
    // Without a row the photo would be orphaned.
    await outboxPhotoFiles.remove(photoPath).catch(() => undefined);
    throw error;
  }

  void syncNow();

  return {
    ...row,
    syncState: "pending",
    syncStep: "record",
    collectionId: null,
    attemptCount: 0,
    lastError: null,
    createdAt: at,
    updatedAt: at,
    lastAttemptAt: null,
    syncedAt: null,
  };
}

// The signed-in collector's outbox rows, newest first. Empty when nobody
// (or a non-collector) is signed in.
export async function listOutbox(): Promise<OutboxRow[]> {
  const userId = currentCollectorId();
  if (!userId) return [];
  return listOutboxRowsForUser(userId);
}
