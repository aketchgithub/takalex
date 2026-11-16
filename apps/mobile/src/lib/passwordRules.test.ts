// node --experimental-strip-types --test (npm run test:unit)
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { TIMEOUT_MESSAGE } from "./fetchWithTimeout.ts";
import {
  CURRENT_PASSWORD_REQUIRED,
  NEW_PASSWORD_MUST_DIFFER,
  PASSWORDS_DO_NOT_MATCH,
  PASSWORD_CHANGE_MESSAGES,
  PASSWORD_RULE,
  classifyPasswordChangeError,
  passwordRuleError,
  validatePasswordChange,
} from "./passwordRules.ts";

const CURRENT = "old-password-1";
const NEXT = "new-password-2";

describe("passwordRuleError", () => {
  it("rejects fewer than 8 characters", () => {
    assert.equal(passwordRuleError(""), PASSWORD_RULE);
    assert.equal(passwordRuleError("1234567"), PASSWORD_RULE);
  });

  it("accepts exactly 8 characters", () => {
    assert.equal(passwordRuleError("12345678"), null);
  });

  it("accepts exactly 72 bytes and rejects 73", () => {
    assert.equal(passwordRuleError("a".repeat(72)), null);
    assert.equal(passwordRuleError("a".repeat(73)), PASSWORD_RULE);
  });

  it("counts bytes, not characters, for the upper limit", () => {
    // "é" is 2 bytes in UTF-8: 36 fit, 37 do not.
    assert.equal(passwordRuleError("é".repeat(36)), null);
    assert.equal(passwordRuleError("é".repeat(37)), PASSWORD_RULE);
  });

  it("does not trim: spaces count as characters", () => {
    assert.equal(passwordRuleError("        "), null);
  });
});

describe("validatePasswordChange", () => {
  it("accepts a valid change", () => {
    assert.deepEqual(
      validatePasswordChange({ currentPassword: CURRENT, newPassword: NEXT, confirmation: NEXT }),
      {},
    );
  });

  it("requires the current password", () => {
    const errors = validatePasswordChange({ currentPassword: "", newPassword: NEXT, confirmation: NEXT });
    assert.deepEqual(errors, { currentPassword: CURRENT_PASSWORD_REQUIRED });
  });

  it("applies the activate screen's rule to the new password", () => {
    const errors = validatePasswordChange({
      currentPassword: CURRENT,
      newPassword: "short",
      confirmation: "short",
    });
    assert.deepEqual(errors, { newPassword: PASSWORD_RULE });
  });

  it("does not apply the rule to the current password", () => {
    // An old password may be shorter than today's minimum.
    const errors = validatePasswordChange({ currentPassword: "old", newPassword: NEXT, confirmation: NEXT });
    assert.deepEqual(errors, {});
  });

  it("requires the new password to differ from the current one", () => {
    const errors = validatePasswordChange({
      currentPassword: CURRENT,
      newPassword: CURRENT,
      confirmation: CURRENT,
    });
    assert.deepEqual(errors, { newPassword: NEW_PASSWORD_MUST_DIFFER });
  });

  it("treats a different case as a different password", () => {
    const errors = validatePasswordChange({
      currentPassword: CURRENT,
      newPassword: CURRENT.toUpperCase(),
      confirmation: CURRENT.toUpperCase(),
    });
    assert.deepEqual(errors, {});
  });

  it("requires the confirmation to match", () => {
    const errors = validatePasswordChange({
      currentPassword: CURRENT,
      newPassword: NEXT,
      confirmation: `${NEXT}x`,
    });
    assert.deepEqual(errors, { confirmation: PASSWORDS_DO_NOT_MATCH });
  });

  it("reports every field at once", () => {
    const errors = validatePasswordChange({ currentPassword: "", newPassword: "short", confirmation: "" });
    assert.deepEqual(errors, {
      currentPassword: CURRENT_PASSWORD_REQUIRED,
      newPassword: PASSWORD_RULE,
      confirmation: PASSWORDS_DO_NOT_MATCH,
    });
  });

  it("never puts a password in an error message", () => {
    const secret = "s3cret";
    const errors = validatePasswordChange({
      currentPassword: secret,
      newPassword: secret,
      confirmation: "different-secret",
    });
    for (const message of Object.values(errors)) {
      assert.ok(!message.includes(secret));
      assert.ok(!message.includes("different-secret"));
    }
  });
});

describe("classifyPasswordChangeError", () => {
  it("reports a wrong current password", () => {
    const failure = classifyPasswordChangeError("verify", {
      message: "Invalid login credentials",
      status: 400,
      code: "invalid_credentials",
      name: "AuthApiError",
    });
    assert.deepEqual(failure, { kind: "wrong_current", message: PASSWORD_CHANGE_MESSAGES.wrong_current });
  });

  it("recognises a wrong current password without an error code", () => {
    const failure = classifyPasswordChangeError("verify", { message: "Invalid login credentials", status: 400 });
    assert.equal(failure.kind, "wrong_current");
  });

  it("reports a password the server finds weak", () => {
    assert.equal(
      classifyPasswordChangeError("update", { message: "Password is too weak", status: 422, code: "weak_password" }).kind,
      "weak",
    );
    assert.equal(
      classifyPasswordChangeError("update", { message: "weak", status: 422, name: "AuthWeakPasswordError" }).kind,
      "weak",
    );
  });

  it("reports a new password the server finds equal to the old one", () => {
    const failure = classifyPasswordChangeError("update", {
      message: "New password should be different from the old password.",
      status: 422,
      code: "same_password",
    });
    assert.equal(failure.kind, "same");
  });

  it("reports no connection at either stage", () => {
    for (const stage of ["verify", "update"] as const) {
      // auth-js: a failed fetch is reported with status 0.
      assert.equal(
        classifyPasswordChangeError(stage, { message: "Network request failed", status: 0, name: "AuthRetryableFetchError" }).kind,
        "network",
      );
      // The client's own timeout, thrown.
      assert.equal(
        classifyPasswordChangeError(stage, { message: TIMEOUT_MESSAGE, name: "AbortError" }).kind,
        "network",
      );
    }
  });

  it("reports rate limiting", () => {
    assert.equal(
      classifyPasswordChangeError("verify", { message: "Too many requests", status: 429, code: "over_request_rate_limit" }).kind,
      "rate_limited",
    );
  });

  it("reports an expired session while updating", () => {
    assert.equal(
      classifyPasswordChangeError("update", { message: "Auth session missing!", status: 400, name: "AuthSessionMissingError" }).kind,
      "session",
    );
    assert.equal(classifyPasswordChangeError("update", { message: "JWT expired", status: 401 }).kind, "session");
  });

  it("falls back to a plain message and never shows the server's text", () => {
    const failure = classifyPasswordChangeError("update", { message: "pq: internal detail", status: 500 });
    assert.deepEqual(failure, { kind: "other", message: PASSWORD_CHANGE_MESSAGES.other });

    const verify = classifyPasswordChangeError("verify", { message: "Email not confirmed", status: 400, code: "email_not_confirmed" });
    assert.equal(verify.kind, "other");
  });
});
