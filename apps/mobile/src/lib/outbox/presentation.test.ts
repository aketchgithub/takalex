// node --experimental-strip-types --test (npm run test:unit)
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  REVIEWED_BEFORE_PHOTO,
  deliveryStatusLabel,
  discardConfirmation,
  failureReason,
  formatDateTime,
  formatKg,
  localRowStatus,
  planPhotoCleanup,
  submitOutcome,
  syncNowOutcome,
  visibleServerDeliveries,
  type ServerDelivery,
} from "./presentation.ts";
import type { OutboxRow } from "./types.ts";

const ID = "aaaaaaaa-aaaa-4aaa-8aaa-000000000001";
const PHOTO = "bbbbbbbb-bbbb-4bbb-8bbb-000000000001";

function row(overrides: Partial<OutboxRow> = {}): OutboxRow {
  return {
    clientRecordId: ID,
    userId: "11111111-1111-4111-8111-111111111111",
    siteId: "33333333-3333-4333-8333-333333333333",
    materialCode: "PET",
    reportedWeightKg: "12.50",
    capturedAt: "2026-11-09T08:00:00.000Z",
    deviceLatitude: null,
    deviceLongitude: null,
    deviceAccuracyM: null,
    photoUuid: PHOTO,
    photoPath: `outbox/${PHOTO}.jpg`,
    syncState: "pending",
    syncStep: "record",
    collectionId: null,
    attemptCount: 0,
    lastError: null,
    createdAt: "2026-11-09T08:00:00.000Z",
    updatedAt: "2026-11-09T08:00:00.000Z",
    lastAttemptAt: null,
    syncedAt: null,
    ...overrides,
  };
}

function server(overrides: Partial<ServerDelivery> = {}): ServerDelivery {
  return {
    id: "col-1",
    clientRecordId: ID,
    materialCode: "PET",
    materialName: "PET",
    reportedWeightKg: 12.5,
    verifiedWeightKg: null,
    status: "pending",
    rejectionReason: null,
    submittedAt: "2026-11-09T08:01:00.000Z",
    ...overrides,
  };
}

// The exact reasons syncEngine stores for an RLS refusal at each step.
const PHOTO_NOT_ALLOWED = "Uploading the photo: Not allowed by the server: new row violates row-level security policy";
const EVIDENCE_NOT_ALLOWED = "Attaching the photo: Not allowed by the server: new row violates row-level security policy";
const RECORD_NOT_ALLOWED = "Sending the delivery: Not allowed by the server: new row violates row-level security policy";

describe("deliveryStatusLabel", () => {
  it("labels each status, with the rejection reason", () => {
    assert.equal(deliveryStatusLabel("pending", null), "Pending review");
    assert.equal(deliveryStatusLabel("approved", null), "Approved");
    assert.equal(deliveryStatusLabel("rejected", "  Wet bags  "), "Rejected: Wet bags");
    assert.equal(deliveryStatusLabel("rejected", null), "Rejected");
  });
});

describe("formatKg / formatDateTime", () => {
  it("always shows two decimals", () => {
    assert.equal(formatKg(12.5), "12.50 kg");
    assert.equal(formatKg("3.75"), "3.75 kg");
    assert.equal(formatKg(7), "7.00 kg");
  });

  it("formats local time without Intl", () => {
    const iso = new Date(2026, 10, 9, 14, 5).toISOString();
    assert.equal(formatDateTime(iso), "9 Nov 2026, 14:05");
    assert.equal(formatDateTime("not a date"), "not a date");
  });
});

describe("failureReason (friendly wording after review)", () => {
  for (const [label, lastError] of [
    ["photo upload", PHOTO_NOT_ALLOWED],
    ["evidence row", EVIDENCE_NOT_ALLOWED],
  ] as const) {
    it(`uses the friendly text for a ${label} refusal once the record is on the server`, () => {
      const failed = row({ syncState: "failed", syncStep: "photo", collectionId: "col-1", lastError });
      assert.equal(failureReason(failed, "approved"), REVIEWED_BEFORE_PHOTO);
      assert.equal(failureReason(failed, "rejected"), REVIEWED_BEFORE_PHOTO);
      // Server status unknown (offline): still the friendly text.
      assert.equal(failureReason(failed, undefined), REVIEWED_BEFORE_PHOTO);
      assert.equal(
        localRowStatus(failed, "approved").text,
        "Upload failed: This delivery was reviewed before its photo uploaded.",
      );
    });
  }

  it("keeps the stored reason when the server says the delivery is still pending", () => {
    const failed = row({ syncState: "failed", collectionId: "col-1", lastError: PHOTO_NOT_ALLOWED });
    assert.equal(failureReason(failed, "pending"), PHOTO_NOT_ALLOWED);
  });

  it("keeps the stored reason for other failures", () => {
    // Refused before the record existed: not a review race.
    assert.equal(
      failureReason(row({ syncState: "failed", lastError: RECORD_NOT_ALLOWED }), undefined),
      RECORD_NOT_ALLOWED,
    );
    const rejected = "Sending the delivery: Rejected by the server: Material is not reportable";
    assert.equal(failureReason(row({ syncState: "failed", lastError: rejected }), undefined), rejected);
    const missing = "Uploading the photo: The photo is no longer on this device.";
    assert.equal(
      failureReason(row({ syncState: "failed", collectionId: "col-1", lastError: missing }), "approved"),
      missing,
    );
  });
});

