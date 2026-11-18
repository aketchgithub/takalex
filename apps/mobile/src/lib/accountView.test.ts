// node --experimental-strip-types --test (npm run test:unit)
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { appVersionLabel, initials, roleLine, showsAssignedSites } from "./accountView.ts";

describe("initials", () => {
  it("takes the first and last name", () => {
    assert.equal(initials("Amina Wanjiku"), "AW");
    assert.equal(initials("  amina   njeri wanjiku "), "AW");
  });
  it("uses one letter for a single name and ? for none", () => {
    assert.equal(initials("amina"), "A");
    assert.equal(initials("   "), "?");
    assert.equal(initials(null), "?");
  });
});

describe("roleLine", () => {
  it("adds the group when there is one", () => {
    assert.equal(roleLine("Collector", "Njiru group"), "Collector · Njiru group");
    assert.equal(roleLine("Site manager", null), "Site manager");
  });
});

describe("showsAssignedSites", () => {
  it("only for collectors and site managers", () => {
    assert.equal(showsAssignedSites("collector"), true);
    assert.equal(showsAssignedSites("site_manager"), true);
    assert.equal(showsAssignedSites("recycler"), false);
    assert.equal(showsAssignedSites("admin"), false);
  });
});

describe("appVersionLabel", () => {
  it("shows the version when known", () => {
    assert.equal(appVersionLabel("1.0.0"), "Takalex 1.0.0");
    assert.equal(appVersionLabel(" "), "Takalex");
    assert.equal(appVersionLabel(null), "Takalex");
  });
});
