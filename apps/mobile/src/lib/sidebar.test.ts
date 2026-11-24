// node --experimental-strip-types --test (npm run test:unit)
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SIDEBAR_MIN_WINDOW_WIDTH, isCurrentTab, showsSidebar } from "./sidebar.ts";

describe("showsSidebar", () => {
  it("only in a wide browser window", () => {
    assert.equal(showsSidebar("web", 1366), true);
    assert.equal(showsSidebar("web", SIDEBAR_MIN_WINDOW_WIDTH), true);
    assert.equal(showsSidebar("web", SIDEBAR_MIN_WINDOW_WIDTH - 1), false);
    assert.equal(showsSidebar("android", 1366), false);
    assert.equal(showsSidebar("ios", 1024), false);
  });
});

describe("isCurrentTab", () => {
  it("matches the overview only on the root path", () => {
    assert.equal(isCurrentTab("/", "index"), true);
    assert.equal(isCurrentTab("/sites", "index"), false);
  });
  it("matches a tab and the pages under it, not similar names", () => {
    assert.equal(isCurrentTab("/sites", "sites"), true);
    assert.equal(isCurrentTab("/sites/extra", "sites"), true);
    assert.equal(isCurrentTab("/sitesx", "sites"), false);
    assert.equal(isCurrentTab("/invitations", "access-requests"), false);
  });
});
