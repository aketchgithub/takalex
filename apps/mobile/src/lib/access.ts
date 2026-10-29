import { z } from "zod";

import { supabase } from "@/lib/supabase";

export const accessRequestStatusSchema = z.enum([
  "submitted",
  "reviewed",
  "approved",
  "invited",
  "rejected",
]);

export const submitAccessRequestSchema = z.object({
  full_name: z.string().trim().min(2, "Enter the applicant's full name."),
  email: z.string().trim().email("Enter a valid email address. ").optional().or(z.literal("")),
  phone: z.string().trim().regex(/^\+?[1-9]\d{7,14}$/, "Use an international phone number, for example +254712345678. ").optional().or(z.literal("")),
  role: z.enum(["collector", "admin", "recycler"]).default("collector"),
  site_name: z.string().trim().max(120, "Site name is too long.").optional().or(z.literal("")),
  referral_source: z.string().trim().max(200, "Referral source is too long.").optional().or(z.literal("")),
});

export type AccessRequestStatus = z.infer<typeof accessRequestStatusSchema>;

export type AccessRequestRecord = {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  role: "collector" | "admin" | "recycler";
  site_name: string | null;
  referral_source: string | null;
  status: AccessRequestStatus;
  created_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  notes: string | null;
};

export async function submitAccessRequest(input: z.input<typeof submitAccessRequestSchema>) {
  const parsed = submitAccessRequestSchema.safeParse(input);
  if (!parsed.success) {
    return {
      data: null,
      error: { message: parsed.error.issues[0]?.message ?? "Request could not be submitted." },
    } as const;
  }

  const payload = {
    full_name: parsed.data.full_name,
    email: parsed.data.email?.trim() || null,
    phone: parsed.data.phone?.trim() || null,
    role: parsed.data.role,
    site_name: parsed.data.site_name?.trim() || null,
    referral_source: parsed.data.referral_source?.trim() || null,
    status: "submitted" as const,
  };

  const { data, error } = await supabase.from("access_requests").insert(payload).select().single();

  return { data, error };
}

export async function getAccessRequests() {
  const { data, error } = await supabase
    .from("access_requests")
    .select("*")
    .order("created_at", { ascending: false });

  return { data, error };
}

export async function updateAccessRequestStatus(
  id: string,
  status: AccessRequestStatus,
  notes?: string,
) {
  const { data: userData } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from("access_requests")
    .update({
      status,
      reviewed_by: userData.user?.id ?? null,
      reviewed_at: new Date().toISOString(),
      notes: notes?.trim() || null,
    })
    .eq("id", id)
    .select()
    .single();

  return { data, error };
}

export async function createInvitationForRequest(
  accessRequest: Pick<AccessRequestRecord, "email" | "phone" | "full_name" | "role" | "site_name">,
) {
  if (!accessRequest.email && !accessRequest.phone) {
    return {
      data: null,
      error: { message: "An email or phone number is required to create an invitation." },
    } as const;
  }

  const { data: userData } = await supabase.auth.getUser();
  const payload = {
    email: accessRequest.email || null,
    phone: accessRequest.phone || null,
    invited_by: userData.user?.id ?? null,
    role: accessRequest.role,
    site_name: accessRequest.site_name || null,
    status: "pending",
    token: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
  };

  const { data, error } = await supabase.from("invitations").insert(payload).select().single();

  return { data, error };
}