describe("localRowStatus", () => {
  it("shows Waiting to upload for pending rows, even after a retryable error", () => {
    assert.deepEqual(localRowStatus(row(), undefined), { tone: "info", text: "Waiting to upload" });
    assert.equal(localRowStatus(row({ lastError: "Sending the delivery: No connection" }), undefined).text, "Waiting to upload");
  });

  it("shows Upload failed: reason for failed rows", () => {
    assert.deepEqual(localRowStatus(row({ syncState: "failed", lastError: "Boom" }), undefined), {
      tone: "error",
      text: "Upload failed: Boom",
    });
  });
});

describe("visibleServerDeliveries", () => {
  it("hides a pending server row that is still waiting on this phone", () => {
    const waiting = [row({ clientRecordId: ID.toUpperCase(), syncStep: "photo", collectionId: "col-1" })];
    assert.deepEqual(visibleServerDeliveries([server()], waiting), []);
  });

  it("shows it once it has been reviewed, and always shows unrelated rows", () => {
    const waiting = [row({ syncState: "failed", collectionId: "col-1" })];
    const reviewed = server({ status: "approved", verifiedWeightKg: 11 });
    const other = server({ id: "col-2", clientRecordId: "cccccccc-cccc-4ccc-8ccc-000000000002" });
    assert.deepEqual(visibleServerDeliveries([reviewed, other], waiting), [reviewed, other]);
    assert.deepEqual(visibleServerDeliveries([server()], []), [server()]);
  });
});

describe("discardConfirmation", () => {
  it("warns that an unsent delivery is lost, or that only the photo goes", () => {
    assert.match(discardConfirmation(row({ syncState: "failed" })), /has not reached Takalex/);
    assert.match(discardConfirmation(row({ syncState: "failed", collectionId: "col-1" })), /is on Takalex, but its photo is not/);
  });
});

describe("submitOutcome", () => {
  const done = (key: "synced" | "retrying" | "failed") => ({
    status: "done" as const,
    synced: key === "synced" ? [ID] : [],
    retrying: key === "retrying" ? [ID] : [],
    failed: key === "failed" ? [ID] : [],
  });

  it("reports the result for this row", () => {
    assert.deepEqual(submitOutcome(done("synced"), row()), {
      tone: "success",
      text: "Uploaded. Your delivery is now Pending review.",
    });
    const offline = "Sending the delivery: No connection to Takalex. It will be sent automatically when you are back online.";
    assert.deepEqual(submitOutcome(done("retrying"), row({ lastError: offline })), {
      tone: "info",
      text: `Saved on this phone, waiting to upload. ${offline}`,
    });
    assert.deepEqual(submitOutcome(done("failed"), row({ syncState: "failed", lastError: "Nope" })), {
      tone: "error",
      text: "Upload failed (see History): Nope",
    });
  });

  it("never claims an upload it did not see", () => {
    for (const summary of [
      { status: "idle" as const },
      { status: "signed_out" as const },
      { status: "session_error" as const, reason: "No connection." },
      { status: "done" as const, synced: ["other"], retrying: [], failed: [] },
    ]) {
      const outcome = submitOutcome(summary, row());
      assert.equal(outcome.tone, "info", JSON.stringify(summary));
      assert.match(outcome.text, /^Saved on this phone/);
    }
    assert.match(submitOutcome(done("synced"), null).text, /^Saved on this phone/);
  });
});

describe("syncNowOutcome", () => {
  it("summarises a run", () => {
    assert.deepEqual(syncNowOutcome({ status: "idle" }), { tone: "info", text: "Nothing waiting to upload." });
    assert.deepEqual(syncNowOutcome({ status: "done", synced: ["a"], retrying: [], failed: [] }), {
      tone: "success",
      text: "1 delivery uploaded.",
    });
    assert.deepEqual(syncNowOutcome({ status: "done", synced: ["a", "b"], retrying: ["c"], failed: ["d"] }), {
      tone: "error",
      text: "2 deliveries uploaded, 1 still waiting (it will retry), 1 failed (see History).",
    });
    assert.equal(syncNowOutcome({ status: "session_error", reason: "No connection." }).text, "No connection.");
  });
});

describe("planPhotoCleanup", () => {
  const live = `${PHOTO}.jpg`;
  const orphan = "dddddddd-dddd-4ddd-8ddd-000000000004.jpg";
  const leftover = "eeeeeeee-eeee-4eee-8eee-000000000005.jpg";

  it("deletes only unreferenced photos and synced leftovers", () => {
    const plan = planPhotoCleanup([live, orphan, leftover, "notes.txt", "ABC.JPG"], [
      { photoPath: `outbox/${live}`, syncState: "pending" },
      { photoPath: `outbox/${leftover}`, syncState: "synced" },
    ]);
    assert.deepEqual(plan, { orphans: [`outbox/${orphan}`], syncedLeftovers: [`outbox/${leftover}`] });
  });

  it("never deletes a photo of a pending or failed row (any user)", () => {
    const plan = planPhotoCleanup([live], [
      { photoPath: `outbox/${live}`, syncState: "failed" },
      // The same path also referenced by a synced row must still be kept.
      { photoPath: `outbox/${live}`, syncState: "synced" },
    ]);
    assert.deepEqual(plan, { orphans: [], syncedLeftovers: [] });
  });

  it("does nothing with no files", () => {
    assert.deepEqual(planPhotoCleanup([], []), { orphans: [], syncedLeftovers: [] });
  });
});
