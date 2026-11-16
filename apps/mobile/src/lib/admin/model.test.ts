// node --experimental-strip-types --test (npm run test:unit)
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  NO_EMAIL_NOTE,
  checkRejectionNote,
  contactLabel,
  filterRequests,
  formatExpiry,
  groupLabel,
  invitationActions,
  invitationDisplayStatus,
  invitePrefill,
  inviteShareMessage,
  isOpenRequest,
  requestEmailError,
  requestStatusLabel,
  type AccessRequestRow,
} from "./model.ts";

function request(overrides: Partial<AccessRequestRow> = {}): AccessRequestRow {
  return {
    id: "r1",
    fullName: "  Wanjiru Kamau ",
    email: "Wanjiru@Example.com",
    phone: "0712345678",
    role: "collector",
    siteId: "site-njiru",
    siteName: "Njiru",
    status: "submitted",
    createdAt: "2026-11-09T08:00:00.000Z",
    notes: null,
    ...overrides,
  };
}

describe("filterRequests", () => {
  const rows = [
    request({ id: "old", createdAt: "2026-11-01T08:00:00.000Z" }),
    request({ id: "new", createdAt: "2026-11-09T08:00:00.000Z" }),
    request({ id: "approved", status: "approved", createdAt: "2026-11-05T08:00:00.000Z" }),
    request({ id: "reviewed", status: "reviewed", createdAt: "2026-11-04T08:00:00.000Z" }),
    request({ id: "inv", status: "invited" }),
    request({ id: "rej", status: "rejected" }),
  ];

  it("Submitted lists every open request (incl. approved, not yet invited), newest first", () => {
    assert.deepEqual(filterRequests(rows, "submitted").map((r) => r.id), ["new", "approved", "reviewed", "old"]);
  });

  it("Invited and Rejected list only those", () => {
    assert.deepEqual(filterRequests(rows, "invited").map((r) => r.id), ["inv"]);
    assert.deepEqual(filterRequests(rows, "rejected").map((r) => r.id), ["rej"]);
  });

  it("does not mutate the input order", () => {
    const ids = rows.map((r) => r.id);
    filterRequests(rows, "submitted");
    assert.deepEqual(rows.map((r) => r.id), ids);
  });
});

describe("request labels", () => {
  it("knows which requests can still be invited", () => {
    assert.ok(isOpenRequest("submitted") && isOpenRequest("reviewed") && isOpenRequest("approved"));
    assert.ok(!isOpenRequest("invited") && !isOpenRequest("rejected"));
  });

  it("labels status, contact and group", () => {
    assert.equal(requestStatusLabel("approved"), "Approved, invitation not sent yet");
    assert.equal(contactLabel("a@b.co", " 0712 "), "a@b.co · 0712");
    assert.equal(contactLabel(null, "0712"), "0712");
    assert.equal(contactLabel(null, null), "No contact details");
    assert.equal(groupLabel("collector", "Njiru", "s1"), "Njiru group");
    assert.equal(groupLabel("site_manager", "Njiru", "s1"), "Njiru");
    assert.equal(groupLabel("recycler", null, null), "No site chosen");
    assert.equal(groupLabel("collector", null, "s1"), "Unknown site group");
  });
});

describe("invitePrefill", () => {
  it("copies name, email, role and the chosen site", () => {
    assert.deepEqual(invitePrefill(request()), {
      fullName: "Wanjiru Kamau",
      email: "Wanjiru@Example.com",
      role: "collector",
      siteIds: ["site-njiru"],
    });
  });

  it("leaves email empty and sites empty when the request has none", () => {
    assert.deepEqual(invitePrefill(request({ email: null, role: "recycler", siteId: null })), {
      fullName: "Wanjiru Kamau",
      email: "",
      role: "recycler",
      siteIds: [],
    });
    assert.match(NO_EMAIL_NOTE, /^No email on this request: confirm it with the requester by phone/);
  });
});

describe("requestEmailError", () => {
  it("requires a match with the request's email, ignoring case and spaces", () => {
    assert.equal(requestEmailError("Wanjiru@Example.com", " wanjiru@example.COM "), null);
    assert.match(requestEmailError("wanjiru@example.com", "other@example.com") ?? "", /must match .*wanjiru@example\.com/);
  });

  it("accepts any entered email when the request has none", () => {
    assert.equal(requestEmailError(null, "confirmed@example.com"), null);
    assert.equal(requestEmailError("", "confirmed@example.com"), null);
  });
});

describe("checkRejectionNote", () => {
  it("requires a non-blank note and trims it", () => {
    assert.deepEqual(checkRejectionNote("  "), { note: null, error: "Enter a note explaining the rejection." });
    assert.deepEqual(checkRejectionNote(" Not a Chemolex site worker "), { note: "Not a Chemolex site worker", error: null });
  });
});

describe("invitationDisplayStatus / invitationActions", () => {
  const now = new Date("2026-11-09T12:00:00.000Z");

  it("computes expired from expires_at for pending rows", () => {
    assert.equal(invitationDisplayStatus("pending", "2026-11-10T12:00:00.000Z", now), "pending");
    assert.equal(invitationDisplayStatus("pending", "2026-11-09T12:00:00.000Z", now), "expired");
    assert.equal(invitationDisplayStatus("pending", "2026-11-01T00:00:00.000Z", now), "expired");
  });

  it("keeps the other statuses", () => {
    for (const s of ["accepted", "expired", "revoked", "superseded"] as const) {
      assert.equal(invitationDisplayStatus(s, "2026-12-01T00:00:00.000Z", now), s);
    }
    assert.equal(invitationDisplayStatus("weird", "2026-12-01T00:00:00.000Z", now), "superseded");
  });

  it("offers Revoke for pending only and Reissue for expired or revoked only", () => {
    assert.deepEqual(invitationActions("pending"), { revoke: true, reissue: false });
    assert.deepEqual(invitationActions("expired"), { revoke: false, reissue: true });
    assert.deepEqual(invitationActions("revoked"), { revoke: false, reissue: true });
    assert.deepEqual(invitationActions("accepted"), { revoke: false, reissue: false });
    assert.deepEqual(invitationActions("superseded"), { revoke: false, reissue: false });
  });
});

describe("inviteShareMessage", () => {
  it("contains the role, email, code and expiry", () => {
    const expires = new Date(2026, 10, 16, 9, 5).toISOString();
    const text = inviteShareMessage({ roleLabel: "Collector", email: "w@example.com", code: "ABCD-EFGH-JKMN", expiresAt: expires });
    assert.match(text, /as a collector\./);
    assert.match(text, /Email: w@example\.com/);
    assert.match(text, /Invitation code: ABCD-EFGH-JKMN/);
    assert.match(text, /expires on 16 Nov 2026, 09:05\./);
    assert.equal(formatExpiry(null), "in 7 days");
    assert.equal(formatExpiry("nope"), "in 7 days");
  });
});
