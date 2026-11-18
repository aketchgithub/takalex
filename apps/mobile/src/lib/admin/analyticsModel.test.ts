// node --experimental-strip-types --test (npm run test:unit)
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  deliveriesLabel,
  fractionOfMax,
  monthLabel,
  monthsStart,
  percentages,
  rangeLabel,
  weekRange,
} from "./analyticsModel.ts";

describe("weekRange", () => {
  it("runs from Monday to today for this week", () => {
    assert.deepEqual(weekRange("this", "2026-12-02"), { from: "2026-11-30", to: "2026-12-02" }); // Wednesday
    assert.deepEqual(weekRange("this", "2026-11-30"), { from: "2026-11-30", to: "2026-11-30" }); // Monday
    assert.deepEqual(weekRange("this", "2026-12-06"), { from: "2026-11-30", to: "2026-12-06" }); // Sunday
  });
  it("gives the whole previous Monday-Sunday for last week", () => {
    assert.deepEqual(weekRange("last", "2026-12-02"), { from: "2026-11-23", to: "2026-11-29" });
    assert.deepEqual(weekRange("last", "2026-11-30"), { from: "2026-11-23", to: "2026-11-29" });
    assert.deepEqual(weekRange("last", "2027-01-01"), { from: "2026-12-21", to: "2026-12-27" });
  });
});

describe("labels", () => {
  it("words a date range", () => {
    assert.equal(rangeLabel({ from: "2026-11-30", to: "2026-12-06" }), "30 Nov – 6 Dec");
    assert.equal(rangeLabel({ from: "2026-12-07", to: "2026-12-13" }), "7–13 Dec");
    assert.equal(rangeLabel({ from: "2026-11-30", to: "2026-11-30" }), "30 Nov");
  });
  it("names months and deliveries", () => {
    assert.equal(monthLabel("2026-11-01"), "Nov");
    assert.equal(monthLabel("2027-01-01"), "Jan");
    assert.equal(deliveriesLabel(1), "1 delivery");
    assert.equal(deliveriesLabel(0), "0 deliveries");
  });
});

describe("monthsStart", () => {
  it("goes back whole months, across years", () => {
    assert.equal(monthsStart("2026-11-18", 3), "2026-09-01");
    assert.equal(monthsStart("2026-11-18", 1), "2026-11-01");
    assert.equal(monthsStart("2027-01-05", 3), "2026-11-01");
    assert.equal(monthsStart("2027-02-28", 3), "2026-12-01");
  });
});

describe("chart arithmetic", () => {
  it("sizes bars against the largest value", () => {
    assert.equal(fractionOfMax(5, [10, 5, 0]), 0.5);
    assert.equal(fractionOfMax(10, [10, 5, 0]), 1);
    assert.equal(fractionOfMax(0, [0, 0]), 0);
  });
  it("gives whole percentages that add up to 100", () => {
    assert.deepEqual(percentages([7, 4.25, 4, 2.5, 2]), [35, 22, 20, 13, 10]); // 35.4, 21.5, 20.3, 12.7, 10.1
    assert.deepEqual(percentages([1, 1, 1]), [34, 33, 33]);
    assert.deepEqual(percentages([5]), [100]);
    assert.deepEqual(percentages([0, 0]), [0, 0]);
    for (const values of [[1, 2, 3], [0.01, 999.99], [3.33, 3.33, 3.34]]) {
      assert.equal(percentages(values).reduce((a, b) => a + b, 0), 100, String(values));
    }
  });
});
