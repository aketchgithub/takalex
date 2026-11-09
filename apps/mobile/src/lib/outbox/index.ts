// Collector submission outbox (docs/demo-plan.md section 2, "Submission
// path"): every delivery is written to SQLite with its photo on disk first,
// then synced, even when online. Nothing exists only in memory.

import { randomUUID } from "expo-crypto";

import {
  deleteFailedRow,
  getOutboxRowForUser,
  insertOutboxRow,
  listOutboxRowsForUser,
  listPhotoReferences,
  listUnsyncedRowsForUser,
  retryFailedRow,
  sqliteOutboxStore,
} from "@/lib/outbox/db";
import {
  deleteTemporaryPhoto,
  listOutboxPhotoNames,
  outboxPhotoFiles,
  processPhoto,
  storeOutboxPhoto,
} from "@/lib/outbox/photo";
import { planPhotoCleanup } from "@/lib/outbox/presentation";
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

// Screens subscribe to re-read the outbox after anything changes it: a save,
// a sync run (whoever triggered it), a retry or a discard.
const listeners = new Set<() => void>();

export function subscribeOutbox(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notifyOutboxChanged(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // A screen's listener must never break the outbox.
    }
  }
}

// Serialises "move photo into the outbox + insert its row" with photo
// cleanup, so cleanup never sees a photo whose row is about to be written.
let photoLockChain: Promise<unknown> = Promise.resolve();
function withPhotoLock<T>(task: () => Promise<T>): Promise<T> {
  const next = photoLockChain.then(task, task);
  photoLockChain = next.catch(() => undefined);
  return next;
}

const runSync = singleFlight(async (): Promise<SyncSummary> => {
  const userId = currentCollectorId();
  if (!userId) return { status: "signed_out" };
  try {
    return await syncOutbox(
      {
        store: sqliteOutboxStore,
        remote: supabaseOutboxRemote,
        files: outboxPhotoFiles,
        session: supabaseSessionPort,
        now,
      },
      userId,
    );
  } finally {
    notifyOutboxChanged();
  }
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

export type SavedSubmission = {
  row: OutboxRow;
  // The sync run that includes this row (a run already in progress queues
  // one more, so this always covers the new row).
  sync: Promise<SyncSummary>;
};

// Saves a delivery to the outbox (photo processed and moved into the
// document directory first), then starts a sync. When this resolves the
// delivery is safely on the phone; await `sync` for the upload result.
export async function saveSubmission(input: NewSubmission): Promise<SavedSubmission> {
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

  const at = now();
  const row = await withPhotoLock(async () => {
    const photoPath = await storeOutboxPhoto(processed.uri, photoUuid);
    const newRow = {
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
      await insertOutboxRow(newRow, at);
    } catch (error: unknown) {
      // Without a row the photo would be orphaned.
      await outboxPhotoFiles.remove(photoPath).catch(() => undefined);
      throw error;
    }
    return newRow;
  });

  // The processed copy now lives in the outbox; the camera's original in
  // the cache is no longer needed.
  if (input.photoUri !== processed.uri) deleteTemporaryPhoto(input.photoUri);

  notifyOutboxChanged();
  const sync = syncNow();

  return {
    row: {
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
    },
    sync,
  };
}

// The signed-in collector's outbox rows, newest first. Empty when nobody
// (or a non-collector) is signed in.
export async function listOutbox(): Promise<OutboxRow[]> {
  const userId = currentCollectorId();
  if (!userId) return [];
  return listOutboxRowsForUser(userId);
}

// The signed-in collector's deliveries that are not on the server yet
// (waiting or failed), newest first.
export async function listWaitingDeliveries(): Promise<OutboxRow[]> {
  const userId = currentCollectorId();
  if (!userId) return [];
  return listUnsyncedRowsForUser(userId);
}

export async function getOutboxRow(clientRecordId: string): Promise<OutboxRow | null> {
  const userId = currentCollectorId();
  if (!userId) return null;
  return getOutboxRowForUser(userId, clientRecordId);
}

// Puts a failed delivery back in the queue and syncs now.
export async function retryDelivery(clientRecordId: string): Promise<SyncSummary> {
  const userId = currentCollectorId();
  if (!userId) return { status: "signed_out" };
  await retryFailedRow(userId, clientRecordId, now());
  notifyOutboxChanged();
  return syncNow();
}

// Deletes a failed delivery and its photo from this phone. Only failed rows
// of the signed-in collector can be discarded.
export async function discardDelivery(clientRecordId: string): Promise<void> {
  const userId = currentCollectorId();
  if (!userId) throw new Error("Sign in as an active collector to discard a delivery.");
  const deleted = await deleteFailedRow(userId, clientRecordId);
  if (deleted?.photoPath) {
    // If this fails the file is an orphan, removed at the next start.
    await outboxPhotoFiles.remove(deleted.photoPath).catch(() => undefined);
  }
  notifyOutboxChanged();
}

// Run once at app start: deletes outbox photo files that no row references
// (for any user on this phone), and photos of already-synced rows whose
// delete after sync failed. Never throws.
export async function cleanupOutboxPhotos(): Promise<{ removed: number }> {
  try {
    return await withPhotoLock(async () => {
      const references = await listPhotoReferences();
      const plan = planPhotoCleanup(listOutboxPhotoNames(), references);
      let removed = 0;
      for (const path of plan.orphans) {
        try {
          await outboxPhotoFiles.remove(path);
          removed += 1;
        } catch {
          // Try again next start.
        }
      }
      const at = now();
      for (const ref of references) {
        if (ref.syncState !== "synced" || !plan.syncedLeftovers.includes(ref.photoPath)) continue;
        try {
          await outboxPhotoFiles.remove(ref.photoPath);
          await sqliteOutboxStore.clearPhotoPath(ref.clientRecordId, at);
          removed += 1;
        } catch {
          // Try again next start.
        }
      }
      return { removed };
    });
  } catch {
    return { removed: 0 };
  }
}
