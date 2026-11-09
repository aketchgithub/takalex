// node --experimental-strip-types --test (npm run test:unit)
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  centsToText,
  checkBreakdown,
  checkRejectionReason,
  collectorLabel,
  deviceLocationLabel,
  reviewErrorMessage,
  unusedMaterials,
  weightForRpc,
  type BreakdownLine,
  type VerifiableMaterial,
} from "./model.ts";
import { normalizeReportedWeight } from "../outbox/validation.ts";

// Active + verifiable only, as the screen loads them (MIXED is never here).
const MATERIALS: VerifiableMaterial[] = [
  { code: "PET", displayName: "PET" },
  { code: "PP", displayName: "PP" },
  { code: "PLASTIC_BAGS", displayName: "Plastic bags" },
];

let n = 0;
function line(materialCode: string | null, weightText: string): BreakdownLine {
  n += 1;
  return { key: `k${n}`, materialCode, weightText };
}

describe("checkBreakdown: valid breakdowns", () => {
  it("accepts a two-line breakdown and sums it exactly", () => {
    const check = checkBreakdown([line("PET", "3"), line("PLASTIC_BAGS", "2.5")], MATERIALS);
    assert.equal(check.formError, null);
    assert.deepEqual(check.lineErrors, [{}, {}]);
    assert.equal(check.totalText, "5.50");
    assert.equal(check.countedLines, 2);
    assert.deepEqual(check.items, [
      { material_code: "PET", weight_kg: 3 },
      { material_code: "PLASTIC_BAGS", weight_kg: 2.5 },
    ]);
  });

  it("has no float drift in the total (0.1 + 0.2 = 0.30)", () => {
    assert.equal(checkBreakdown([line("PET", "0.1"), line("PP", "0.2")], MATERIALS).totalText, "0.30");
    assert.equal(
      checkBreakdown([line("PET", "1.10"), line("PP", "2.20"), line("PLASTIC_BAGS", "3,30")], MATERIALS).totalText,
      "6.60",
    );
  });

  it("accepts the largest total the database allows", () => {
    const check = checkBreakdown([line("PET", "99999999.98"), line("PP", "0.01")], MATERIALS);
    assert.equal(check.totalText, "99999999.99");
    assert.ok(check.items);
  });
});

describe("checkBreakdown: refusals", () => {
  it("requires at least one line", () => {
    const check = checkBreakdown([], MATERIALS);
    assert.equal(check.formError, "Add at least one material line to approve.");
    assert.equal(check.items, null);
    assert.equal(check.totalText, "0.00");
  });

  it("requires a material on each line", () => {
    const check = checkBreakdown([line(null, "2")], MATERIALS);
    assert.equal(check.lineErrors[0].material, "Choose a material.");
    assert.equal(check.items, null);
  });

  it("refuses a material that is not active and verifiable (e.g. MIXED)", () => {
    const check = checkBreakdown([line("MIXED", "2")], MATERIALS);
    assert.match(check.lineErrors[0].material ?? "", /cannot be used/);
    assert.equal(check.items, null);
  });

  it("refuses duplicates on the second occurrence only", () => {
    const check = checkBreakdown([line("PET", "1"), line("PET", "2")], MATERIALS);
    assert.deepEqual(check.lineErrors[0], {});
    assert.equal(check.lineErrors[1].material, "This material is already in the breakdown.");
    assert.equal(check.items, null);
  });

  it("refuses zero, negative, more than 2 decimals, too many digits and junk", () => {
    for (const bad of ["0", "0.00", "-1", "1.234", "abc", "1e3", "123456789", ".5", "5."]) {
      const check = checkBreakdown([line("PET", bad)], MATERIALS);
      assert.match(check.lineErrors[0].weight ?? "", /above 0 with at most 2 decimals/, bad);
      assert.equal(check.items, null, bad);
    }
    assert.equal(checkBreakdown([line("PET", "  ")], MATERIALS).lineErrors[0].weight, "Enter the weight in kg.");
  });

  it("totals only the valid weights while the manager is still typing", () => {
    const check = checkBreakdown([line("PET", "3.25"), line("PP", "1.234"), line(null, "1")], MATERIALS);
    assert.equal(check.totalText, "4.25");
    assert.equal(check.countedLines, 2);
    assert.equal(check.items, null);
  });

  it("refuses a total above NUMERIC(10,2)", () => {
    const check = checkBreakdown([line("PET", "99999999.99"), line("PP", "0.01")], MATERIALS);
    assert.equal(check.formError, "The verified total is too large.");
    assert.equal(check.items, null);
  });
});

