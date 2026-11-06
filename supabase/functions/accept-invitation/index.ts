// accept-invitation: public Edge Function (verify_jwt = false) that activates
// an invited account with its one-time code (docs/demo-plan.md section 1.1).
//
// POST { email, code, password }
//   200 { ok: true }                             activated; the app signs in
//   400 { error, code: "invalid_input" }         malformed email or password
//   400 { error, code: "invalid_invitation" }    ANY invitation-validity failure
//   500 { error, code: "activation_failed" }     password set, activation failed
//   503 { error, code: "unavailable" }           database or Auth unreachable
//
// Invitation-validity failures (unknown or wrong email, wrong code, expired,
// locked, revoked, superseded, already accepted, or losing a concurrent
// claim) all return the same status and byte-identical body, and every
// response after input validation takes at least MIN_RESPONSE_MS, so they
// cannot be told apart by content or timing.
//
// Order of operations:
//   1. verify_invitation_code  (counts wrong codes, enforces lockout/expiry)
//   2. claim_invitation        (row-locked lease; only one request wins)
//   3. Auth admin updateUserById(password, email_confirm) - claim holder only
//   4. consume_invitation      (needs the claim token; activates the profile)
// The claim is released on any failure whose outcome is known, so the
// invitee can retry at once; otherwise it expires after 2 minutes.
//
// Codes, passwords, emails, claim tokens and user IDs are never logged.

import { createClient } from "../_shared/supabase.ts";
import { hashCode, normaliseCode } from "../_shared/invitationCode.ts";

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Promise<Response>): void;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Floor for every response after input validation.
const MIN_RESPONSE_MS = 1500;
// The database claim lasts 2 minutes (claim_invitation). The password is
// only set if it can start well inside that lease, and every request to
// Auth or the database is cut off after FETCH_TIMEOUT_MS, so a slow request
// cannot still be setting the password after its claim has expired and
// been taken over by another request.
const CLAIM_DEADLINE_MS = 30_000;
const FETCH_TIMEOUT_MS = 15_000;

const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_BYTES = 72; // bcrypt limit used by Supabase Auth
const MAX_CODE_LENGTH = 64;

const INVALID_INVITATION_BODY = JSON.stringify({
  error:
    "This invitation is not valid. Check the email address and code, or ask your administrator for a new invitation.",
  code: "invalid_invitation",
});

type Validated = { email: string; code: string; password: string };
type Result<T> = { ok: true; data: T } | { ok: false; response: Response };

function respond(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

function json(status: number, body: Record<string, unknown>): Response {
  return respond(status, JSON.stringify(body));
}

const invalidInput = (error: string) =>
  json(400, { error, code: "invalid_input" });
const invalidInvitation = () => respond(400, INVALID_INVITATION_BODY);
const activationFailed = () =>
  json(500, {
    error: "Activation failed. Contact your administrator.",
    code: "activation_failed",
  });
const unavailable = () =>
  json(503, {
    error: "Activation is temporarily unavailable. Try again in a few minutes.",
    code: "unavailable",
  });

const PASSWORD_ERROR =
  `Password must be at least ${MIN_PASSWORD_LENGTH} characters (and at most ${MAX_PASSWORD_BYTES} bytes).`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Only the email and password get specific errors: their shape says
// nothing about any invitation. A missing or malformed code is reported as
// an invalid invitation, like a wrong one.
function validate(body: Record<string, unknown>): Result<Validated | null> {
  const email =
    typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, response: invalidInput("Enter a valid email address.") };
  }

  const password = typeof body.password === "string" ? body.password : "";
  if (
    password.length < MIN_PASSWORD_LENGTH ||
    new TextEncoder().encode(password).length > MAX_PASSWORD_BYTES
  ) {
    return { ok: false, response: invalidInput(PASSWORD_ERROR) };
  }

  const code = typeof body.code === "string" ? body.code : "";
  const normalised = normaliseCode(code);
  if (normalised.length === 0 || normalised.length > MAX_CODE_LENGTH) {
    return { ok: true, data: null };
  }
  return { ok: true, data: { email, code, password } };
}

function fetchWithTimeout(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  return fetch(input, { ...init, signal });
}

// No generated Database types yet, so RPC rows are untyped (same as
// invite-user); every value read from them is checked at runtime.
// deno-lint-ignore no-explicit-any
type Client = any;
type RpcError = { code?: string } | null;

function logDbError(step: string, error: RpcError) {
  // SQLSTATE only: messages can contain identifying data.
  console.error(`accept-invitation: ${step} failed`, { code: error?.code });
}

