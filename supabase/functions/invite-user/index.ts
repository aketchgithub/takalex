// invite-user: admin-only invitation Edge Function (code-based design,
// docs/demo-plan.md section 1.1).
//
// POST { action: "create", email, fullName, role, siteIds? }
// POST { action: "reissue", invitationId, fullName?, role?, siteIds? }
//   -> 201 { invitationId, code, expiresAt }
//
// The plain invitation code is returned to the calling admin exactly once.
// It is never logged or stored: the database only receives the lowercase hex
// SHA-256 of the normalised code (uppercase, separators removed).

import { createClient } from "../_shared/supabase.ts";
import { hashCode } from "../_shared/invitationCode.ts";

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

const allowedRoles = ["collector", "site_manager", "recycler"] as const;
type InviteRole = (typeof allowedRoles)[number];

const MAX_SITES = 50;

// No 0/O, 1/I/L: 31 symbols that cannot be misread when copied by hand.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 12;

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

type CreateInput = {
  email: string;
  fullName: string;
  role: InviteRole;
  siteIds: string[];
};

type ReissueInput = {
  invitationId: string;
  fullName: string | null;
  role: InviteRole | null;
  siteIds: string[] | null;
};

type DbError = { code?: string; message?: string } | null;

function respond(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      // The response may carry a one-time code.
      "Cache-Control": "no-store",
    },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  );
}

function isInviteRole(value: unknown): value is InviteRole {
  return (
    typeof value === "string" && allowedRoles.includes(value as InviteRole)
  );
}

function validateFullName(value: unknown): Result<string> {
  const fullName = typeof value === "string" ? value.trim() : "";
  if (fullName.length < 2 || fullName.length > 120) {
    return {
      ok: false,
      error: "Full name must contain between 2 and 120 characters.",
    };
  }
  return { ok: true, data: fullName };
}

function validateSiteIds(value: unknown): Result<string[]> {
  if (
    !Array.isArray(value) ||
    value.length > MAX_SITES ||
    !value.every(isUuid)
  ) {
    return { ok: false, error: "Site selection is invalid." };
  }
  const siteIds = value.map((id) => id.toLowerCase());
  if (new Set(siteIds).size !== siteIds.length) {
    return { ok: false, error: "Duplicate site assignments are not allowed." };
  }
  return { ok: true, data: siteIds };
}

const SITES_REQUIRED =
  "Collectors and site managers must be assigned at least one site.";
// A collector's site is their group (Chemolex, 7 Nov).
const COLLECTOR_ONE_SITE = "A collector must be assigned exactly one site.";

// Site-count rule per role, checked before any Auth user is created; the
// database functions enforce the same rule.
function siteCountError(role: InviteRole, siteIds: string[]): string | null {
  if (role !== "recycler" && siteIds.length === 0) return SITES_REQUIRED;
  if (role === "collector" && siteIds.length !== 1) return COLLECTOR_ONE_SITE;
  return null;
}

function validateCreate(body: Record<string, unknown>): Result<CreateInput> {
  const email =
    typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: "Enter a valid email address." };
  }

  const fullName = validateFullName(body.fullName);
  if (!fullName.ok) return fullName;

  if (!isInviteRole(body.role)) {
    return { ok: false, error: "Select a valid invitation role." };
  }
  const role = body.role;

  let siteIds: string[] = [];
  if (body.siteIds !== undefined && body.siteIds !== null) {
    const sites = validateSiteIds(body.siteIds);
    if (!sites.ok) return sites;
    siteIds = sites.data;
  }
  const siteError = siteCountError(role, siteIds);
  if (siteError) {
    return { ok: false, error: siteError };
  }

  return { ok: true, data: { email, fullName: fullName.data, role, siteIds } };
}

function validateReissue(body: Record<string, unknown>): Result<ReissueInput> {
  if (!isUuid(body.invitationId)) {
    return { ok: false, error: "A valid invitation ID is required." };
  }

  let fullName: string | null = null;
  if (body.fullName !== undefined && body.fullName !== null) {
    const result = validateFullName(body.fullName);
    if (!result.ok) return result;
    fullName = result.data;
  }

  let role: InviteRole | null = null;
  if (body.role !== undefined && body.role !== null) {
    if (!isInviteRole(body.role)) {
      return { ok: false, error: "Select a valid invitation role." };
    }
    role = body.role;
  }

  let siteIds: string[] | null = null;
  if (body.siteIds !== undefined && body.siteIds !== null) {
    const result = validateSiteIds(body.siteIds);
    if (!result.ok) return result;
    siteIds = result.data;
  }

  return {
    ok: true,
    data: { invitationId: body.invitationId.toLowerCase(), fullName, role, siteIds },
  };
}

