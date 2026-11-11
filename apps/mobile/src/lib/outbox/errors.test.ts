// node --experimental-strip-types --test (npm run test:unit)
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { classifyProfileError } from "../authResolution.ts";
import { TIMEOUT_MESSAGE, createFetchWithTimeout } from "../fetchWithTimeout.ts";
import { classifyError, isNetworkError, toRemoteError } from "./errors.ts";

const NO_CONNECTION = /^No connection to Takalex/;

// The error fetchWithTimeout really throws for a hung server.
async function realTimeoutError(): Promise<unknown> {
  const hanging: typeof fetch = (_input, init) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("Aborted")));
    });
  const fetchWithTimeout = createFetchWithTimeout(hanging, { requestMs: 5, uploadMs: 5 });
  try {
    await fetchWithTimeout("http://127.0.0.1:54321/rest/v1/collection_logs");
  } catch (error: unknown) {
    return error;
  }
  throw new Error("The request did not time out.");
}

describe("request timeouts in the outbox", () => {
  it("treats the thrown timeout as a retryable network error", async () => {
    const error = await realTimeoutError();

    assert.ok(isNetworkError(toRemoteError(error)));
    const classified = classifyError(error);
    assert.equal(classified.kind, "retryable");
    assert.match(classified.reason, NO_CONNECTION);
  });

  it("treats a timed-out PostgREST insert (status 0) as retryable", () => {
    // postgrest-js catches the thrown error and reports "<name>: <message>", status 0.
    const classified = classifyError({ message: `AbortError: ${TIMEOUT_MESSAGE}`, status: 0 });

    assert.equal(classified.kind, "retryable");
    assert.match(classified.reason, NO_CONNECTION);
  });

  it("treats a timed-out photo upload as retryable", () => {
    // storage-js wraps the thrown error in StorageUnknownError with the same message.
    const storageError = Object.assign(new Error(TIMEOUT_MESSAGE), { name: "StorageUnknownError" });
    const classified = classifyError(toRemoteError(storageError));

    assert.equal(classified.kind, "retryable");
    assert.match(classified.reason, NO_CONNECTION);
  });

  it("treats a timed-out session refresh as retryable", () => {
    // auth-js wraps the thrown error in AuthRetryableFetchError with status 0.
    const authError = Object.assign(new Error(TIMEOUT_MESSAGE), { name: "AuthRetryableFetchError", status: 0 });

    assert.equal(classifyError(toRemoteError(authError)).kind, "retryable");
  });

  it("still treats server refusals as permanent", () => {
    assert.equal(classifyError({ message: "permission denied", code: "42501", status: 403 }).kind, "permanent");
    assert.equal(classifyError({ message: "violates check constraint", code: "23514", status: 400 }).kind, "permanent");
  });
});

describe("request timeouts at sign-in", () => {
  it("counts a timed-out profile request as a network failure, so the cached profile applies", () => {
    const fetched = classifyProfileError({ message: `AbortError: ${TIMEOUT_MESSAGE}`, status: 0 });

    assert.equal(fetched.kind, "network");
  });
});
