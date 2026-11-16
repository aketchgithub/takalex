// Outbox types. Pure TypeScript (no Expo or Supabase imports) so the sync
// engine can be tested with Node's built-in test runner.

// pending: waiting for (another) sync attempt, including after a retryable
//          failure (last_error says why).
// failed:  a permanent failure (validation, permission). Kept, never retried
//          automatically, with a readable reason in last_error.
// synced:  record, photo and evidence row are all on the server.
export type SyncState = "pending" | "failed" | "synced";

// The next step to run. Every step is idempotent, so repeating one after a
// crash is safe; the step only avoids repeating work that already succeeded.
export type SyncStep = "record" | "photo" | "evidence" | "done";

export type OutboxRow = {
  clientRecordId: string;
  userId: string;
  siteId: string;
  materialCode: string;
  // Two-decimal string, e.g. "12.50" (collection_logs.reported_weight_kg is
  // NUMERIC(10,2); a string avoids float rounding on the way).
  reportedWeightKg: string;
  // Device capture time, ISO 8601 (untrusted on the server).
  capturedAt: string;
  deviceLatitude: number | null;
  deviceLongitude: number | null;
  deviceAccuracyM: number | null;
  photoUuid: string;
  // Relative to the app's document directory (e.g. "outbox/<uuid>.jpg"), so
  // it survives a change of the container path. NULL once deleted after sync.
  photoPath: string | null;
  syncState: SyncState;
  syncStep: SyncStep;
  collectionId: string | null;
  attemptCount: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  lastAttemptAt: string | null;
  syncedAt: string | null;
};

// The shape of an error from PostgREST, Storage, Auth or a thrown exception,
// reduced to what classification needs.
export type RemoteError = {
  message: string;
  // HTTP status. 0 when the request never reached the server.
  status?: number;
  // PostgREST: SQLSTATE or PGRST code. Storage: error code.
  code?: string;
  // Storage: statusCode from the response body (e.g. "409").
  statusCode?: string;
  name?: string;
};

export type RemoteResult = { error: RemoteError | null };

// Exactly the columns `authenticated` may INSERT on collection_logs
// (001_initial_schema.sql). Everything else is server-set.
export type CollectionInsert = {
  client_record_id: string;
  site_id: string;
  material_code: string;
  reported_weight_kg: string;
  captured_at: string;
  device_latitude: number | null;
  device_longitude: number | null;
  device_accuracy_m: number | null;
};

// Exactly the columns `authenticated` may INSERT on collection_evidence.
export type EvidenceInsert = {
  collection_id: string;
  storage_path: string;
  content_type: "image/jpeg";
  captured_at: string;
};

export type OutboxStore = {
  // Rows to sync for this user (sync_state = 'pending').
  listSyncable(userId: string): Promise<OutboxRow[]>;
  recordAttempt(clientRecordId: string, at: string): Promise<void>;
  saveProgress(
    clientRecordId: string,
    progress: { syncStep: SyncStep; collectionId: string | null },
    at: string,
  ): Promise<void>;
  markRetryable(clientRecordId: string, reason: string, at: string): Promise<void>;
  markFailed(clientRecordId: string, reason: string, at: string): Promise<void>;
  markSynced(clientRecordId: string, at: string): Promise<void>;
  clearPhotoPath(clientRecordId: string, at: string): Promise<void>;
};

export type OutboxRemote = {
  // INSERT with return=minimal.
  insertCollection(row: CollectionInsert): Promise<RemoteResult>;
  // SELECT id only, by collector and client_record_id.
  findCollectionId(
    userId: string,
    clientRecordId: string,
  ): Promise<{ id: string | null; error: RemoteError | null }>;
  // Upload without upsert (overwrites are refused by policy anyway).
  uploadPhoto(storagePath: string, body: ArrayBuffer): Promise<RemoteResult>;
  // INSERT with return=minimal.
  insertEvidence(row: EvidenceInsert): Promise<RemoteResult>;
};

export type PhotoFiles = {
  read(relativePath: string): Promise<ArrayBuffer>;
  remove(relativePath: string): Promise<void>;
};

export type SessionPort = {
  // Refreshes the session if it is about to expire and returns the signed-in
  // user's id (null when signed out). error is set when the refresh failed.
  ensureFresh(): Promise<{ userId: string | null; error: RemoteError | null }>;
};

export type SyncDeps = {
  store: OutboxStore;
  remote: OutboxRemote;
  files: PhotoFiles;
  session: SessionPort;
  now: () => string;
};

export type SyncSummary =
  | { status: "idle" }
  | { status: "signed_out" }
  | { status: "session_error"; reason: string }
  | {
      status: "done";
      synced: string[];
      retrying: string[];
      failed: string[];
    };