// Uniform over the alphabet: bytes >= 248 (8 * 31) are rejected, so there is
// no modulo bias.
function generateCode(): string {
  const limit = Math.floor(256 / CODE_ALPHABET.length) * CODE_ALPHABET.length;
  const chars: string[] = [];
  const buffer = new Uint8Array(32);
  while (chars.length < CODE_LENGTH) {
    crypto.getRandomValues(buffer);
    for (const byte of buffer) {
      if (byte < limit && chars.length < CODE_LENGTH) {
        chars.push(CODE_ALPHABET[byte % CODE_ALPHABET.length]);
      }
    }
  }
  const raw = chars.join("");
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
}

// Admin-facing messages for the exceptions raised by register_invitation and
// reissue_invitation. Anything else becomes a generic message; raw SQL errors
// are never returned.
const DB_MESSAGES: Array<[string, number, string]> = [
  ["Inviting administrator is not active or authorized", 403,
    "Only active administrators can send invitations."],
  ["Invalid invitation role", 400, "Select a valid invitation role."],
  ["An email address is required", 400, "Enter a valid email address."],
  ["A full name is required", 400,
    "Full name must contain between 2 and 120 characters."],
  ["At least one site assignment is required", 400, SITES_REQUIRED],
  ["A collector must be assigned exactly one site", 400, COLLECTOR_ONE_SITE],
  ["Duplicate site assignments are not allowed", 400,
    "Duplicate site assignments are not allowed."],
  ["One or more selected sites are invalid or inactive", 400,
    "One or more selected sites do not exist or are inactive."],
  ["Cannot invite an already confirmed account", 409,
    "This email already belongs to an active account."],
  ["The invited user profile is missing or already active", 409,
    "This user's account is already active, so it cannot be invited again."],
  ["Invitation not found", 404, "Invitation not found."],
  ["Only expired or revoked invitations can be reissued", 409,
    "Only expired or revoked invitations can be reissued. Revoke a pending invitation first."],
  ["This user has already accepted an invitation", 409,
    "This user has already accepted an invitation."],
  ["This user already has another pending invitation", 409,
    "This user already has another pending invitation."],
];

function mapDbError(error: DbError): { status: number; error: string } {
  const message = error?.message ?? "";
  for (const [needle, status, text] of DB_MESSAGES) {
    if (message.includes(needle)) return { status, error: text };
  }
  if (error?.code === "23505") {
    return {
      status: 409,
      error: "A pending invitation already exists for this email address.",
    };
  }
  // Log the SQLSTATE only: messages can contain email addresses.
  console.error("Invitation database call failed", { code: error?.code });
  return { status: 500, error: "The invitation could not be saved. Try again." };
}

// deno-lint-ignore no-explicit-any
type Client = any;

async function readExpiresAt(admin: Client, invitationId: string) {
  const { data, error } = await admin
    .from("invitations")
    .select("expires_at")
    .eq("id", invitationId)
    .single();
  if (error || !data) {
    console.error("Could not read invitation expiry", { code: error?.code });
    return null;
  }
  return data.expires_at as string;
}

async function handleCreate(
  admin: Client,
  callerId: string,
  input: CreateInput,
): Promise<Response> {
  const { data: created, error: createError } =
    await admin.auth.admin.createUser({
      email: input.email,
      email_confirm: false,
      user_metadata: { full_name: input.fullName },
    });

  if (createError || !created?.user) {
    if (createError?.code === "email_exists" || createError?.status === 422) {
      return respond(409, {
        error:
          "An account with this email already exists. If its invitation expired or was revoked, reissue that invitation instead.",
      });
    }
    console.error("Auth user creation failed", {
      code: createError?.code,
      status: createError?.status,
    });
    return respond(500, { error: "Could not create the invited account." });
  }

  const authUserId: string = created.user.id;
  const code = generateCode();

  const { data: invitationId, error: registerError } = await admin.rpc(
    "register_invitation",
    {
      p_auth_user_id: authUserId,
      p_email: input.email,
      p_full_name: input.fullName,
      p_role: input.role,
      p_site_ids: input.siteIds,
      p_invited_by: callerId,
      p_code_hash: await hashCode(code),
    },
  );

  if (registerError || !isUuid(invitationId)) {
    // Nothing was committed by the RPC; remove the Auth user so the email
    // can be invited again.
    const { error: cleanupError } =
      await admin.auth.admin.deleteUser(authUserId);
    if (cleanupError) {
      console.error("Could not delete Auth user after failed registration", {
        code: cleanupError.code,
        status: cleanupError.status,
      });
    }
    const mapped = mapDbError(registerError);
    return respond(mapped.status, { error: mapped.error });
  }

  const expiresAt = await readExpiresAt(admin, invitationId);
  return respond(201, { invitationId, code, expiresAt });
}

