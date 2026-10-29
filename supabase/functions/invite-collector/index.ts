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

function respond(status: number, body: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
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
    return respond(500, { error: "Invitation service is not configured." });
  }

  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: userData, error: userError } =
    await callerClient.auth.getUser();
  if (userError || !userData.user) {
    return respond(401, { error: "Your session is invalid. Sign in again." });
  }

  const { data: profile, error: profileError } = await callerClient
    .from("profiles")
    .select("role, is_active")
    .eq("id", userData.user.id)
    .maybeSingle();

  if (profileError) {
    return respond(500, { error: "Could not verify administrator access." });
  }
  if (profile?.role !== "admin" || !profile.is_active) {
    return respond(403, { error: "Only active administrators can invite collectors." });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return respond(400, { error: "Request body must be valid JSON." });
  }

  if (
    typeof payload !== "object" ||
    payload === null ||
    !("email" in payload) ||
    typeof payload.email !== "string"
  ) {
    return respond(400, { error: "A valid email address is required." });
  }

  const email = payload.email.trim().toLowerCase();
  if (
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    return respond(400, { error: "Enter a valid email address." });
  }

  const fullName =
    "fullName" in payload && typeof payload.fullName === "string"
      ? payload.fullName.trim().slice(0, 120)
      : "";

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(
    email,
    {
      redirectTo: "takalex://auth/callback",
      data: fullName ? { full_name: fullName } : {},
    },
  );

  if (inviteError) {
    return respond(400, { error: inviteError.message });
  }

  return respond(200, { message: "Collector invitation sent." });
}

Deno.serve(async (request: Request) => {
  try {
    return await handleRequest(request);
  } catch (error: unknown) {
    console.error("Unexpected collector invitation error:", error);
    return respond(500, { error: "The invitation could not be completed." });
  }
});
