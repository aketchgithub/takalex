import { z } from "zod";

import { supabase } from "@/lib/supabase";

export const accessRequestStatusSchema = z.enum([
  "submitted",
  "reviewed",
  "approved",
  "invited",
  "rejected",
]);

export const accessRequestRoleSchema = z.enum([
  "collector",
  "site_manager",
  "recycler",
]);

// Mirrors access_request_phone_format in
// supabase/migrations/003_public_access_flow.sql: optional leading "+",
// then digits, spaces, parentheses or hyphens; 7 to 15 digits; max 32 chars.
// Accepts 0712345678, 0110123456, +254712345678, 254712345678,
// +254 712 345 678 and 0712-345-678.
const PHONE_ALLOWED_CHARACTERS = /^\+?[0-9 ()-]+$/;
const PHONE_MIN_DIGITS = 7;
const PHONE_MAX_DIGITS = 15;

function countDigits(value: string): number {
  return value.replace(/[^0-9]/g, "").length;
}

// An empty string means "not provided"; the payload sends null instead.
const phoneSchema = z
  .string()
  .trim()
  .max(32, "Phone number is too long.")
  .refine(
    (value) => value === "" || PHONE_ALLOWED_CHARACTERS.test(value),
    "Phone numbers may only contain digits, spaces, brackets, hyphens and a leading +.",
  )
  .refine(
    (value) => {
      if (value === "") {
        return true;
      }

      const digits = countDigits(value);
      return digits >= PHONE_MIN_DIGITS && digits <= PHONE_MAX_DIGITS;
    },
    "Phone number must contain between 7 and 15 digits, for example 0712345678 or +254712345678.",
  );

// Length matches the database (254). The format check is the standard
// email check, which is stricter than the database's basic shape check.
const emailSchema = z
  .string()
  .trim()
  .max(254, "Email address is too long.")
  .refine(
    (value) => value === "" || z.email().safeParse(value).success,
    "Enter a valid email address.",
  );

// Used by both the request form and submitAccessRequest so they always agree.
// Lengths mirror the access_requests CHECK constraints.
export const submitAccessRequestSchema = z.object({
  full_name: z
    .string()
    .trim()
    .min(2, "Enter your full name.")
    .max(150, "Name must be 150 characters or fewer."),
  email: emailSchema.optional(),
  phone: phoneSchema.optional(),
  role: accessRequestRoleSchema.default("collector"),
  site_name: z
    .string()
    .trim()
    .max(120, "Site name is too long.")
    .optional()
    .or(z.literal("")),
  referral_source: z
    .string()
    .trim()
    .max(200, "Referral source is too long.")
    .optional()
    .or(z.literal("")),
}).refine(
  (data) => Boolean(data.email?.trim() || data.phone?.trim()),
  { message: "Provide an email address or phone number." },
);

export type AccessRequestStatus = z.infer<typeof accessRequestStatusSchema>;
export type AccessRequestRole = z.infer<typeof accessRequestRoleSchema>;

export type AccessRequestRecord = {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  role: AccessRequestRole;
  site_name: string | null;
  referral_source: string | null;
  status: AccessRequestStatus;
  created_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  notes: string | null;
};

export type SubmitAccessRequestResult = {
  error: { message: string } | null;
};

// Anonymous users have INSERT on a limited set of columns and no SELECT on
// access_requests, so the row is inserted without reading it back
// (no .select()). Success is the absence of an error.
export async function submitAccessRequest(
  input: z.input<typeof submitAccessRequestSchema>,
): Promise<SubmitAccessRequestResult> {
  const parsed = submitAccessRequestSchema.safeParse(input);

  if (!parsed.success) {
    return {
      error: {
        message: parsed.error.issues[0]?.message
          ?? "Request could not be submitted.",
      },
    };
  }

  // Only columns granted to anon may be sent. status, reviewer fields,
  // notes, id and created_at are set by the database.
  const payload = {
    full_name: parsed.data.full_name,
    email: parsed.data.email?.trim() || null,
    phone: parsed.data.phone?.trim() || null,
    role: parsed.data.role,
    site_name: parsed.data.site_name?.trim() || null,
    referral_source: parsed.data.referral_source?.trim() || null,
  };

  const { error } = await supabase.from("access_requests").insert(payload);

  if (!error) {
    return { error: null };
  }

  // Do not show raw database messages to public users.
  if (error.code === "23514") {
    return {
      error: {
        message:
          "Some details could not be accepted. Check your name, email address and phone number.",
      },
    };
  }

  return {
    error: {
      message: "Your request could not be submitted. Please try again later.",
    },
  };
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

  if (!userData.user) {
    return {
      data: null,
      error: { message: "You must sign in to review access requests." },
    } as const;
  }

  // Admins may only update status and notes. reviewed_by and reviewed_at
  // are set by the database (access_requests_set_reviewer trigger).
  const { data, error } = await supabase
    .from("access_requests")
    .update({
      status,
      notes: notes?.trim() || null,
    })
    .eq("id", id)
    .select()
    .single();

  return { data, error };
}
