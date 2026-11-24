// node --experimental-strip-types --test (npm run test:unit)
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { browserDialogText } from "./dialogText.ts";

describe("browserDialogText", () => {
  it("puts the title above the message", () => {
    assert.equal(browserDialogText("Delete PP?", "It is not used."), "Delete PP?\n\nIt is not used.");
  });
  it("shows only the title without a message", () => {
    assert.equal(browserDialogText("Done"), "Done");
    assert.equal(browserDialogText("Done", "  "), "Done");
  });
});
