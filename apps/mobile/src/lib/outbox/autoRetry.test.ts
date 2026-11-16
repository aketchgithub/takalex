// node --experimental-strip-types --test (npm run test:unit)
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AUTO_RETRY_INTERVAL_MS, countRetryable, shouldAutoRetry, shouldStartTick } from "./autoRetry.ts";

const COLLECTOR = "11111111-1111-4111-8111-111111111111";

describe("countRetryable", () => {
  it("counts waiting deliveries, not permanent failures or synced rows", () => {
    assert.equal(countRetryable([]), 0);
    assert.equal(
      countRetryable([
        { syncState: "pending" },
        { syncState: "failed" },
        { syncState: "pending" },
        { syncState: "synced" },
      ]),
      2,
    );
    assert.equal(countRetryable([{ syncState: "failed" }]), 0);
  });
});

describe("shouldAutoRetry", () => {
  const on = { collectorId: COLLECTOR, appState: "active", retryableCount: 1 };

  it("runs for a signed-in collector in the foreground with a delivery waiting", () => {
    assert.equal(AUTO_RETRY_INTERVAL_MS, 30_000);
    assert.equal(shouldAutoRetry(on), true);
    assert.equal(shouldAutoRetry({ ...on, retryableCount: 7 }), true);
  });

  it("stops when nothing is waiting", () => {
    assert.equal(shouldAutoRetry({ ...on, retryableCount: 0 }), false);
  });

  it("stops in the background", () => {
    assert.equal(shouldAutoRetry({ ...on, appState: "background" }), false);
    assert.equal(shouldAutoRetry({ ...on, appState: "inactive" }), false);
  });

  it("stops on sign-out or for a user who is not an active collector", () => {
    assert.equal(shouldAutoRetry({ ...on, collectorId: null }), false);
  });
});

describe("shouldStartTick", () => {
  it("skips a tick while the previous tick's sync is still running", () => {
    assert.equal(shouldStartTick({ enabled: true, tickInFlight: false }), true);
    assert.equal(shouldStartTick({ enabled: true, tickInFlight: true }), false);
    assert.equal(shouldStartTick({ enabled: false, tickInFlight: false }), false);
  });
});
