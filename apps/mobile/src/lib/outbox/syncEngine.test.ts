/// <reference types="node" />
// node --experimental-strip-types --test (npm run test:unit)
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { singleFlight, syncOutbox } from "./syncEngine.ts";
import type {
  CollectionInsert,
  EvidenceInsert,
  OutboxRow,
  RemoteError,
  RemoteResult,
  SyncDeps,
} from "./types.ts";

const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const SITE = "33333333-3333-4333-8333-333333333333";

let counter = 0;
function makeRow(overrides: Partial<OutboxRow> = {}): OutboxRow {
  counter += 1;
  const n = String(counter).padStart(12, "0");
  return {
    clientRecordId: `aaaaaaaa-aaaa-4aaa-8aaa-${n}`,
    userId: ME,
    siteId: SITE,
    materialCode: "PET",
    reportedWeightKg: "12.50",
    capturedAt: "2026-11-08T08:00:00.000Z",
    deviceLatitude: -1.28,
    deviceLongitude: 36.82,
    deviceAccuracyM: 12,
    photoUuid: `bbbbbbbb-bbbb-4bbb-8bbb-${n}`,
    photoPath: `outbox/bbbbbbbb-bbbb-4bbb-8bbb-${n}.jpg`,
    syncState: "pending",
    syncStep: "record",
    collectionId: null,
    attemptCount: 0,
    lastError: null,
    createdAt: "2026-11-08T08:00:00.000Z",
    updatedAt: "2026-11-08T08:00:00.000Z",
    lastAttemptAt: null,
    syncedAt: null,
    ...overrides,
  };
}

const NETWORK: RemoteError = { message: "TypeError: Network request failed", status: 0, code: "" };
const SERVER_503: RemoteError = { message: "Service Unavailable", status: 503 };
const DUPLICATE_ROW: RemoteError = { message: "duplicate key value violates unique constraint", status: 409, code: "23505" };
const RLS: RemoteError = { message: "new row violates row-level security policy", status: 403, code: "42501" };
const CHECK: RemoteError = { message: "violates check constraint", status: 400, code: "23514" };

type Step = "insertCollection" | "findCollectionId" | "uploadPhoto" | "insertEvidence";

// Server state: what actually exists remotely, so duplicates are real.
class FakeServer {
  collections = new Map<string, { id: string; userId: string; row: CollectionInsert }>();
  objects = new Map<string, number>();
  evidence = new Map<string, EvidenceInsert>();
  calls: Step[] = [];
  // Errors to return (once each, in order) per step; "throw" throws instead.
  failures: Partial<Record<Step, (RemoteError | "throw")[]>> = {};
  // Apply the write but report a failure (response lost after the write).
  lostResponse: Partial<Record<Step, boolean>> = {};
  private nextId = 0;

  private takeFailure(step: Step): RemoteError | null {
    const queue = this.failures[step];
    const next = queue?.shift();
    if (next === "throw") throw new TypeError("Network request failed");
    return next ?? null;
  }

  private lost(step: Step): RemoteResult | null {
    if (!this.lostResponse[step]) return null;
    this.lostResponse[step] = false;
    return { error: SERVER_503 };
  }