async function handleReissue(
  admin: Client,
  callerId: string,
  input: ReissueInput,
): Promise<Response> {
  // Fill omitted fields from the current invitation, profile and sites.
  const { data: old, error: oldError } = await admin
    .from("invitations")
    .select("auth_user_id, role")
    .eq("id", input.invitationId)
    .maybeSingle();
  if (oldError) {
    console.error("Could not read invitation", { code: oldError.code });
    return respond(500, { error: "Could not load the invitation." });
  }
  if (!old) return respond(404, { error: "Invitation not found." });

  let fullName = input.fullName;
  if (fullName === null) {
    const { data: profile, error } = await admin
      .from("profiles")
      .select("full_name")
      .eq("id", old.auth_user_id)
      .maybeSingle();
    if (error) {
      console.error("Could not read invitee profile", { code: error.code });
      return respond(500, { error: "Could not load the invitation." });
    }
    fullName = profile?.full_name ?? null;
    if (!fullName) {
      return respond(400, {
        error: "Full name must contain between 2 and 120 characters.",
      });
    }
  }

  const role: InviteRole = input.role ?? old.role;

  let siteIds: string[];
  if (input.siteIds !== null) {
    siteIds = input.siteIds;
  } else {
    const { data: rows, error } = await admin
      .from("user_sites")
      .select("site_id")
      .eq("user_id", old.auth_user_id);
    if (error) {
      console.error("Could not read invitee sites", { code: error.code });
      return respond(500, { error: "Could not load the invitation." });
    }
    siteIds = (rows ?? []).map((row: { site_id: string }) => row.site_id);
  }
  const siteError = siteCountError(role, siteIds);
  if (siteError) {
    return respond(400, { error: siteError });
  }

  const code = generateCode();
  const { data: newId, error: reissueError } = await admin.rpc(
    "reissue_invitation",
    {
      p_old_invitation_id: input.invitationId,
      p_invited_by: callerId,
      p_code_hash: await hashCode(code),
      p_full_name: fullName,
      p_role: role,
      p_site_ids: siteIds,
    },
  );

  if (reissueError || !isUuid(newId)) {
    const mapped = mapDbError(reissueError);
    return respond(mapped.status, { error: mapped.error });
  }

  const expiresAt = await readExpiresAt(admin, newId);
  return respond(201, { invitationId: newId, code, expiresAt });
}

async function handleRequest(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return respond(405, { error: "Method not allowed." });
  }

  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return respond(401, { error: "Sign in with an administrator account." });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    console.error("Invitation service environment variables are missing.");
    return respond(500, { error: "Invitation service is not configured." });
  }

  const authOptions = { autoRefreshToken: false, persistSession: false };

  // Caller check with the caller's own JWT: identity, then is_active_admin()
  // evaluated as that user (auth.uid()), not as service_role.
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: authOptions,
  });

  const { data: userData, error: userError } = await callerClient.auth.getUser();
  if (userError || !userData?.user) {
    return respond(401, { error: "Your session is invalid. Sign in again." });
  }

  const { data: isAdmin, error: adminError } =
    await callerClient.rpc("is_active_admin");
  if (adminError) {
    console.error("Could not verify administrator access", {
      code: adminError.code,
    });
    return respond(500, { error: "Could not verify administrator access." });
  }
  if (isAdmin !== true) {
    return respond(403, {
      error: "Only active administrators can send invitations.",
    });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return respond(400, { error: "Request body must be valid JSON." });
  }
  if (!isRecord(body)) {
    return respond(400, { error: "Invalid request body." });
  }

  // service_role: used only after the caller is confirmed as an admin, and
  // limited by its column grants (no code_hash, no direct writes).
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: authOptions });

  if (body.action === "create") {
    const input = validateCreate(body);
    if (!input.ok) return respond(400, { error: input.error });
    return handleCreate(admin, userData.user.id, input.data);
  }
  if (body.action === "reissue") {
    const input = validateReissue(body);
    if (!input.ok) return respond(400, { error: input.error });
    return handleReissue(admin, userData.user.id, input.data);
  }
  return respond(400, { error: 'action must be "create" or "reissue".' });
}

Deno.serve(async (request: Request) => {
  try {
    return await handleRequest(request);
  } catch (error: unknown) {
    // Name only: an exception object could carry request data.
    console.error("Unexpected invitation error", {
      name: error instanceof Error ? error.name : typeof error,
    });
    return respond(500, { error: "The invitation could not be completed." });
  }
});
