// node --experimental-strip-types --test (npm run test:unit)
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { TIMEOUT_MESSAGE } from "./fetchWithTimeout.ts";
import {
  PHONE_CHANGE_MESSAGES,
  RESET_ALREADY_SENT_MESSAGE,
  RESET_SLOW_EMAIL_MESSAGE,
  RESET_SLOW_SMS_MESSAGE,
  RESET_CODE_SENT_MESSAGE,
  RESET_REQUEST_MESSAGES,
  RESET_SMS_ALREADY_SENT_MESSAGE,
  RESET_SMS_SENT_MESSAGE,
  RESET_VERIFY_MESSAGES,
  normaliseResetCode,
  phoneChangeErrorMessage,
  resetCodeError,
  resetRequestOutcome,
  resetVerifyErrorMessage,
  resetVerifyFailureKind,
} from "./passwordReset.ts";

describe("reset code input", () => {
  it("ignores spaces and hyphens", () => {
    assert.equal(normaliseResetCode(" 1234 5678 "), "12345678");
    assert.equal(normaliseResetCode("1234-5678"), "12345678");
  });

  it("accepts 6 to 10 digits", () => {
    assert.equal(resetCodeError("123456"), null);
    assert.equal(resetCodeError("1234 5678"), null);
    assert.equal(resetCodeError("1234567890"), null);
  });

  it("refuses empty, short, long and non-digit codes", () => {
    assert.equal(resetCodeError(""), "Enter the code from the email.");
    assert.equal(resetCodeError("  "), "Enter the code from the email.");
    assert.match(resetCodeError("12345") ?? "", /Check it/);
    assert.match(resetCodeError("12345678901") ?? "", /Check it/);
    assert.match(resetCodeError("12AB5678") ?? "", /Check it/);
  });

  it("names the SMS for phone codes", () => {
    assert.equal(resetCodeError("", "phone"), "Enter the code from the SMS.");
    assert.match(resetCodeError("12", "phone") ?? "", /number in the SMS/);
  });
});

describe("resetRequestOutcome (phone)", () => {
  it("reports a sent SMS without saying whether the number has an account", () => {
    assert.deepEqual(resetRequestOutcome(null, "phone"), { kind: "sent", message: RESET_SMS_SENT_MESSAGE });
    assert.match(RESET_SMS_SENT_MESSAGE, /^If an account uses this number/);
  });

  it("answers a number with no account exactly like a sent one", () => {
    const sent = resetRequestOutcome(null, "phone");
    for (const error of [
      { message: "Signups not allowed for otp", status: 422, code: "otp_disabled" },
      { message: "Signups not allowed for otp", status: 422 },
      { message: "User not found", status: 404, code: "user_not_found" },
      { message: "Signups not allowed for this instance", status: 422, code: "signup_disabled" },
    ]) {
      assert.deepEqual(resetRequestOutcome(error, "phone"), sent, error.message);
    }
  });

  it("answers a repeated request like a sent one", () => {
    const outcome = resetRequestOutcome({ message: "For security purposes, you can only request this after 40 seconds.", status: 429, code: "over_sms_send_rate_limit" }, "phone");
    assert.deepEqual(outcome, { kind: "already_sent", message: RESET_SMS_ALREADY_SENT_MESSAGE });
  });

  it("says SMS reset is not switched on when there is no SMS provider", () => {
    for (const code of ["phone_provider_disabled", "sms_send_failed"]) {
      assert.deepEqual(resetRequestOutcome({ message: "x", status: 400, code }, "phone"), {
        kind: "unavailable",
        message: RESET_REQUEST_MESSAGES.smsUnavailable,
      });
    }
  });

  it("reports no connection, and never treats an email-only error as a phone one", () => {
    assert.equal(resetRequestOutcome({ message: "Network request failed", status: 0 }, "phone").kind, "network");
    assert.equal(resetRequestOutcome({ message: "x", status: 400, code: "email_address_not_authorized" }, "phone").kind, "other");
    assert.equal(resetRequestOutcome({ message: "Signups not allowed for otp", status: 422, code: "otp_disabled" }, "email").kind, "other");
  });
});

