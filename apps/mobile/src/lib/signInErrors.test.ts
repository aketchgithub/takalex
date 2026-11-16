// node --experimental-strip-types --test (npm run test:unit)
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { TIMEOUT_MESSAGE } from "./fetchWithTimeout.ts";
import { SIGN_IN_MESSAGES, signInErrorMessage, signInFailureKind } from "./signInErrors.ts";

describe("signInFailureKind", () => {
  it("reports wrong credentials", () => {
    assert.equal(
      signInFailureKind({ message: "Invalid login credentials", status: 400, code: "invalid_credentials", name: "AuthApiError" }),
      "wrong_credentials",
    );
  });

  it("recognises wrong credentials without an error code", () => {
    assert.equal(signInFailureKind({ message: "Invalid login credentials", status: 400 }), "wrong_credentials");
  });

  it("reports no connection", () => {
    // auth-js: a failed fetch is reported with status 0.
    assert.equal(
      signInFailureKind({ message: "Network request failed", status: 0, name: "AuthRetryableFetchError" }),
      "network",
    );
    // The client's own timeout, thrown.
    assert.equal(signInFailureKind({ message: TIMEOUT_MESSAGE, name: "AbortError" }), "network");
  });

  it("reports rate limiting", () => {
    assert.equal(signInFailureKind({ message: "Too many requests", status: 429 }), "rate_limited");
    assert.equal(
      signInFailureKind({ message: "Request rate limit reached", status: 400, code: "over_request_rate_limit" }),
      "rate_limited",
    );
  });

  it("treats anything else as other", () => {
    assert.equal(signInFailureKind({ message: "Database error", status: 500, code: "unexpected_failure" }), "other");
    assert.equal(signInFailureKind({ message: "Email not confirmed", status: 400, code: "email_not_confirmed" }), "other");
  });
});

describe("signInErrorMessage", () => {
  it("never shows the server's text", () => {
    const serverText = "Invalid login credentials";
    const message = signInErrorMessage({ message: serverText, status: 400, code: "invalid_credentials" });
    assert.equal(message, SIGN_IN_MESSAGES.wrong_credentials);
    assert.ok(!message.includes(serverText));
  });

  it("gives the same message whether the email or the password was wrong", () => {
    // The Auth server answers both with invalid_credentials; the app adds no hint.
    const unknownEmail = signInErrorMessage({ message: "Invalid login credentials", status: 400, code: "invalid_credentials" });
    const wrongPassword = signInErrorMessage({ message: "Invalid login credentials", status: 400, code: "invalid_credentials" });
    assert.equal(unknownEmail, wrongPassword);
  });
});
