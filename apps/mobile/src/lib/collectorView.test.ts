// node --experimental-strip-types --test (npm run test:unit)
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  deliveryDetail,
  deliveryPillLabel,
  deliveryTitle,
  firstName,
  friendlyDateTime,
  greeting,
  recentDeliveries,
} from "./collectorView.ts";
import type { ServerDelivery } from "./outbox/presentation.ts";

// Local times, so the tests pass in any time zone.
const at = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min);

const delivery = (over: Partial<ServerDelivery> = {}): ServerDelivery => ({
  id: "d1",
  clientRecordId: "c1",
  materialCode: "PET",
  materialName: "PET",
  reportedWeightKg: 6.5,
  verifiedWeightKg: null,
  status: "pending",
  rejectionReason: null,
  submittedAt: at(2026, 11, 18, 9, 14).toISOString(),
  ...over,
});

describe("greeting", () => {
  it("follows the time of day", () => {
    assert.equal(greeting(at(2026, 11, 18, 0, 5)), "Good morning");
    assert.equal(greeting(at(2026, 11, 18, 11, 59)), "Good morning");
    assert.equal(greeting(at(2026, 11, 18, 12, 0)), "Good afternoon");
    assert.equal(greeting(at(2026, 11, 18, 16, 59)), "Good afternoon");
    assert.equal(greeting(at(2026, 11, 18, 17, 0)), "Good evening");
  });
});

describe("firstName", () => {
  it("takes the first word, or null", () => {
    assert.equal(firstName("  Amina Wanjiku "), "Amina");
    assert.equal(firstName(""), null);
    assert.equal(firstName(null), null);
  });
});

describe("friendlyDateTime", () => {
  const now = at(2026, 11, 18, 13, 0);
  it("says Today and Yesterday", () => {
    assert.equal(friendlyDateTime(at(2026, 11, 18, 9, 4).toISOString(), now), "Today, 09:04");
    assert.equal(friendlyDateTime(at(2026, 11, 17, 23, 59).toISOString(), now), "Yesterday, 23:59");
  });
  it("gives the date otherwise, with the year only for another year", () => {
    assert.equal(friendlyDateTime(at(2026, 11, 14, 11, 30).toISOString(), now), "14 Nov, 11:30");
    assert.equal(friendlyDateTime(at(2025, 12, 31, 8, 0).toISOString(), now), "31 Dec 2025, 08:00");
  });
  it("returns unreadable input as it is", () => {
    assert.equal(friendlyDateTime("not a date", now), "not a date");
  });
});

describe("delivery wording", () => {
  const now = at(2026, 11, 18, 13, 0);
  it("titles material and weight with two decimals", () => {
    assert.equal(deliveryTitle("PET", 6.5), "PET · 6.50 kg");
    assert.equal(deliveryTitle("HDPE", "3.2"), "HDPE · 3.20 kg");
  });
  it("uses short pill labels", () => {
    assert.equal(deliveryPillLabel("pending"), "Pending review");
    assert.equal(deliveryPillLabel("approved"), "Approved");
    assert.equal(deliveryPillLabel("rejected"), "Rejected");
  });
  it("adds the verified weight or the rejection reason", () => {
    assert.equal(deliveryDetail(delivery(), now), "Today, 09:14");
    assert.equal(
      deliveryDetail(delivery({ status: "approved", verifiedWeightKg: 11.4 }), now),
      "Today, 09:14 · verified 11.40 kg",
    );
    assert.equal(
      deliveryDetail(delivery({ status: "rejected", rejectionReason: " wet and dirty " }), now),
      "Today, 09:14 · wet and dirty",
    );
    assert.equal(deliveryDetail(delivery({ status: "rejected", rejectionReason: " " }), now), "Today, 09:14");
  });
  it("keeps the newest three for Home", () => {
    const list = ["a", "b", "c", "d"].map((id) => delivery({ id }));
    assert.deepEqual(
      recentDeliveries(list).map((d) => d.id),
      ["a", "b", "c"],
    );
  });
});
