// Web stand-in for the SQLite outbox (db.ts). Metro uses this file instead of
// db.ts when building the website, so expo-sqlite (and its WebAssembly
// worker) is never part of the web bundle. The website is admin-only
// (lib/webAccess.ts) and never records deliveries: reads return nothing, and
// anything that would save or change a delivery refuses with a clear message.
// Keep the exports and their types identical to db.ts.

import type { OutboxRow, OutboxStore, SyncState } from "@/lib/outbox/types";

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

const PHONE_ONLY = "Recording deliveries is only available in the Takalex phone app.";

export async function insertOutboxRow(_row: NewOutboxRow, _at: string): Promise<void> {
  throw new Error(PHONE_ONLY);
}

export async function listOutboxRowsForUser(_userId: string): Promise<OutboxRow[]> {
  return [];
}

export async function listUnsyncedRowsForUser(_userId: string): Promise<OutboxRow[]> {
  return [];
}

export async function getOutboxRowForUser(_userId: string, _clientRecordId: string): Promise<OutboxRow | null> {
  return null;
}

export async function retryFailedRow(_userId: string, _clientRecordId: string, _at: string): Promise<boolean> {
  return false;
}

export async function deleteFailedRow(
  _userId: string,
  _clientRecordId: string,
): Promise<{ photoPath: string | null } | null> {
  return null;
}

export async function listPhotoReferences(): Promise<
  { clientRecordId: string; photoPath: string; syncState: SyncState }[]
> {
  return [];
}

async function refuse(): Promise<void> {
  throw new Error(PHONE_ONLY);
}

export const sqliteOutboxStore: OutboxStore = {
  listSyncable: async () => [],
  recordAttempt: refuse,
  saveProgress: refuse,
  markRetryable: refuse,
  markFailed: refuse,
  markSynced: refuse,
  clearPhotoPath: refuse,
};