  remote(userId: string): SyncDeps["remote"] {
    return {
      insertCollection: async (row) => {
        this.calls.push("insertCollection");
        const failure = this.takeFailure("insertCollection");
        if (failure) return { error: failure };
        const key = `${userId}/${row.client_record_id}`;
        if (this.collections.has(key)) return { error: DUPLICATE_ROW };
        this.nextId += 1;
        this.collections.set(key, { id: `col-${this.nextId}`, userId, row });
        return this.lost("insertCollection") ?? { error: null };
      },
      findCollectionId: async (uid, clientRecordId) => {
        this.calls.push("findCollectionId");
        const failure = this.takeFailure("findCollectionId");
        if (failure) return { id: null, error: failure };
        return { id: this.collections.get(`${uid}/${clientRecordId}`)?.id ?? null, error: null };
      },
      uploadPhoto: async (path, body) => {
        this.calls.push("uploadPhoto");
        const failure = this.takeFailure("uploadPhoto");
        if (failure) return { error: failure };
        if (this.objects.has(path)) {
          return { error: { message: "The resource already exists", status: 409, statusCode: "409" } };
        }
        this.objects.set(path, body.byteLength);
        return this.lost("uploadPhoto") ?? { error: null };
      },
      insertEvidence: async (row) => {
        this.calls.push("insertEvidence");
        const failure = this.takeFailure("insertEvidence");
        if (failure) return { error: failure };
        if (this.evidence.has(row.storage_path)) return { error: DUPLICATE_ROW };
        this.evidence.set(row.storage_path, row);
        return this.lost("insertEvidence") ?? { error: null };
      },
    };
  }
}

class FakeDevice {
  rows = new Map<string, OutboxRow>();
  photos = new Set<string>();
  // Every photo deletion, with the row's state at that moment.
  deletions: { path: string; stateAtDeletion: string }[] = [];
  private tick = 0;

  add(row: OutboxRow): OutboxRow {
    this.rows.set(row.clientRecordId, { ...row });
    if (row.photoPath) this.photos.add(row.photoPath);
    return row;
  }

  get(id: string): OutboxRow {
    const row = this.rows.get(id);
    assert.ok(row, `row ${id} missing`);
    return row;
  }

  private patch(id: string, changes: Partial<OutboxRow>, at: string) {
    this.rows.set(id, { ...this.get(id), ...changes, updatedAt: at });
  }

  now = () => {
    this.tick += 1;
    return new Date(Date.UTC(2026, 10, 8, 9, 0, this.tick)).toISOString();
  };

  // Deliberately returns EVERY pending row, whoever owns it, to prove the
  // engine filters by user itself.
  store: SyncDeps["store"] = {
    listSyncable: async () =>
      [...this.rows.values()].filter((r) => r.syncState === "pending").map((r) => ({ ...r })),
    recordAttempt: async (id, at) =>
      this.patch(id, { attemptCount: this.get(id).attemptCount + 1, lastAttemptAt: at }, at),
    saveProgress: async (id, progress, at) => this.patch(id, progress, at),
    markRetryable: async (id, reason, at) => this.patch(id, { syncState: "pending", lastError: reason }, at),
    markFailed: async (id, reason, at) => this.patch(id, { syncState: "failed", lastError: reason }, at),
    markSynced: async (id, at) =>
      this.patch(id, { syncState: "synced", syncStep: "done", lastError: null, syncedAt: at }, at),
    clearPhotoPath: async (id, at) => this.patch(id, { photoPath: null }, at),
  };

  files: SyncDeps["files"] = {
    read: async (path) => {
      if (!this.photos.has(path)) throw new Error("ENOENT");
      return new ArrayBuffer(1024);
    },
    remove: async (path) => {
      const owner = [...this.rows.values()].find((r) => r.photoPath === path);
      this.deletions.push({ path, stateAtDeletion: owner?.syncState ?? "unknown" });
      this.photos.delete(path);
    },
  };
}

function setup(sessionUserId: string | null = ME) {
  const server = new FakeServer();
  const device = new FakeDevice();
  let refreshes = 0;
  const deps = (userId = ME): SyncDeps => ({
    store: device.store,
    remote: server.remote(userId),
    files: device.files,
    session: {
      ensureFresh: async () => {
        refreshes += 1;
        return { userId: sessionUserId, error: null };
      },
    },
    now: device.now,
  });
  return { server, device, deps, refreshes: () => refreshes };
}

