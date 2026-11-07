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
// Lengths mirror the access_requests CHECK constraints. Collectors must choose
// their group, which is their site (access_request_collector_site_required);
// for site managers and recyclers the site is optional.
export const submitAccessRequestSchema = z.object({
  full_name: z
    .string()
    .trim()
    .min(2, "Enter your full name.")
    .max(150, "Name must be 150 characters or fewer."),
  email: emailSchema.optional(),
  phone: phoneSchema.optional(),
  role: accessRequestRoleSchema.default("collector"),
  site_id: z.string().uuid("Choose a site from the list.").nullable().optional(),
  referral_source: z
    .string()
    .trim()
    .max(200, "Referral source is too long.")
    .optional()
    .or(z.literal("")),
}).refine(
  (data) => Boolean(data.email?.trim() || data.phone?.trim()),
  { message: "Provide an email address or phone number." },
).refine(
  (data) => data.role !== "collector" || Boolean(data.site_id),
  { message: "Choose your group (site)." },
);

export type PublicSiteOption = { id: string; name: string };

const publicSiteOptionsSchema = z.array(
  z.object({ id: z.string().uuid(), name: z.string() }),
);

// Active sites for the public form, through the narrow public_site_options()
// function (anon has no access to the sites table itself).
export async function getPublicSiteOptions(): Promise<PublicSiteOption[]> {
  const { data, error } = await supabase.rpc("public_site_options");

  if (error) {
    throw new Error("Could not load the list of sites. Please try again.");
  }

  const parsed = publicSiteOptionsSchema.safeParse(data ?? []);
  if (!parsed.success) {
    throw new Error("The list of sites could not be read.");
  }

  return parsed.data;
}

export type AccessRequestStatus = z.infer<typeof accessRequestStatusSchema>;
export type AccessRequestRole = z.infer<typeof accessRequestRoleSchema>;

export type AccessRequestRecord = {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  role: AccessRequestRole;
  site_id: string | null;
  site: { name: string } | null;
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
    site_id: parsed.data.site_id || null,
    referral_source: parsed.data.referral_source?.trim() || null,
  };

  const { error } = await supabase.from("access_requests").insert(payload);

  if (!error) {
    return { error: null };
  }

  // Do not show raw database messages to public users.
  // 42501: the insert policy refused the row. With valid input that means
  // the chosen site is no longer active.
  if (error.code === "42501") {
    return {
      error: {
        message:
          "The selected site is no longer available. Reload the list and choose another site.",
      },
    };
  }

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

// The embedded site may come back as an object or a one-element array
// (the client has no generated types); either way it becomes { name } | null.
const embeddedSiteSchema = z
  .union([z.object({ name: z.string() }), z.array(z.object({ name: z.string() }))])
  .nullable()
  .transform((value) => (Array.isArray(value) ? value[0] ?? null : value));

const accessRequestRowSchema = z.object({
  id: z.string().uuid(),
  full_name: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  role: accessRequestRoleSchema,
  site_id: z.string().uuid().nullable(),
  site: embeddedSiteSchema,
  referral_source: z.string().nullable(),
  status: accessRequestStatusSchema,
  created_at: z.string(),
  reviewed_by: z.string().uuid().nullable(),
  reviewed_at: z.string().nullable(),
  notes: z.string().nullable(),
});

// Explicit columns (no select("*")), with the requested site's name. Admins
// can read every site under sites_read_assigned.
export async function getAccessRequests(): Promise<{
  data: AccessRequestRecord[] | null;
  error: { message: string } | null;
}> {
  const { data, error } = await supabase
    .from("access_requests")
    .select(
      "id, full_name, email, phone, role, site_id, referral_source, status, created_at, reviewed_by, reviewed_at, notes, site:sites(name)",
    )
    .order("created_at", { ascending: false });

  if (error) {
    return { data: null, error };
  }

  const parsed = z.array(accessRequestRowSchema).safeParse(data ?? []);
  if (!parsed.success) {
    return { data: null, error: { message: "Access requests could not be read." } };
  }

  return { data: parsed.data, error: null };
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
