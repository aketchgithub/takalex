// node --experimental-strip-types --test (npm run test:unit)
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  formatTotalKg,
  hasAnyMaterial,
  nairobiDate,
  presetRange,
  rangeLabel,
  totalKg,
  totalsHeading,
  type MaterialTotal,
} from "./model.ts";

const at = (iso: string) => new Date(iso);

describe("nairobiDate", () => {
  it("uses Nairobi (UTC+3) calendar days, whatever the phone's zone", () => {
    assert.equal(nairobiDate(at("2026-11-30T20:59:59Z")), "2026-11-30"); // 23:59:59 EAT
    assert.equal(nairobiDate(at("2026-11-30T21:00:00Z")), "2026-12-01"); // 00:00 EAT
    assert.equal(nairobiDate(at("2026-12-31T21:30:00Z")), "2027-01-01"); // new year in Nairobi first
  });
});

describe("presetRange", () => {
  it("All time has no bounds", () => {
    assert.deepEqual(presetRange("all", at("2026-11-10T09:00:00Z")), { from: null, to: null });
  });

  it("This month runs from the 1st of the Nairobi month to today", () => {
    assert.deepEqual(presetRange("month", at("2026-11-10T09:00:00Z")), { from: "2026-11-01", to: "2026-11-10" });
    // 30 Nov 22:00 UTC is already 1 Dec in Nairobi.
    assert.deepEqual(presetRange("month", at("2026-11-30T22:00:00Z")), { from: "2026-12-01", to: "2026-12-01" });
  });

  it("Last 30 days is today and the 29 days before, across month and year ends", () => {
    assert.deepEqual(presetRange("last30", at("2026-11-10T09:00:00Z")), { from: "2026-10-12", to: "2026-11-10" });
    assert.deepEqual(presetRange("last30", at("2027-01-05T09:00:00Z")), { from: "2026-12-07", to: "2027-01-05" });
    assert.deepEqual(presetRange("last30", at("2028-03-01T09:00:00Z")), { from: "2028-02-01", to: "2028-03-01" }); // leap year: 29 Feb counts
  });
});

describe("headings and range labels", () => {
  it("never reads as live stock", () => {
    assert.equal(totalsHeading("all"), "Approved, verified material (all time)");
    assert.equal(totalsHeading("month"), "Approved, verified material (this month)");
    assert.equal(totalsHeading("last30"), "Approved, verified material (last 30 days)");
  });

  it("describes the range in Nairobi time", () => {
    assert.equal(rangeLabel({ from: null, to: null }), "Every approved delivery so far.");
    assert.equal(rangeLabel({ from: "2026-11-01", to: "2026-11-10" }), "Verified 1 Nov 2026 to 10 Nov 2026 (Nairobi time).");
    assert.equal(rangeLabel({ from: "2026-12-01", to: "2026-12-01" }), "Verified on 1 Dec 2026 (Nairobi time).");
  });
});

describe("totals and formatting", () => {
  const rows = (weights: number[]): MaterialTotal[] =>
    weights.map((w, i) => ({ code: `M${i}`, displayName: `M${i}`, sortOrder: i, verifiedWeightKg: w }));

  it("sums exactly (no float drift)", () => {
    assert.equal(totalKg(rows([0.1, 0.2])), 0.3);
    assert.equal(totalKg(rows([120.5, 3.25, 0, 2.5])), 126.25);
    assert.equal(totalKg([]), 0);
  });

  it("formats kg with two decimals and thousands separators", () => {
    assert.equal(formatTotalKg(120.5), "120.50 kg");
    assert.equal(formatTotalKg(0), "0.00 kg");
    assert.equal(formatTotalKg(1234567.891), "1,234,567.89 kg");
    assert.equal(formatTotalKg(1000), "1,000.00 kg");
  });

  it("knows when there is nothing yet", () => {
    assert.equal(hasAnyMaterial(rows([0, 0])), false);
    assert.equal(hasAnyMaterial(rows([0, 0.01])), true);
  });
});
