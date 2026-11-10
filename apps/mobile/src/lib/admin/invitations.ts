// Invitations for the admin screen. Explicit columns only (never code_hash
// or the claim columns, which no API role can read anyway). Revoke goes
// through revoke_invitation(); reissue through invite-user.

import { z } from "zod";

import { readFunctionFailure } from "@/lib/functions";
import { supabase } from "@/lib/supabase";
import { inviteRoleSchema, type InviteRole } from "@/types/auth";

export type InvitationRow = {
  id: string;
  authUserId: string;
  email: string;
  fullName: string | null;
  role: InviteRole;
  status: string;
  failedAttempts: number;
  expiresAt: string;
  createdAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
};

const rowSchema = z.object({
  id: z.string().uuid(),
  auth_user_id: z.string().uuid(),
  email: z.string(),
  role: inviteRoleSchema,
  status: z.string(),
  failed_attempts: z.number(),
  expires_at: z.string(),
  created_at: z.string(),
  accepted_at: z.string().nullable(),
  revoked_at: z.string().nullable(),
});

const COLUMNS = "id, auth_user_id, email, role, status, failed_attempts, expires_at, created_at, accepted_at, revoked_at";

export async function listInvitations(): Promise<InvitationRow[]> {
  const { data, error } = await supabase
    .from("invitations")
    .select(COLUMNS)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) {
    console.warn(`[admin] invitations query failed: code=${error.code || "none"} message=${error.message}`);
    throw new Error("Could not load invitations. Check your connection and try again.");
  }
  const parsed = z.array(rowSchema).safeParse(data ?? []);
  if (!parsed.success) throw new Error("Invitations could not be read.");

  // Names from the invitees' profiles (admins can read every profile). A
  // failure only hides the names.
  const ids = [...new Set(parsed.data.map((row) => row.auth_user_id))];
  const names = new Map<string, string | null>();
  if (ids.length) {
    const { data: profiles, error: profileError } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", ids);
    if (!profileError) {
      for (const p of z.array(z.object({ id: z.string(), full_name: z.string().nullable() })).parse(profiles ?? [])) {
        names.set(p.id, p.full_name);
      }
    }
  }

  return parsed.data.map((row) => ({
    id: row.id,
    authUserId: row.auth_user_id,
    email: row.email,
    fullName: names.get(row.auth_user_id) ?? null,
    role: row.role,
    status: row.status,
    failedAttempts: row.failed_attempts,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    acceptedAt: row.accepted_at,
    revokedAt: row.revoked_at,
  }));
}

const REVOKE_MESSAGES: [string, string][] = [
  ["Only pending invitations can be revoked", "Only pending invitations can be revoked. Refresh the list."],
  ["Revoking administrator is not active or authorized", "Only active administrators can revoke invitations."],
];

// Returns null on success, or the message to show.
export async function revokeInvitation(id: string): Promise<string | null> {
  try {
    const { error } = await supabase.rpc("revoke_invitation", { p_invitation_id: id });
    if (!error) return null;
    for (const [needle, text] of REVOKE_MESSAGES) if (error.message.includes(needle)) return text;
    console.warn(`[admin] revoke_invitation failed: code=${error.code || "none"}`);
    return "The invitation could not be revoked. Try again.";
  } catch {
    return "No connection to Takalex. Check your connection and try again.";
  }
}

export type IssuedCode = { invitationId: string; code: string; expiresAt: string | null };

export async function reissueInvitation(id: string): Promise<{ ok: true; issued: IssuedCode } | { ok: false; message: string }> {
  try {
    const { data, error } = await supabase.functions.invoke("invite-user", {
      body: { action: "reissue", invitationId: id },
    });
    if (error) {
      const failure = await readFunctionFailure(error);
      if (failure.kind === "network") {
        return { ok: false, message: "No connection to Takalex. Check your connection and try again." };
      }
      if (failure.status === 401) return { ok: false, message: "Your session has expired. Sign out and sign in again." };
      return { ok: false, message: failure.message ?? "The invitation could not be reissued." };
    }
    if (typeof data?.invitationId !== "string" || typeof data?.code !== "string") {
      return { ok: false, message: "The invitation service returned an unexpected response." };
    }
    return {
      ok: true,
      issued: {
        invitationId: data.invitationId,
        code: data.code,
        expiresAt: typeof data.expiresAt === "string" ? data.expiresAt : null,
      },
    };
  } catch {
    return { ok: false, message: "No connection to Takalex. Check your connection and try again." };
  }
}