function assertFullySynced(server: FakeServer, device: FakeDevice, row: OutboxRow) {
  const local = device.get(row.clientRecordId);
  assert.equal(local.syncState, "synced");
  assert.equal(local.syncStep, "done");
  assert.equal(local.lastError, null);
  assert.equal(local.photoPath, null);
  assert.equal(device.photos.has(row.photoPath ?? ""), false);
  assert.equal(server.collections.size, 1);
  const path = `${ME}/${row.clientRecordId}/${row.photoUuid}.jpg`;
  assert.ok(server.objects.has(path));
  assert.equal(server.evidence.size, 1);
  assert.equal(server.evidence.get(path)?.collection_id, local.collectionId);
}

describe("syncOutbox", () => {
  it("first sync: inserts the record, uploads the photo, adds evidence, marks synced, deletes the photo", async () => {
    const { server, device, deps } = setup();
    const row = device.add(makeRow());

    const summary = await syncOutbox(deps(), ME);

    assert.deepEqual(summary, { status: "done", synced: [row.clientRecordId], retrying: [], failed: [] });
    assert.deepEqual(server.calls, ["insertCollection", "findCollectionId", "uploadPhoto", "insertEvidence"]);
    assertFullySynced(server, device, row);

    // Only granted columns are sent.
    const sent = [...server.collections.values()][0].row;
    assert.deepEqual(Object.keys(sent).sort(), [
      "captured_at",
      "client_record_id",
      "device_accuracy_m",
      "device_latitude",
      "device_longitude",
      "material_code",
      "reported_weight_kg",
      "site_id",
    ]);
    assert.equal(sent.reported_weight_kg, "12.50");

    const evidence = [...server.evidence.values()][0];
    assert.deepEqual(Object.keys(evidence).sort(), ["captured_at", "collection_id", "content_type", "storage_path"]);
    assert.equal(evidence.content_type, "image/jpeg");
    assert.equal(device.get(row.clientRecordId).attemptCount, 1);
  });

  it("does nothing (and does not touch the session) when there is nothing to sync", async () => {
    const { server, deps, refreshes } = setup();
    assert.deepEqual(await syncOutbox(deps(), ME), { status: "idle" });
    assert.equal(refreshes(), 0);
    assert.deepEqual(server.calls, []);
  });

  it("refreshes the session before any request", async () => {
    const { device, deps, refreshes } = setup();
    device.add(makeRow());
    await syncOutbox(deps(), ME);
    assert.equal(refreshes(), 1);
  });

  for (const [step, failure] of [
    ["insertCollection", NETWORK],
    ["findCollectionId", SERVER_503],
    ["uploadPhoto", NETWORK],
    ["insertEvidence", SERVER_503],
  ] as const) {
    it(`retries after a retryable failure at ${step}`, async () => {
      const { server, device, deps } = setup();
      const row = device.add(makeRow());
      server.failures[step] = [failure];

      const first = await syncOutbox(deps(), ME);
      assert.equal(first.status, "done");
      assert.deepEqual(first.status === "done" && first.retrying, [row.clientRecordId]);
      const afterFailure = device.get(row.clientRecordId);
      assert.equal(afterFailure.syncState, "pending");
      assert.match(afterFailure.lastError ?? "", /will be (retried|sent automatically)/);
      // The photo is kept until success.
      assert.ok(device.photos.has(row.photoPath ?? ""));
      assert.equal(device.deletions.length, 0);

      const second = await syncOutbox(deps(), ME);
      assert.deepEqual(second.status === "done" && second.synced, [row.clientRecordId]);
      assertFullySynced(server, device, row);
      assert.equal(device.get(row.clientRecordId).attemptCount, 2);
    });
  }

  it("retries when the request throws instead of returning an error", async () => {
    const { server, device, deps } = setup();
    const row = device.add(makeRow());
    server.failures.uploadPhoto = ["throw"];

    await syncOutbox(deps(), ME);
    assert.equal(device.get(row.clientRecordId).syncState, "pending");
    assert.match(device.get(row.clientRecordId).lastError ?? "", /^Uploading the photo: No connection/);

    await syncOutbox(deps(), ME);
    assertFullySynced(server, device, row);
  });

  it("resumes from the failed step, not from the start", async () => {
    const { server, device, deps } = setup();
    const row = device.add(makeRow());
    server.failures.insertEvidence = [NETWORK];

    await syncOutbox(deps(), ME);
    assert.equal(device.get(row.clientRecordId).syncStep, "evidence");
    server.calls = [];

    await syncOutbox(deps(), ME);
    assert.deepEqual(server.calls, ["insertEvidence"]);
    assertFullySynced(server, device, row);
  });

  for (const step of ["insertCollection", "uploadPhoto", "insertEvidence"] as const) {
    it(`treats a duplicate as success when ${step} succeeded but its response was lost`, async () => {
      const { server, device, deps } = setup();
      const row = device.add(makeRow());
      server.lostResponse[step] = true;

      await syncOutbox(deps(), ME);
      assert.equal(device.get(row.clientRecordId).syncState, "pending");

      await syncOutbox(deps(), ME);
      assertFullySynced(server, device, row);
    });
  }

  it("treats every step as already done when the row was synced but the device crashed before marking it", async () => {
    const { server, device, deps } = setup();
    const row = device.add(makeRow());
    await syncOutbox(deps(), ME);
    assertFullySynced(server, device, row);

    // Simulate the crash: the same row is pending again from the start.
    device.add({ ...row, photoPath: row.photoPath });
    server.calls = [];
    const summary = await syncOutbox(deps(), ME);

    assert.deepEqual(summary.status === "done" && summary.synced, [row.clientRecordId]);
    assert.deepEqual(server.calls, ["insertCollection", "findCollectionId", "uploadPhoto", "insertEvidence"]);
    assertFullySynced(server, device, row);
  });

  for (const [step, failure, label] of [
    ["insertCollection", RLS, "Sending the delivery: Not allowed by the server"],
    ["insertCollection", CHECK, "Sending the delivery: Rejected by the server"],
    ["uploadPhoto", { message: "new row violates row-level security policy", status: 403, statusCode: "403" }, "Uploading the photo: Not allowed"],
    ["uploadPhoto", { message: "Payload too large", status: 413, statusCode: "413" }, "Uploading the photo: Rejected"],
    ["insertEvidence", RLS, "Attaching the photo: Not allowed"],
  ] as const) {
    it(`marks the row failed on a permanent error at ${step} (${failure.code ?? failure.status})`, async () => {
      const { server, device, deps } = setup();
      const row = device.add(makeRow());
      server.failures[step] = [failure];

      const summary = await syncOutbox(deps(), ME);
      assert.deepEqual(summary.status === "done" && summary.failed, [row.clientRecordId]);
      const local = device.get(row.clientRecordId);
      assert.equal(local.syncState, "failed");
      assert.ok(local.lastError?.startsWith(label), local.lastError ?? "");
      assert.ok(local.lastError?.includes(failure.message));
      // Kept, with its photo, and not retried by later runs.
      assert.ok(device.photos.has(row.photoPath ?? ""));
      server.calls = [];
      assert.deepEqual(await syncOutbox(deps(), ME), { status: "idle" });
      assert.deepEqual(server.calls, []);
    });
  }

  it("marks the row failed when its photo file is missing", async () => {
    const { server, device, deps } = setup();
    const row = device.add(makeRow());
    device.photos.clear();

    await syncOutbox(deps(), ME);
    const local = device.get(row.clientRecordId);
    assert.equal(local.syncState, "failed");
    assert.equal(local.lastError, "Uploading the photo: The photo is no longer on this device.");
    assert.equal(server.objects.size, 0);
  });

  it("ignores rows of another user even when the store returns them", async () => {
    const { server, device, deps } = setup();
    const mine = device.add(makeRow());
    const theirs = device.add(makeRow({ userId: OTHER }));

    const summary = await syncOutbox(deps(), ME);

    assert.deepEqual(summary.status === "done" && summary.synced, [mine.clientRecordId]);
    const other = device.get(theirs.clientRecordId);
    assert.equal(other.syncState, "pending");
    assert.equal(other.attemptCount, 0);
    assert.ok(device.photos.has(theirs.photoPath ?? ""));
    assert.equal(server.collections.size, 1);
    assert.ok(![...server.objects.keys()].some((path) => path.includes(theirs.clientRecordId)));
  });

  it("sends nothing when the session belongs to someone else or nobody", async () => {
    for (const sessionUser of [OTHER, null]) {
      const { server, device, deps } = setup(sessionUser);
      const row = device.add(makeRow());
      assert.deepEqual(await syncOutbox(deps(), ME), { status: "signed_out" });
      assert.deepEqual(server.calls, []);
      assert.equal(device.get(row.clientRecordId).attemptCount, 0);
    }
  });

  it("leaves rows untouched when the session refresh fails", async () => {
    const { server, device } = setup();
    const row = device.add(makeRow());
    const summary = await syncOutbox(
      {
        store: device.store,
        remote: server.remote(ME),
        files: device.files,
        session: { ensureFresh: async () => ({ userId: null, error: NETWORK }) },
        now: device.now,
      },
      ME,
    );
    assert.equal(summary.status, "session_error");
    assert.deepEqual(server.calls, []);
    assert.equal(device.get(row.clientRecordId).attemptCount, 0);
    assert.equal(device.get(row.clientRecordId).lastError, null);
  });

  it("deletes the photo only after the row is marked synced, never on failure", async () => {
    const { server, device, deps } = setup();
    const ok = device.add(makeRow());
    const retry = device.add(makeRow());
    const broken = device.add(makeRow());
    server.failures.insertCollection = [];
    // ok succeeds; retry fails at upload (retryable); broken fails at evidence (permanent).
    const remote = server.remote(ME);
    const failing: SyncDeps["remote"] = {
      ...remote,
      uploadPhoto: async (path, body) =>
        path.includes(retry.clientRecordId) ? { error: NETWORK } : remote.uploadPhoto(path, body),
      insertEvidence: async (row) =>
        row.storage_path.includes(broken.clientRecordId) ? { error: RLS } : remote.insertEvidence(row),
    };

    await syncOutbox({ ...deps(), remote: failing }, ME);

    assert.deepEqual(device.deletions, [{ path: ok.photoPath, stateAtDeletion: "synced" }]);
    assert.ok(device.photos.has(retry.photoPath ?? ""));
    assert.ok(device.photos.has(broken.photoPath ?? ""));
    assert.equal(device.get(retry.clientRecordId).syncState, "pending");
    assert.equal(device.get(broken.clientRecordId).syncState, "failed");
  });

  it("keeps the row synced when deleting the photo fails", async () => {
    const { device, deps } = setup();
    const row = device.add(makeRow());
    const summary = await syncOutbox(
      { ...deps(), files: { ...device.files, remove: async () => { throw new Error("EBUSY"); } } },
      ME,
    );
    assert.deepEqual(summary.status === "done" && summary.synced, [row.clientRecordId]);
    const local = device.get(row.clientRecordId);
    assert.equal(local.syncState, "synced");
    assert.equal(local.photoPath, row.photoPath);
  });
});

describe("singleFlight", () => {
  it("never runs twice at once and queues exactly one rerun", async () => {
    let active = 0;
    let maxActive = 0;
    let runs = 0;
    let release: () => void = () => undefined;
    const run = singleFlight(async () => {
      runs += 1;
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      active -= 1;
      return runs;
    });

    const first = run();
    const second = run();
    const third = run();
    assert.equal(second, third);
    release();
    assert.equal(await first, 1);
    await new Promise((resolve) => setImmediate(resolve));
    release();
    assert.equal(await second, 2);
    assert.equal(runs, 2);
    assert.equal(maxActive, 1);
  });
});
