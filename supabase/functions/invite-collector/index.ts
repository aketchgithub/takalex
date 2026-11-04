// @ts-ignore Deno resolves this remote module at runtime.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

type InvitePayload = {
  email: string;
  fullName: string;
  role: InviteRole;
  siteIds: string[];
};

function respond(
  status: number,
  body: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function validatePayload(
  value: unknown,
):
  | { success: true; data: InvitePayload }
  | { success: false; error: string } {
  if (!isRecord(value)) {
    return { success: false, error: "Invalid request body." };
  }

  const email =
    typeof value.email === "string"
      ? value.email.trim().toLowerCase()
      : "";

  if (
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    return { success: false, error: "Enter a valid email address." };
  }

  const fullName =
    typeof value.fullName === "string" ? value.fullName.trim() : "";

  if (fullName.length < 2 || fullName.length > 120) {
    return {
      success: false,
      error: "Full name must contain between 2 and 120 characters.",
    };
  }

  const role = value.role;

  if (
    typeof role !== "string" ||
    !allowedRoles.includes(role as InviteRole)
  ) {
    return {
      success: false,
      error: "Select a valid invitation role.",
    };
  }

  if (
    !Array.isArray(value.siteIds) ||
    value.siteIds.length === 0 ||
    !value.siteIds.every(
      (siteId): siteId is string =>
        typeof siteId === "string" && isUuid(siteId),
    )
  ) {
    return {
      success: false,
      error: "Select at least one valid site.",
    };
  }

  const siteIds = value.siteIds as string[];

  if (new Set(siteIds).size !== siteIds.length) {
    return {
      success: false,
      error: "Duplicate site assignments are not allowed.",
    };
  }

  return {
    success: true,
    data: {
      email,
      fullName,
      role: role as InviteRole,
      siteIds,
    },
  };
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
    return respond(401, {
      error: "Sign in with an administrator account.",
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    console.error("Invitation service environment variables are missing.");
    return respond(500, {
      error: "Invitation service is not configured.",
    });
  }

  // Verify the requesting user's identity using their access token.
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: {
      headers: { Authorization: authorization },
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const { data: userData, error: userError } =
    await callerClient.auth.getUser();

  if (userError || !userData.user) {
    return respond(401, {
      error: "Your session is invalid. Sign in again.",
    });
  }

  // Verify that the caller is an active administrator.
  const { data: profile, error: profileError } = await callerClient
    .from("profiles")
    .select("role, is_active")
    .eq("id", userData.user.id)
    .maybeSingle();

  if (profileError) {
    console.error("Could not verify administrator profile:", profileError);
    return respond(500, {
      error: "Could not verify administrator access.",
    });
  }

  if (profile?.role !== "admin" || profile.is_active !== true) {
    return respond(403, {
      error: "Only active administrators can send invitations.",
    });
  }

  // Validate the invitation request before using the service-role client.
  let requestBody: unknown;

  try {
    requestBody = await request.json();
  } catch {
    return respond(400, {
      error: "Request body must be valid JSON.",
    });
  }

  const validation = validatePayload(requestBody);

  if (!validation.success) {
    return respond(400, { error: validation.error });
  }

  const { email, fullName, role, siteIds } = validation.data;

  // The service-role key is used only inside this server-side function.
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  // Give a clear response for an existing pending invitation.
  // The database unique index remains the final protection against races.
  const { data: existingInvitation, error: existingInvitationError } =
    await adminClient
      .from("invitations")
      .select("id")
      .eq("email", email)
      .eq("status", "pending")
      .limit(1)
      .maybeSingle();

  if (existingInvitationError) {
    console.error(
      "Could not check for an existing pending invitation:",
      existingInvitationError,
    );
    return respond(500, {
      error: "Could not verify whether this email can be invited.",
    });
  }

  if (existingInvitation) {
    return respond(409, {
      error: "A pending invitation already exists for this email address.",
    });
  }

  // Supabase sends the invitation email as part of this operation.
  const { data: inviteData, error: inviteError } =
    await adminClient.auth.admin.inviteUserByEmail(email, {
      redirectTo: "takalex://auth/callback",
      data: {
        full_name: fullName,
      },
    });

  if (inviteError || !inviteData.user) {
    console.error("Supabase Auth invitation failed:", inviteError);
    return respond(400, {
      error: "Could not create the invitation. Check the email and try again.",
    });
  }

  const invitedUserId = inviteData.user.id;

  // Register the role, site assignments and invitation in one DB transaction.
  const { error: registrationError } = await adminClient.rpc(
    "register_invitation",
    {
      p_auth_user_id: invitedUserId,
      p_email: email,
      p_full_name: fullName,
      p_role: role,
      p_site_ids: siteIds,
      p_invited_by: userData.user.id,
    },
  );

  if (registrationError) {
    console.error(
      "Invitation database registration failed:",
      registrationError,
    );

    // Remove the Auth user created above if database registration fails.
    // This cannot retract an invitation email that Supabase may already have sent.
    const { error: cleanupError } =
      await adminClient.auth.admin.deleteUser(invitedUserId);

    if (cleanupError) {
      console.error(
        "Could not clean up incomplete invited user:",
        cleanupError,
      );
    }

    return respond(500, {
      error:
        "Invitation setup failed. If an invitation email was received, its link may not work. Please contact an administrator before trying again.",
    });
  }

  return respond(200, {
    message: `Invitation sent to ${email}.`,
  });
}

Deno.serve(async (request: Request) => {
  try {
    return await handleRequest(request);
  } catch (error: unknown) {
    console.error("Unexpected invitation error:", error);

    return respond(500, {
      error: "The invitation could not be completed.",
    });
  }
});
