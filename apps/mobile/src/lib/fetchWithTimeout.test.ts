// node --experimental-strip-types --test (npm run test:unit)
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  REQUEST_TIMEOUT_MS,
  TIMEOUT_MESSAGE,
  UPLOAD_TIMEOUT_MS,
  createFetchWithTimeout,
  isTimeoutError,
  timeoutFor,
} from "./fetchWithTimeout.ts";

const BASE = "http://127.0.0.1:54321";
const REST_URL = `${BASE}/rest/v1/access_requests?select=id`;
const UPLOAD_URL = `${BASE}/storage/v1/object/collection-evidence/u/c/p.jpg`;
const LIMITS = { requestMs: 20, uploadMs: 200 };

type FetchLike = typeof fetch;

function abortError(): Error {
  const error = new Error("Aborted");
  error.name = "AbortError";
  return error;
}

// Never answers; rejects like a real fetch when its signal is aborted.
const hangingFetch: FetchLike = (_input, init) =>
  new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal;
    if (signal?.aborted) return reject(abortError());
    signal?.addEventListener("abort", () => reject(abortError()));
  });

function answerAfter(ms: number): FetchLike {
  return (_input, init) =>
    new Promise<Response>((resolve, reject) => {
      const timer = setTimeout(() => resolve(new Response("ok")), ms);
      init?.signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(abortError());
      });
    });
}

describe("timeoutFor", () => {
  it("gives Storage object requests the longer limit", () => {
    assert.equal(REQUEST_TIMEOUT_MS, 20_000);
    assert.equal(UPLOAD_TIMEOUT_MS, 120_000);
    assert.equal(timeoutFor(REST_URL), REQUEST_TIMEOUT_MS);
    assert.equal(timeoutFor(`${BASE}/auth/v1/token?grant_type=refresh_token`), REQUEST_TIMEOUT_MS);
    assert.equal(timeoutFor(`${BASE}/functions/v1/invite-user`), REQUEST_TIMEOUT_MS);
    assert.equal(timeoutFor(UPLOAD_URL), UPLOAD_TIMEOUT_MS);
  });
});

describe("createFetchWithTimeout", () => {
  it("returns the response and passes the request through when the server answers", async () => {
    let seen: { input: unknown; method?: string; hasSignal: boolean } | null = null;
    const fetchWithTimeout = createFetchWithTimeout(async (input, init) => {
      seen = { input, method: init?.method, hasSignal: init?.signal instanceof AbortSignal };
      return new Response("ok", { status: 201 });
    }, LIMITS);

    const response = await fetchWithTimeout(REST_URL, { method: "POST" });

    assert.equal(response.status, 201);
    assert.deepEqual(seen, { input: REST_URL, method: "POST", hasSignal: true });
  });

  it("aborts a hung request with a readable AbortError", async () => {
    const fetchWithTimeout = createFetchWithTimeout(hangingFetch, LIMITS);

    await assert.rejects(fetchWithTimeout(REST_URL), (error: unknown) => {
      assert.ok(error instanceof Error);
      // AbortError: postgrest-js does not retry it.
      assert.equal(error.name, "AbortError");
      assert.equal(error.message, TIMEOUT_MESSAGE);
      assert.ok(isTimeoutError(error));
      return true;
    });
  });

  it("does not cut off a Storage upload at the normal limit", async () => {
    const fetchWithTimeout = createFetchWithTimeout(answerAfter(60), LIMITS);

    // 60 ms is over the 20 ms request limit: the upload finishes, the query does not.
    assert.equal((await fetchWithTimeout(UPLOAD_URL, { method: "POST" })).status, 200);
    await assert.rejects(fetchWithTimeout(REST_URL), isTimeoutError);
  });

  it("reads the URL from URL and Request inputs", async () => {
    const fetchWithTimeout = createFetchWithTimeout(answerAfter(60), LIMITS);

    assert.equal((await fetchWithTimeout(new URL(UPLOAD_URL))).status, 200);
    assert.equal((await fetchWithTimeout(new Request(UPLOAD_URL))).status, 200);
    await assert.rejects(fetchWithTimeout(new URL(REST_URL)), isTimeoutError);
  });

  it("respects the caller's AbortSignal and keeps its error", async () => {
    const fetchWithTimeout = createFetchWithTimeout(hangingFetch, LIMITS);
    const caller = new AbortController();
    const pending = fetchWithTimeout(REST_URL, { signal: caller.signal });
    caller.abort();

    await assert.rejects(pending, (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, "Aborted");
      assert.ok(!isTimeoutError(error));
      return true;
    });
  });

  it("does not start a request for an already aborted signal", async () => {
    const fetchWithTimeout = createFetchWithTimeout(hangingFetch, LIMITS);
    const caller = new AbortController();
    caller.abort();

    await assert.rejects(fetchWithTimeout(REST_URL, { signal: caller.signal }), (error: unknown) => {
      return error instanceof Error && !isTimeoutError(error);
    });
  });

  it("passes other fetch failures through unchanged", async () => {
    const failure = new TypeError("Network request failed");
    const fetchWithTimeout = createFetchWithTimeout(async () => {
      throw failure;
    }, LIMITS);

    await assert.rejects(fetchWithTimeout(REST_URL), (error: unknown) => error === failure);
  });
});
