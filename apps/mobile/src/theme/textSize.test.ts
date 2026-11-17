// node --experimental-strip-types --test (npm run test:unit)
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { TEXT_SIZES, isTextSize, scaleFont } from "./textSize.ts";

describe("scaleFont", () => {
  it("keeps the type scale at Normal", () => {
    for (const base of [12, 13, 15, 16, 18, 24]) assert.equal(scaleFont(base, "normal"), base);
  });

  it("makes Small smaller and Large larger, in whole points", () => {
    assert.equal(scaleFont(15, "small"), 14);
    assert.equal(scaleFont(15, "large"), 17);
    assert.equal(scaleFont(24, "small"), 22);
    assert.equal(scaleFont(24, "large"), 28);
    assert.equal(scaleFont(12, "small"), 11);
  });
});

describe("isTextSize", () => {
  it("accepts the three sizes only", () => {
    for (const size of TEXT_SIZES) assert.equal(isTextSize(size.value), true);
    for (const value of ["huge", "", null, undefined, 1]) assert.equal(isTextSize(value), false);
  });
});
