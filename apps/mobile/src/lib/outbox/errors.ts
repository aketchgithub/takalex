// Error classification for the sync engine. Pure TypeScript.
//
// retryable: the request may succeed later without any change to the row
//            (no connection, timeout, 5xx, 429, expired session).
// permanent: retrying the same row cannot succeed (validation, constraint,
//            permission / RLS, missing local photo). The row is kept as
//            'failed' with a readable reason.

import type { RemoteError } from "./types.ts";

export type ErrorKind = "retryable" | "permanent";

export type ClassifiedError = {
  kind: ErrorKind;
  reason: string;
};

// A failure that is permanent whatever its shape (e.g. the local photo file
// is gone). The message is shown to the user as is.
export class PermanentSyncError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentSyncError";
  }
}

// Prefix of every RLS / privilege reason (see classifyError). Exported so
// the history screen can recognise these failures without its own literal.
export const NOT_ALLOWED_REASON = "Not allowed by the server";

const NETWORK_PATTERN =
  /network request failed|failed to fetch|fetcherror|network ?error|timed? ?out|timeout|aborted|econn|enotfound|eai_again|socket hang up/i;

const NETWORK_NAMES = new Set([
  "TypeError",
  "AbortError",
  "TimeoutError",
  "FetchError",
  "StorageUnknownError",
  "AuthRetryableFetchError",
]);

export function toRemoteError(error: unknown): RemoteError {
  if (error && typeof error === "object") {
    const e = error as Record<string, unknown>;
    const status = typeof e.status === "number" ? e.status : undefined;
    return {
      message: typeof e.message === "string" && e.message ? e.message : String(error),
      status,
      code: typeof e.code === "string" && e.code ? e.code : undefined,
      statusCode:
        typeof e.statusCode === "string" && e.statusCode ? e.statusCode : undefined,
      name: typeof e.name === "string" && e.name ? e.name : undefined,
    };
  }
  return { message: String(error) };
}

// unique_violation. For collection_logs this is
// collection_client_record_unique (collector_id, client_record_id); for
// collection_evidence it is storage_path UNIQUE. Both mean "already there".
export function isUniqueViolation(error: RemoteError): boolean {
  return error.code === "23505";
}

// Storage returns 409 (newer API) or 400 with statusCode "409" / "Duplicate"
// (older API) when the object already exists.
export function isStorageDuplicate(error: RemoteError): boolean {
  return (
    error.status === 409 ||
    error.statusCode === "409" ||
    error.code === "Duplicate" ||
    /already exists/i.test(error.message)
  );
}

function httpStatus(error: RemoteError): number | undefined {
  if (error.status !== undefined && error.status !== 0) return error.status;
  if (error.statusCode && /^\d{3}$/.test(error.statusCode)) return Number(error.statusCode);
  return error.status;
}

export function classifyError(raw: unknown): ClassifiedError {
  if (raw instanceof PermanentSyncError) {
    return { kind: "permanent", reason: raw.message };
  }

  const error = toRemoteError(raw);
  const status = httpStatus(error);
  const code = error.code ?? "";
  const detail = error.message.trim();

  // Never reached the server.
  if (
    status === 0 ||
    (status === undefined &&
      (NETWORK_NAMES.has(error.name ?? "") || NETWORK_PATTERN.test(detail)))
  ) {
    return {
      kind: "retryable",
      reason: "No connection to Takalex. It will be sent automatically when you are back online.",
    };
  }

  if (status !== undefined && (status >= 500 || status === 408 || status === 429)) {
    return {
      kind: "retryable",
      reason: `Takalex is temporarily unavailable (HTTP ${status}). It will be retried.`,
    };
  }

  // Expired or missing token: the next run refreshes the session first.
  if (status === 401 || code === "PGRST301" || code === "PGRST303" || /jwt expired/i.test(detail)) {
    return {
      kind: "retryable",
      reason: "Your session needs to be refreshed. It will be retried.",
    };
  }

  // RLS / privilege: e.g. the site is not yours, your account is inactive,
  // or the collection is no longer pending.
  if (code === "42501" || status === 403) {
    return {
      kind: "permanent",
      reason: `${NOT_ALLOWED_REASON}: ${detail}`,
    };
  }

  // Data exceptions (22xxx), integrity violations (23xxx other than the
  // duplicates handled by the caller), and RAISE EXCEPTION from triggers.
  if (
    code.startsWith("22") ||
    code.startsWith("23") ||
    code === "P0001" ||
    (status !== undefined && status >= 400 && status < 500)
  ) {
    return {
      kind: "permanent",
      reason: `Rejected by the server: ${detail}`,
    };
  }

  // Unknown failure with no HTTP status: most likely transport. Retrying
  // is harmless because every step is idempotent.
  return {
    kind: "retryable",
    reason: `Sync failed (${detail || "unknown error"}). It will be retried.`,
  };
}
