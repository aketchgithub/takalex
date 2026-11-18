import assert from "node:assert/strict";
import { test } from "node:test";

import { permissionOutcome, shouldRequestPermission } from "./locationPermission.ts";

test("asks on first use", () => {
  assert.equal(shouldRequestPermission({ status: "undetermined", canAskAgain: true }), true);
});

test("asks again after a refusal or an expired one-time grant (Android reports denied)", () => {
  assert.equal(shouldRequestPermission({ status: "denied", canAskAgain: true }), true);
});

test("does not ask when granted or when the system blocks the prompt", () => {
  assert.equal(shouldRequestPermission({ status: "granted", canAskAgain: true }), false);
  assert.equal(shouldRequestPermission({ status: "denied", canAskAgain: false }), false);
});

test("outcome: granted, denied (can ask again) or blocked (Settings only)", () => {
  assert.equal(permissionOutcome({ status: "granted", canAskAgain: false }), "granted");
  assert.equal(permissionOutcome({ status: "denied", canAskAgain: true }), "denied");
  assert.equal(permissionOutcome({ status: "denied", canAskAgain: false }), "blocked");
  assert.equal(permissionOutcome({ status: "undetermined", canAskAgain: true }), "denied");
});
