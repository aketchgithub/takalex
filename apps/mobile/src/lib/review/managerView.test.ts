// node --experimental-strip-types --test (npm run test:unit)
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ManagerDelivery, ReviewedDelivery } from "./api.ts";
import { pendingLines, reviewedLines, sitesLine, waitingLabel } from "./managerView.ts";

const at = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min);
const now = at(2026, 11, 18, 13, 0);

const base: ManagerDelivery = {
  id: "d1",
  collectorId: "u1",
  collectorName: "Amina Wanjiku",
  siteId: "s1",
  siteName: "Njiru",
  materialCode: "PET",
  materialName: "PET",
  reportedWeightKg: 6.5,
  status: "pending",
  submittedAt: at(2026, 11, 18, 9, 14).toISOString(),
};

const reviewed = (over: Partial<ReviewedDelivery>): ReviewedDelivery => ({
  ...base,
  verifiedWeightKg: null,
  verifiedAt: at(2026, 11, 17, 16, 2).toISOString(),
  rejectionReason: null,
  items: [],
  ...over,
});

describe("list headings", () => {
  it("counts deliveries waiting", () => {
    assert.equal(waitingLabel(1), "1 delivery waiting for review");
    assert.equal(waitingLabel(0), "0 deliveries waiting for review");
    assert.equal(waitingLabel(3), "3 deliveries waiting for review");
  });
  it("lists the manager's sites", () => {
    assert.equal(sitesLine(["Njiru", "Kariobangi"]), "Your sites: Njiru, Kariobangi");
    assert.equal(sitesLine([]), null);
  });
});

describe("pendingLines", () => {
  it("shows what was reported, the site and when", () => {
    assert.deepEqual(pendingLines(base, now), ["PET · 6.50 kg reported", "Njiru · Today, 09:14"]);
  });
  it("falls back to the code and an unknown site", () => {
    assert.deepEqual(pendingLines({ ...base, materialName: null, siteName: null }, now), [
      "PET · 6.50 kg reported",
      "Unknown site · Today, 09:14",
    ]);
  });
});

describe("reviewedLines", () => {
  it("lists each verified material with the total", () => {
    const delivery = reviewed({
      status: "approved",
      verifiedWeightKg: 6.25,
      items: [
        { materialCode: "PET", materialName: "PET", weightKg: 4 },
        { materialCode: "HDPE", materialName: null, weightKg: 2.25 },
      ],
    });
    assert.deepEqual(reviewedLines(delivery, now), [
      "PET · 6.50 kg reported",
      "Verified: PET 4.00 kg, HDPE 2.25 kg (total 6.25 kg)",
      "Njiru · reviewed Yesterday, 16:02",
    ]);
  });
  it("gives the reason for a rejection", () => {
    const delivery = reviewed({ status: "rejected", rejectionReason: " wet and dirty " });
    assert.deepEqual(reviewedLines(delivery, now), [
      "PET · 6.50 kg reported",
      "Reason: wet and dirty",
      "Njiru · reviewed Yesterday, 16:02",
    ]);
  });
  it("uses the submit time when no review time is known", () => {
    const delivery = reviewed({ status: "rejected", verifiedAt: null });
    assert.deepEqual(reviewedLines(delivery, now), ["PET · 6.50 kg reported", "Njiru · submitted Today, 09:14"]);
  });
});
