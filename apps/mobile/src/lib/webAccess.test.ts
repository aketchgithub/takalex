// node --experimental-strip-types --test (npm run test:unit)
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { webAllowsRole } from "./webAccess.ts";

describe("webAllowsRole", () => {
  it("lets only administrators use the website", () => {
    assert.equal(webAllowsRole("admin"), true);
    assert.equal(webAllowsRole("collector"), false);
    assert.equal(webAllowsRole("site_manager"), false);
    assert.equal(webAllowsRole("recycler"), false);
  });
});
