// SQLite-backed outbox store (expo-sqlite). Every query that lists rows is
// scoped to one user id, so a shared phone never shows or syncs another
// user's deliveries.

import * as SQLite from "expo-sqlite";

import type { OutboxRow, OutboxStore, SyncState, SyncStep } from "@/lib/outbox/types";

const DATABASE_NAME = "takalex-outbox.db";
const SCHEMA_VERSION = 1;

type DbRow = {
  client_record_id: string;
  user_id: string;
  site_id: string;
  material_code: string;
  reported_weight_kg: string;
  captured_at: string;
  device_latitude: number | null;
  device_longitude: number | null;
  device_accuracy_m: number | null;
  photo_uuid: string;
  photo_path: string | null;
  sync_state: SyncState;
  sync_step: SyncStep;
  collection_id: string | null;
  attempt_count: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  last_attempt_at: string | null;
  synced_at: string | null;
};

const COLUMNS = `client_record_id, user_id, site_id, material_code, reported_weight_kg,
  captured_at, device_latitude, device_longitude, device_accuracy_m, photo_uuid,
  photo_path, sync_state, sync_step, collection_id, attempt_count, last_error,
  created_at, updated_at, last_attempt_at, synced_at`;

async function migrate(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync("PRAGMA journal_mode = WAL;");
  const current = await db.getFirstAsync<{ user_version: number }>("PRAGMA user_version;");
  if ((current?.user_version ?? 0) >= SCHEMA_VERSION) return;

  await db.withExclusiveTransactionAsync(async (txn) => {
    await txn.execAsync(`
      CREATE TABLE IF NOT EXISTS outbox (
        client_record_id   TEXT PRIMARY KEY NOT NULL,
        user_id            TEXT NOT NULL,
        site_id            TEXT NOT NULL,
        material_code      TEXT NOT NULL,
        reported_weight_kg TEXT NOT NULL,
        captured_at        TEXT NOT NULL,
        device_latitude    REAL,
        device_longitude   REAL,
        device_accuracy_m  REAL,
        photo_uuid         TEXT NOT NULL,
        photo_path         TEXT,
        sync_state         TEXT NOT NULL DEFAULT 'pending'
                           CHECK (sync_state IN ('pending', 'failed', 'synced')),
        sync_step          TEXT NOT NULL DEFAULT 'record'
                           CHECK (sync_step IN ('record', 'photo', 'evidence', 'done')),
        collection_id      TEXT,
        attempt_count      INTEGER NOT NULL DEFAULT 0,
        last_error         TEXT,
        created_at         TEXT NOT NULL,
        updated_at         TEXT NOT NULL,
        last_attempt_at    TEXT,
        synced_at          TEXT
      );
      CREATE INDEX IF NOT EXISTS outbox_user_state_idx ON outbox (user_id, sync_state);
      PRAGMA user_version = ${SCHEMA_VERSION};
    `);
  });
}

let databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;

function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (!databasePromise) {
    databasePromise = (async () => {
      const db = await SQLite.openDatabaseAsync(DATABASE_NAME);
      await migrate(db);
      return db;
    })().catch((error: unknown) => {
      databasePromise = null;
      throw error;
    });
  }
  return databasePromise;
}

function fromDb(row: DbRow): OutboxRow {
  return {
    clientRecordId: row.client_record_id,
    userId: row.user_id,
    siteId: row.site_id,
    materialCode: row.material_code,
    reportedWeightKg: row.reported_weight_kg,
    capturedAt: row.captured_at,
    deviceLatitude: row.device_latitude,
    deviceLongitude: row.device_longitude,
    deviceAccuracyM: row.device_accuracy_m,
    photoUuid: row.photo_uuid,
    photoPath: row.photo_path,
    syncState: row.sync_state,
    syncStep: row.sync_step,
    collectionId: row.collection_id,
    attemptCount: row.attempt_count,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastAttemptAt: row.last_attempt_at,
    syncedAt: row.synced_at,
  };
}

export type NewOutboxRow = Pick<
  OutboxRow,
  | "clientRecordId"
  | "userId"
  | "siteId"
  | "materialCode"
  | "reportedWeightKg"
  | "capturedAt"
  | "deviceLatitude"
  | "deviceLongitude"
  | "deviceAccuracyM"
  | "photoUuid"
  | "photoPath"
>;

export async function insertOutboxRow(row: NewOutboxRow, at: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO outbox (client_record_id, user_id, site_id, material_code,
       reported_weight_kg, captured_at, device_latitude, device_longitude,
       device_accuracy_m, photo_uuid, photo_path, sync_state, sync_step,
       attempt_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'record', 0, ?, ?)`,
    [
      row.clientRecordId,
      row.userId,
      row.siteId,
      row.materialCode,
      row.reportedWeightKg,
      row.capturedAt,
      row.deviceLatitude,
      row.deviceLongitude,
      row.deviceAccuracyM,
      row.photoUuid,
      row.photoPath,
      at,
      at,
    ],
  );
}

// All of one user's rows, newest first (for history / status screens).
export async function listOutboxRowsForUser(userId: string): Promise<OutboxRow[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<DbRow>(
    `SELECT ${COLUMNS} FROM outbox WHERE user_id = ? ORDER BY created_at DESC`,
    [userId],
  );
  return rows.map(fromDb);
}

async function run(sql: string, params: SQLite.SQLiteBindValue[]): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(sql, params);
}

export const sqliteOutboxStore: OutboxStore = {
  async listSyncable(userId) {
    const db = await getDatabase();
    const rows = await db.getAllAsync<DbRow>(
      `SELECT ${COLUMNS} FROM outbox
       WHERE user_id = ? AND sync_state = 'pending'
       ORDER BY created_at ASC`,
      [userId],
    );
    return rows.map(fromDb);
  },

  recordAttempt: (id, at) =>
    run(
      `UPDATE outbox SET attempt_count = attempt_count + 1, last_attempt_at = ?, updated_at = ?
       WHERE client_record_id = ?`,
      [at, at, id],
    ),

  saveProgress: (id, progress, at) =>
    run(
      `UPDATE outbox SET sync_step = ?, collection_id = ?, updated_at = ?
       WHERE client_record_id = ?`,
      [progress.syncStep, progress.collectionId, at, id],
    ),

  markRetryable: (id, reason, at) =>
    run(
      `UPDATE outbox SET sync_state = 'pending', last_error = ?, updated_at = ?
       WHERE client_record_id = ?`,
      [reason, at, id],
    ),

  markFailed: (id, reason, at) =>
    run(
      `UPDATE outbox SET sync_state = 'failed', last_error = ?, updated_at = ?
       WHERE client_record_id = ?`,
      [reason, at, id],
    ),

  markSynced: (id, at) =>
    run(
      `UPDATE outbox SET sync_state = 'synced', sync_step = 'done', last_error = NULL,
         synced_at = ?, updated_at = ?
       WHERE client_record_id = ?`,
      [at, at, id],
    ),

  clearPhotoPath: (id, at) =>
    run(
      `UPDATE outbox SET photo_path = NULL, updated_at = ? WHERE client_record_id = ?`,
      [at, id],
    ),
};
