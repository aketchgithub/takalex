// node --experimental-strip-types --test (npm run test:unit)
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isSwitchOn } from "./features.ts";

describe("isSwitchOn", () => {
  it("is on only for true", () => {
    assert.equal(isSwitchOn("true"), true);
    assert.equal(isSwitchOn(" TRUE "), true);
  });

  it("is off when missing, empty or anything else", () => {
    for (const value of [undefined, "", "false", "1", "yes", "on", "tru"]) {
      assert.equal(isSwitchOn(value), false, String(value));
    }
  });
});
