// What the collector screens say about deliveries. Pure TypeScript (tested
// by presentation.test.ts), so the wording rules live in one place.

import { NOT_ALLOWED_REASON } from "./errors.ts";
import { STEP_LABEL } from "./syncEngine.ts";
import type { OutboxRow, SyncSummary } from "./types.ts";

export type DeliveryStatus = "pending" | "approved" | "rejected";

// A delivery as the server returns it to its collector (explicit columns).
export type ServerDelivery = {
  id: string;
  clientRecordId: string;
  materialCode: string;
  materialName: string | null;
  reportedWeightKg: number;
  verifiedWeightKg: number | null;
  status: DeliveryStatus;
  rejectionReason: string | null;
  submittedAt: string;
};

export type Tone = "info" | "success" | "error";
export type Notice = { tone: Tone; text: string };

export const REVIEWED_BEFORE_PHOTO =
  "This delivery was reviewed before its photo uploaded.";

export function formatKg(value: number | string): string {
  const kg = typeof value === "number" ? value : Number(value);
  return Number.isFinite(kg) ? `${kg.toFixed(2)} kg` : `${value} kg`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "9 Nov 2026, 14:05" in the phone's time zone (no Intl dependency).
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}, ${hh}:${mm}`;
}

export function deliveryStatusLabel(
  status: DeliveryStatus,
  rejectionReason: string | null,
): string {
  if (status === "approved") return "Approved";
  if (status === "rejected") {
    const reason = rejectionReason?.trim();
    return reason ? `Rejected: ${reason}` : "Rejected";
  }
  return "Pending review";
}

// True when the photo upload or evidence row was refused by RLS after the
// record itself reached the server. Both storage and evidence policies
// require the collection to still be pending (006_evidence_storage.sql).
function isPermissionFailureAfterRecord(row: OutboxRow): boolean {
  if (row.syncState !== "failed" || row.collectionId === null || !row.lastError) return false;
  return [STEP_LABEL.photo, STEP_LABEL.evidence].some((label) =>
    row.lastError?.startsWith(`${label}: ${NOT_ALLOWED_REASON}`),
  );
}

// The text after "Upload failed: ". serverStatus is the server's status for
// this row's collection when known. The friendly wording is used unless the
// server says the delivery is still pending (then the refusal had another
// cause, and the stored reason is shown as is).
export function failureReason(row: OutboxRow, serverStatus: DeliveryStatus | undefined): string {
  if (isPermissionFailureAfterRecord(row) && serverStatus !== "pending") {
    return REVIEWED_BEFORE_PHOTO;
  }
  return row.lastError ?? "Unknown error.";
}

export function localRowStatus(row: OutboxRow, serverStatus: DeliveryStatus | undefined): Notice {
  if (row.syncState === "failed") {
    return { tone: "error", text: `Upload failed: ${failureReason(row, serverStatus)}` };
  }
  return { tone: "info", text: "Waiting to upload" };
}

// Server rows to list below the local ones: a delivery still waiting on this
// phone (e.g. its photo has not uploaded) is shown once, as the local row,
// while the server still says pending. Once reviewed, the server row shows
// the decision as well.
export function visibleServerDeliveries(
  server: ServerDelivery[],
  waiting: OutboxRow[],
): ServerDelivery[] {
  const waitingIds = new Set(waiting.map((row) => row.clientRecordId.toLowerCase()));
  return server.filter(
    (delivery) =>
      delivery.status !== "pending" || !waitingIds.has(delivery.clientRecordId.toLowerCase()),
  );
}

export function discardConfirmation(row: OutboxRow): string {
  if (row.collectionId === null) {
    return "This delivery has not reached Takalex. Discarding deletes it and its photo from this phone. This cannot be undone.";
  }
  return "This delivery is on Takalex, but its photo is not. Discarding deletes the photo from this phone. This cannot be undone.";
}

// The message after a submit's sync run. row is the saved row as re-read
// from the phone afterwards (null if it could not be read).
export function submitOutcome(summary: SyncSummary, row: OutboxRow | null): Notice {
  const id = row?.clientRecordId;
  if (summary.status === "done" && id) {
    if (summary.synced.includes(id)) {
      return { tone: "success", text: "Uploaded. Your delivery is now Pending review." };
    }
    if (summary.failed.includes(id)) {
      return { tone: "error", text: `Upload failed (see History): ${row?.lastError ?? "Unknown error."}` };
    }
    if (summary.retrying.includes(id)) {
      return {
        tone: "info",
        text: `Saved on this phone, waiting to upload. ${row?.lastError ?? ""}`.trim(),
      };
    }
  }
  if (summary.status === "session_error") {
    return { tone: "info", text: `Saved on this phone, waiting to upload. ${summary.reason}` };
  }
  if (summary.status === "signed_out") {
    return { tone: "info", text: "Saved on this phone. It will upload when you sign in again." };
  }
  return { tone: "info", text: "Saved on this phone, waiting to upload." };
}

export function deliveries(count: number): string {
  return `${count} ${count === 1 ? "delivery" : "deliveries"}`;
}

// The message after "Sync now".
export function syncNowOutcome(summary: SyncSummary): Notice {
  switch (summary.status) {
    case "idle":
      return { tone: "info", text: "Nothing waiting to upload." };
    case "signed_out":
      return { tone: "error", text: "Sign in again to upload your deliveries." };
    case "session_error":
      return { tone: "error", text: summary.reason };
    case "done": {
      const parts: string[] = [];
      if (summary.synced.length) parts.push(`${deliveries(summary.synced.length)} uploaded`);
      if (summary.retrying.length) parts.push(`${summary.retrying.length} still waiting (it will retry)`);
      if (summary.failed.length) parts.push(`${summary.failed.length} failed (see History)`);
      const tone: Tone = summary.failed.length || summary.retrying.length ? "error" : "success";
      return { tone, text: `${parts.join(", ")}.` };
    }
  }
}

// Outbox photo files are "outbox/<uuid>.jpg". Given the file names in the
// outbox directory and every row's photo path (all users on this phone),
// returns the files to delete:
//   orphans:       not referenced by any row (e.g. the app stopped between
//                  moving the photo and saving the row, or after a discard)
//   syncedLeftovers: referenced only by synced rows (the delete after sync
//                  failed); the caller clears those rows' paths too.
// Names that are not outbox photo names are never touched.
const PHOTO_NAME = /^[0-9a-f-]+\.jpg$/;

export function planPhotoCleanup(
  fileNames: string[],
  references: { photoPath: string; syncState: OutboxRow["syncState"] }[],
): { orphans: string[]; syncedLeftovers: string[] } {
  const live = new Set<string>();
  const synced = new Set<string>();
  for (const ref of references) {
    if (ref.syncState === "synced") synced.add(ref.photoPath);
    else live.add(ref.photoPath);
  }
  const orphans: string[] = [];
  const syncedLeftovers: string[] = [];
  for (const name of fileNames) {
    if (!PHOTO_NAME.test(name)) continue;
    const path = `outbox/${name}`;
    if (live.has(path)) continue;
    if (synced.has(path)) syncedLeftovers.push(path);
    else orphans.push(path);
  }
  return { orphans, syncedLeftovers };
}
