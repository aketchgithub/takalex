// node --experimental-strip-types --test (npm run test:unit)
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { TIMEOUT_MESSAGE } from "../fetchWithTimeout.ts";
import {
  SITE_MESSAGES,
  SITE_NAME_MAX,
  deactivateConfirmation,
  isRename,
  normaliseSiteName,
  siteNameError,
  siteWriteErrorMessage,
  sortSites,
  type AdminSite,
} from "./siteModel.ts";

const sites: AdminSite[] = [
  { id: "1", name: "Mathare", active: true },
  { id: "2", name: "Ng'omong'o", active: true },
  { id: "3", name: "Old Yard", active: false },
];

describe("normaliseSiteName", () => {
  it("trims and turns any run of whitespace into one space, like the database", () => {
    assert.equal(normaliseSiteName("  Dandora \t  North\n "), "Dandora North");
    assert.equal(normaliseSiteName("Mathare"), "Mathare");
  });
});

describe("siteNameError", () => {
  it("accepts a new, valid name", () => {
    assert.equal(siteNameError("Dandora North", sites), null);
    assert.equal(siteNameError("x".repeat(SITE_NAME_MAX), sites), null);
    assert.equal(siteNameError("Ng'ambo Ç", sites), null);
  });

  it("refuses empty, blank and too long names", () => {
    assert.equal(siteNameError("", sites), "Enter a site name.");
    assert.equal(siteNameError(" \t\n ", sites), "Enter a site name.");
    assert.match(siteNameError("x".repeat(SITE_NAME_MAX + 1), sites) ?? "", /at most 80/);
  });

  it("refuses control characters", () => {
    assert.match(siteNameError("Bad\u0007Name", sites) ?? "", /special characters/);
  });

  it("refuses another site's name, ignoring case and spacing", () => {
    assert.match(siteNameError("mathare", sites) ?? "", /"Mathare" already exists/);
    assert.match(siteNameError("  NG'OMONG'O ", sites) ?? "", /already exists/);
  });

  it("points to reactivation when the name belongs to an inactive site", () => {
    assert.match(siteNameError("old yard", sites) ?? "", /inactive site .* Reactivate it instead/);
  });

  it("lets a site keep its own name in another case", () => {
    assert.equal(siteNameError("MATHARE", sites, "1"), null);
    assert.match(siteNameError("Mathare", sites, "2") ?? "", /already exists/);
  });
});

describe("isRename", () => {
  it("is false when the normalised name is unchanged", () => {
    assert.equal(isRename(sites[0], " Mathare  "), false);
    assert.equal(isRename(sites[0], "MATHARE"), true);
  });
});

describe("sortSites", () => {
  it("puts active sites first, then sorts by name ignoring case, without changing the input", () => {
    const input: AdminSite[] = [
      { id: "a", name: "zeta", active: false },
      { id: "b", name: "beta", active: true },
      { id: "c", name: "Alpha", active: true },
      { id: "d", name: "alpha 2", active: false },
    ];
    assert.deepEqual(sortSites(input).map((s) => s.id), ["c", "b", "d", "a"]);
    assert.deepEqual(input.map((s) => s.id), ["a", "b", "c", "d"]);
  });
});

describe("siteWriteErrorMessage", () => {
  it("maps the database's SQLSTATEs to plain messages", () => {
    assert.equal(siteWriteErrorMessage({ message: "x", status: 403, code: "42501" }), SITE_MESSAGES.notAdmin);
    assert.equal(siteWriteErrorMessage({ message: "x", status: 409, code: "23505" }), SITE_MESSAGES.duplicate);
    assert.equal(siteWriteErrorMessage({ message: "x", status: 404, code: "P0002" }), SITE_MESSAGES.notFound);
    assert.equal(siteWriteErrorMessage({ message: "x", status: 400, code: "22023" }), SITE_MESSAGES.invalid);
    assert.equal(siteWriteErrorMessage({ message: "x", status: 500, code: "XX000" }), SITE_MESSAGES.other);
  });

  it("reports no connection and timeouts", () => {
    assert.equal(siteWriteErrorMessage({ message: "Network request failed", status: 0 }), SITE_MESSAGES.network);
    assert.equal(siteWriteErrorMessage({ message: TIMEOUT_MESSAGE, name: "AbortError" }), SITE_MESSAGES.network);
  });

  it("never shows the server's text", () => {
    const message = siteWriteErrorMessage({ message: 'A site named "Secret" already exists', status: 409, code: "23505" });
    assert.ok(!message.includes("Secret"));
  });
});

describe("deactivateConfirmation", () => {
  it("says assigned collectors keep working", () => {
    const text = deactivateConfirmation("Mathare");
    assert.match(text, /^Mathare will no longer be offered/);
    assert.match(text, /can still record deliveries/);
  });
});
