// Outbox sync engine. Pure TypeScript: the local store, Supabase calls,
// photo files and session are injected (see types.ts), so this file is
// tested with Node's test runner (syncEngine.test.ts).
//
// Per row, in order, each step idempotent:
//   1. record    INSERT collection_logs (granted columns, return=minimal).
//                23505 (collector_id, client_record_id) = already synced.
//                Then SELECT id by client_record_id.
//   2. photo     Upload to {uid}/{client_record_id}/{photo_uuid}.jpg.
//                "Already exists" = success.
//   3. evidence  INSERT collection_evidence. 23505 (storage_path) = success.
//   4. done      Mark the row synced, then (only then) delete the photo.
//
// A retryable failure leaves the row pending at the step that failed; a
// permanent one marks it failed. Either way last_error says why.

import {
  PermanentSyncError,
  classifyError,
  isStorageDuplicate,
  isUniqueViolation,
} from "./errors.ts";
import type {
  CollectionInsert,
  OutboxRow,
  RemoteError,
  SyncDeps,
  SyncStep,
  SyncSummary,
} from "./types.ts";
import { evidenceStoragePath } from "./validation.ts";

const STEP_LABEL: Record<Exclude<SyncStep, "done">, string> = {
  record: "Sending the delivery",
  photo: "Uploading the photo",
  evidence: "Attaching the photo",
};

// Carries the step a remote error happened in, for the readable reason.
class StepFailure extends Error {
  readonly step: Exclude<SyncStep, "done">;
  readonly original: unknown;
  constructor(step: Exclude<SyncStep, "done">, cause: unknown) {
    super(STEP_LABEL[step]);
    this.step = step;
    this.original = cause;
  }
}

function toCollectionInsert(row: OutboxRow): CollectionInsert {
  return {
    client_record_id: row.clientRecordId,
    site_id: row.siteId,
    material_code: row.materialCode,
    reported_weight_kg: row.reportedWeightKg,
    captured_at: row.capturedAt,
    device_latitude: row.deviceLatitude,
    device_longitude: row.deviceLongitude,
    device_accuracy_m: row.deviceAccuracyM,
  };
}

function fail(step: Exclude<SyncStep, "done">, error: RemoteError | unknown): never {
  throw new StepFailure(step, error);
}

type RowOutcome = "synced" | "retrying" | "failed";

async function syncRow(deps: SyncDeps, userId: string, row: OutboxRow): Promise<RowOutcome> {
  const { store, remote, files } = deps;
  const id = row.clientRecordId;

  await store.recordAttempt(id, deps.now());

  let step: SyncStep = row.syncStep;
  let collectionId = row.collectionId;

  try {
    // 1. record
    if (step === "record" || collectionId === null) {
      step = "record";
      const inserted = await remote.insertCollection(toCollectionInsert(row));
      if (inserted.error && !isUniqueViolation(inserted.error)) fail("record", inserted.error);

      const found = await remote.findCollectionId(userId, id);
      if (found.error) fail("record", found.error);
      if (!found.id) {
        fail(
          "record",
          new PermanentSyncError(
            "The server accepted this delivery but it could not be found afterwards.",
          ),
        );
      }
      collectionId = found.id;
      step = "photo";
      await store.saveProgress(id, { syncStep: step, collectionId }, deps.now());
    }

    const storagePath = evidenceStoragePath(userId, id, row.photoUuid);

    // 2. photo
    if (step === "photo") {
      if (!row.photoPath) {
        fail("photo", new PermanentSyncError("The photo is no longer on this device."));
      }
      let body: ArrayBuffer;
      try {
        body = await files.read(row.photoPath);
      } catch {
        fail("photo", new PermanentSyncError("The photo is no longer on this device."));
      }
      const uploaded = await remote.uploadPhoto(storagePath, body);
      if (uploaded.error && !isStorageDuplicate(uploaded.error)) fail("photo", uploaded.error);

      step = "evidence";
      await store.saveProgress(id, { syncStep: step, collectionId }, deps.now());
    }

    // 3. evidence
    if (step === "evidence") {
      const evidence = await remote.insertEvidence({
        collection_id: collectionId,
        storage_path: storagePath,
        content_type: "image/jpeg",
        captured_at: row.capturedAt,
      });
      if (evidence.error && !isUniqueViolation(evidence.error)) fail("evidence", evidence.error);
    }

    // 4. done
    await store.markSynced(id, deps.now());
  } catch (error: unknown) {
    const failure =
      error instanceof StepFailure ? error : new StepFailure(step === "done" ? "evidence" : step, error);
    const classified = classifyError(failure.original);
    const reason = `${STEP_LABEL[failure.step]}: ${classified.reason}`;
    if (classified.kind === "retryable") {
      await store.markRetryable(id, reason, deps.now());
      return "retrying";
    }
    await store.markFailed(id, reason, deps.now());
    return "failed";
  }

  // Only after the row is marked synced. If deleting fails, the row is still
  // synced and keeps its path, so a later cleanup can remove the file.
  if (row.photoPath) {
    try {
      await files.remove(row.photoPath);
      await store.clearPhotoPath(id, deps.now());
    } catch {
      // Ignored on purpose: the delivery itself is safely on the server.
    }
  }
  return "synced";
}

export async function syncOutbox(deps: SyncDeps, userId: string): Promise<SyncSummary> {
  // Only this user's pending rows, checked again here whatever the store
  // returns, so another user's rows on a shared phone are never sent under
  // this session.
  const rows = (await deps.store.listSyncable(userId)).filter(
    (row) => row.userId === userId && row.syncState === "pending",
  );
  if (rows.length === 0) return { status: "idle" };

  const session = await deps.session.ensureFresh();
  if (session.error) {
    // Rows are untouched: no attempt is counted when we never got going.
    return { status: "session_error", reason: classifyError(session.error).reason };
  }
  if (session.userId !== userId) return { status: "signed_out" };

  const summary = { status: "done" as const, synced: [] as string[], retrying: [] as string[], failed: [] as string[] };
  for (const row of rows) {
    const outcome = await syncRow(deps, userId, row);
    summary[outcome].push(row.clientRecordId);
  }
  return summary;
}

// Runs task one at a time. A call while a run is in progress returns the
// current run and queues exactly one more run afterwards, so a trigger that
// arrives mid-sync (e.g. a new save) is never lost.
export function singleFlight<T>(task: () => Promise<T>): () => Promise<T> {
  let running: Promise<T> | null = null;
  let queued: Promise<T> | null = null;

  const start = (): Promise<T> => {
    running = task().finally(() => {
      running = null;
    });
    return running;
  };

  return () => {
    if (!running) return start();
    if (!queued) {
      queued = running
        .catch(() => undefined)
        .then(() => {
          queued = null;
          return start();
        });
    }
    return queued;
  };
}