describe("phoneChangeErrorMessage", () => {
  it("maps adding a number's failures to plain messages", () => {
    assert.equal(phoneChangeErrorMessage({ message: "Network request failed", status: 0 }), PHONE_CHANGE_MESSAGES.network);
    assert.equal(phoneChangeErrorMessage({ message: "x", status: 429, code: "over_sms_send_rate_limit" }), PHONE_CHANGE_MESSAGES.rateLimited);
    assert.equal(phoneChangeErrorMessage({ message: "x", status: 422, code: "phone_exists" }), PHONE_CHANGE_MESSAGES.taken);
    assert.equal(phoneChangeErrorMessage({ message: "A user with this phone number has already been registered", status: 422 }), PHONE_CHANGE_MESSAGES.taken);
    assert.equal(phoneChangeErrorMessage({ message: "x", status: 400, code: "phone_provider_disabled" }), PHONE_CHANGE_MESSAGES.unavailable);
    assert.equal(phoneChangeErrorMessage({ message: "x", status: 400, code: "validation_failed" }), PHONE_CHANGE_MESSAGES.invalid);
    assert.equal(phoneChangeErrorMessage({ message: "x", status: 401 }), PHONE_CHANGE_MESSAGES.session);
    assert.equal(phoneChangeErrorMessage({ message: "Twilio error 21211", status: 500 }), PHONE_CHANGE_MESSAGES.other);
  });
});

describe("resetRequestOutcome", () => {
  it("reports a sent code without saying whether the account exists", () => {
    const outcome = resetRequestOutcome(null);
    assert.deepEqual(outcome, { kind: "sent", message: RESET_CODE_SENT_MESSAGE });
    assert.match(outcome.message, /^If an account uses this email/);
    assert.match(outcome.message, /spam/);
  });

  it("answers a repeated request like a sent one (no account hint)", () => {
    const outcome = resetRequestOutcome({ message: "For security purposes, you can only request this after 52 seconds.", status: 429, code: "over_email_send_rate_limit" });
    assert.equal(outcome.kind, "already_sent");
    assert.equal(outcome.message, RESET_ALREADY_SENT_MESSAGE);
    assert.match(outcome.message, /^If an account uses this email/);
  });

  it("reports no connection", () => {
    assert.equal(resetRequestOutcome({ message: "Network request failed", status: 0, name: "AuthRetryableFetchError" }).kind, "network");
  });

  it("treats our own time limit as slow sending: the code may still arrive", () => {
    // As supabase-js passes it on, and as thrown by fetchWithTimeout.
    for (const error of [
      { message: TIMEOUT_MESSAGE, status: 0, name: "AuthRetryableFetchError" },
      { message: TIMEOUT_MESSAGE, name: "AbortError" },
    ]) {
      assert.deepEqual(resetRequestOutcome(error), { kind: "slow", message: RESET_SLOW_EMAIL_MESSAGE });
      assert.deepEqual(resetRequestOutcome(error, "phone"), { kind: "slow", message: RESET_SLOW_SMS_MESSAGE });
    }
  });

  it("says reset is not switched on while the built-in sender refuses the address", () => {
    const outcome = resetRequestOutcome({ message: "Email address not authorized", status: 400, code: "email_address_not_authorized" });
    assert.deepEqual(outcome, { kind: "unavailable", message: RESET_REQUEST_MESSAGES.unavailable });
  });

  it("falls back to a plain message and never shows the server's text", () => {
    const outcome = resetRequestOutcome({ message: "Error sending recovery email: smtp 535", status: 500, code: "unexpected_failure" });
    assert.equal(outcome.kind, "other");
    assert.ok(!outcome.message.includes("smtp"));
  });
});

describe("resetVerifyFailureKind", () => {
  it("treats a wrong, used or expired code as invalid", () => {
    assert.equal(resetVerifyFailureKind({ message: "Token has expired or is invalid", status: 403, code: "otp_expired" }), "invalid_code");
    assert.equal(resetVerifyFailureKind({ message: "Token has expired or is invalid", status: 403 }), "invalid_code");
    assert.equal(resetVerifyFailureKind({ message: "Invalid token", status: 401 }), "invalid_code");
  });

  it("reports no connection, timeouts and rate limiting", () => {
    assert.equal(resetVerifyFailureKind({ message: "Network request failed", status: 0 }), "network");
    assert.equal(resetVerifyFailureKind({ message: TIMEOUT_MESSAGE, name: "AbortError" }), "network");
    assert.equal(resetVerifyFailureKind({ message: "Too many requests", status: 429 }), "rate_limited");
  });

  it("falls back to other, with a fixed message", () => {
    assert.equal(resetVerifyFailureKind({ message: "Database error", status: 500, code: "unexpected_failure" }), "other");
    assert.equal(resetVerifyErrorMessage({ message: "Database error", status: 500 }), RESET_VERIFY_MESSAGES.other);
  });
});