describe("weightForRpc: the value reaches review_collection unchanged", () => {
  // What Postgres receives is the JSON text; parse it back as an exact
  // decimal (string arithmetic, no floats) and compare with the typed value.
  function exactCents(jsonNumberText: string): bigint {
    assert.match(jsonNumberText, /^\d+(\.\d{1,2})?$/, `not a plain decimal: ${jsonNumberText}`);
    const [whole, fraction = ""] = jsonNumberText.split(".");
    return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  }

  function roundTrips(input: string): void {
    const normalized = normalizeReportedWeight(input);
    assert.ok(normalized, input);
    const json = JSON.stringify({ weight_kg: weightForRpc(normalized) });
    const text = /"weight_kg":(.*)}/.exec(json)?.[1] ?? "";
    assert.equal(exactCents(text), exactCents(normalized), `${input} -> ${json}`);
    assert.equal(typeof JSON.parse(json).weight_kg, "number");
  }

  it("for typical and awkward values", () => {
    for (const v of ["3.10", "0.01", "0.1", "0.3", "1.15", "2.675", "1.005"].filter((s) => normalizeReportedWeight(s))) {
      roundTrips(v);
    }
    for (const v of ["99999999.99", "12345678.91", "10000000.01", "4503599.63", "7"]) roundTrips(v);
  });

  it("for every value from 0.01 to 1000.00", () => {
    for (let cents = 1; cents <= 100_000; cents += 1) roundTrips(centsToText(cents));
  });

  it("for the top of the range", () => {
    for (let cents = 9_999_999_999; cents > 9_999_999_999 - 20_000; cents -= 1) roundTrips(centsToText(cents));
  });

  it("for 20,000 pseudo-random values across the range", () => {
    // Deterministic LCG; every intermediate stays below 2^53 (exact integers).
    let seed = 42;
    const next = () => (seed = (seed * 48271) % 2147483647);
    for (let i = 0; i < 20_000; i += 1) {
      const cents = 1 + (((next() % 4657) * 2147483648 + next()) % 9_999_999_999);
      roundTrips(centsToText(cents));
    }
  });
});

describe("unusedMaterials", () => {
  it("offers only materials not yet in the breakdown", () => {
    assert.deepEqual(
      unusedMaterials([line("PET", "1"), line(null, "")], MATERIALS).map((m) => m.code),
      ["PP", "PLASTIC_BAGS"],
    );
  });
});

describe("checkRejectionReason", () => {
  it("requires a non-blank reason and trims it", () => {
    assert.deepEqual(checkRejectionReason("   "), { reason: null, error: "Enter a reason for rejecting." });
    assert.deepEqual(checkRejectionReason("  Wet bags "), { reason: "Wet bags", error: null });
  });
});

describe("reviewErrorMessage", () => {
  it("shows review_collection's own message", () => {
    assert.equal(
      reviewErrorMessage({ code: "P0001", message: "Only pending collections can be reviewed", status: 400 }),
      "Not saved: Only pending collections can be reviewed.",
    );
    assert.equal(
      reviewErrorMessage({ code: "P0001", message: "At least one photo evidence record is required for approval", status: 400 }),
      "Not saved: At least one photo evidence record is required for approval.",
    );
  });

  it("explains connection and permission failures", () => {
    assert.match(reviewErrorMessage({ message: "TypeError: Network request failed", status: 0 }), /no connection/);
    assert.match(reviewErrorMessage(null), /no connection/);
    assert.match(reviewErrorMessage({ message: "permission denied", code: "42501", status: 403 }), /not allowed/);
    assert.equal(reviewErrorMessage({ message: "Bad Gateway", status: 502 }), "Not saved: Bad Gateway");
  });
});

describe("labels", () => {
  it("formats device location and collector names", () => {
    assert.equal(deviceLocationLabel(null, null, null), "Not recorded");
    assert.equal(deviceLocationLabel(-1.2833, 36.8167, 8.4), "-1.28330, 36.81670 (±8 m)");
    assert.equal(deviceLocationLabel(-1.2833, 36.8167, null), "-1.28330, 36.81670");
    assert.equal(collectorLabel("  Jane W "), "Jane W");
    assert.equal(collectorLabel(null), "Name not available");
  });
});
