// A fetch that gives up instead of waiting forever. Pure TypeScript, tested
// by fetchWithTimeout.test.ts; passed to createClient in supabase.ts, so it
// covers PostgREST, Auth, Edge Functions and Storage.
//
// The timeout error is named "AbortError" on purpose: postgrest-js retries
// GET requests three times after any other thrown fetch error, which would
// turn one 20 s limit into well over a minute of spinner.

export const REQUEST_TIMEOUT_MS = 20_000;
// Evidence photos on slow mobile data.
export const UPLOAD_TIMEOUT_MS = 120_000;

export const TIMEOUT_MESSAGE = "The request timed out. Check your connection and try again.";

const STORAGE_OBJECT_PATH = "/storage/v1/object";

type FetchLike = typeof fetch;
type FetchInput = Parameters<FetchLike>[0];

export type TimeoutLimits = { requestMs: number; uploadMs: number };

const DEFAULT_LIMITS: TimeoutLimits = { requestMs: REQUEST_TIMEOUT_MS, uploadMs: UPLOAD_TIMEOUT_MS };

function urlOf(input: FetchInput): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

export function timeoutFor(url: string, limits: TimeoutLimits = DEFAULT_LIMITS): number {
  return url.includes(STORAGE_OBJECT_PATH) ? limits.uploadMs : limits.requestMs;
}

export function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError" && error.message === TIMEOUT_MESSAGE;
}

function timeoutError(): Error {
  const error = new Error(TIMEOUT_MESSAGE);
  error.name = "AbortError";
  return error;
}

// baseFetch defaults to the global fetch, looked up on each call.
export function createFetchWithTimeout(
  baseFetch: FetchLike = (input, init) => fetch(input, init),
  limits: TimeoutLimits = DEFAULT_LIMITS,
): FetchLike {
  return async (input, init) => {
    const controller = new AbortController();
    const callerSignal = init?.signal ?? null;
    let timedOut = false;

    // The caller's own signal still cancels the request.
    const onCallerAbort = () => controller.abort();
    if (callerSignal?.aborted) controller.abort();
    else callerSignal?.addEventListener("abort", onCallerAbort);

    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutFor(urlOf(input), limits));

    try {
      return await baseFetch(input, { ...init, signal: controller.signal });
    } catch (error: unknown) {
      // A caller's cancellation keeps its own error; only our timer becomes
      // the readable timeout.
      if (timedOut && !callerSignal?.aborted) throw timeoutError();
      throw error;
    } finally {
      clearTimeout(timer);
      callerSignal?.removeEventListener("abort", onCallerAbort);
    }
  };
}