async function releaseClaim(admin: Client, invitationId: string, token: string) {
  const { error } = await admin.rpc("release_invitation_claim", {
    p_invitation_id: invitationId,
    p_claim_token: token,
  });
  if (error) logDbError("release_invitation_claim", error);
}

// Auth errors that mean the request definitely did not change the user, so
// the claim can be released. Network failures, timeouts and 5xx responses
// leave the outcome unknown: the claim is then kept until it expires.
function authOutcomeKnown(error: { name?: string; status?: number }): boolean {
  return (
    error.name !== "AuthRetryableFetchError" &&
    typeof error.status === "number" &&
    error.status >= 400 &&
    error.status < 500
  );
}

async function activate(admin: Client, input: Validated): Promise<Response> {
  const { data: rows, error: verifyError } = await admin.rpc(
    "verify_invitation_code",
    { p_email: input.email, p_code_hash: await hashCode(input.code) },
  );
  if (verifyError) {
    logDbError("verify_invitation_code", verifyError);
    return unavailable();
  }
  const row = Array.isArray(rows) ? rows[0] : null;
  if (
    !row?.is_valid ||
    typeof row.invitation_id !== "string" ||
    typeof row.auth_user_id !== "string"
  ) {
    return invalidInvitation();
  }
  const invitationId: string = row.invitation_id;
  const authUserId: string = row.auth_user_id;

  const claimedAt = Date.now();
  const { data: token, error: claimError } = await admin.rpc(
    "claim_invitation",
    { p_invitation_id: invitationId },
  );
  if (claimError) {
    logDbError("claim_invitation", claimError);
    return unavailable();
  }
  if (typeof token !== "string") {
    // Another request holds the claim, or the invitation stopped being
    // valid after verification.
    return invalidInvitation();
  }

  if (Date.now() - claimedAt > CLAIM_DEADLINE_MS) {
    console.error("accept-invitation: claim deadline passed before password update");
    await releaseClaim(admin, invitationId, token);
    return unavailable();
  }

  const { error: authError } = await admin.auth.admin.updateUserById(
    authUserId,
    { password: input.password, email_confirm: true },
  );
  if (authError) {
    console.error("accept-invitation: Auth password update failed", {
      name: authError.name,
      status: authError.status,
      code: authError.code,
    });
    if (!authOutcomeKnown(authError)) {
      // The password may or may not have been set: keep the claim so no
      // other request can set one until it expires.
      return activationFailed();
    }
    await releaseClaim(admin, invitationId, token);
    if (authError.code === "weak_password") {
      return invalidInput(PASSWORD_ERROR);
    }
    return activationFailed();
  }

  const { error: consumeError } = await admin.rpc("consume_invitation", {
    p_invitation_id: invitationId,
    p_claim_token: token,
  });
  if (consumeError) {
    // The password is set but the profile stays inactive. Release the claim
    // so a retry is possible; an admin can also revoke and reissue.
    logDbError("consume_invitation", consumeError);
    await releaseClaim(admin, invitationId, token);
    return activationFailed();
  }

  return json(200, { ok: true });
}

async function handleRequest(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return json(405, { error: "Method not allowed." });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return invalidInput("Request body must be valid JSON.");
  }
  if (!isRecord(body)) {
    return invalidInput("Invalid request body.");
  }

  const validated = validate(body);
  if (!validated.ok) return validated.response;

  // From here on every response is padded to the same minimum time.
  const started = Date.now();
  const response = await (async () => {
    if (validated.data === null) return invalidInvitation();

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      console.error("accept-invitation: environment variables are missing");
      return unavailable();
    }
    // service_role: limited by its grants to the invitation RPCs and the
    // non-secret invitation columns; it never reads code_hash or the claim.
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { fetch: fetchWithTimeout },
    });
    try {
      return await activate(admin, validated.data);
    } catch (error: unknown) {
      // Name only: an exception object could carry request data. Any claim
      // taken is kept until it expires, since the outcome is unknown.
      console.error("accept-invitation: unexpected error", {
        name: error instanceof Error ? error.name : typeof error,
      });
      return activationFailed();
    }
  })();

  const wait = MIN_RESPONSE_MS - (Date.now() - started);
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  return response;
}

Deno.serve(async (request: Request) => {
  try {
    return await handleRequest(request);
  } catch (error: unknown) {
    // Name only: an exception object could carry request data.
    console.error("accept-invitation: unexpected error", {
      name: error instanceof Error ? error.name : typeof error,
    });
    return activationFailed();
  }
});
