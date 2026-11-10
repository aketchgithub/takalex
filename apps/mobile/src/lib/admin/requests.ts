// Access requests for the admin screens. Explicit columns; writes are
// status/notes only and return=minimal (the admin's grants), and the
// access_requests_set_reviewer trigger records the admin as reviewer.

import { z } from "zod";

import { supabase } from "@/lib/supabase";

import type { AccessRequestRow } from "./model";

const embeddedSite = z
  .union([z.object({ name: z.string() }), z.array(z.object({ name: z.string() }))])
  .nullable()
  .transform((value) => (Array.isArray(value) ? (value[0] ?? null) : value));

const rowSchema = z.object({
  id: z.string().uuid(),
  full_name: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  role: z.enum(["collector", "site_manager", "recycler"]),
  site_id: z.string().uuid().nullable(),
  status: z.enum(["submitted", "reviewed", "approved", "invited", "rejected"]),
  created_at: z.string(),
  notes: z.string().nullable(),
  site: embeddedSite,
});

// access_requests has one foreign key to sites; named anyway.
const COLUMNS =
  "id, full_name, email, phone, role, site_id, status, created_at, notes, site:sites!access_requests_site_id_fkey(name)";

function toRow(row: z.infer<typeof rowSchema>): AccessRequestRow {
  return {
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
    role: row.role,
    siteId: row.site_id,
    siteName: row.site?.name ?? null,
    status: row.status,
    createdAt: row.created_at,
    notes: row.notes,
  };
}

export async function listAccessRequests(): Promise<AccessRequestRow[]> {
  const { data, error } = await supabase
    .from("access_requests")
    .select(COLUMNS)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) {
    console.warn(`[admin] access requests query failed: code=${error.code || "none"} message=${error.message}`);
    throw new Error("Could not load access requests. Check your connection and try again.");
  }
  const parsed = z.array(rowSchema).safeParse(data ?? []);
  if (!parsed.success) throw new Error("Access requests could not be read.");
  return parsed.data.map(toRow);
}

export async function getAccessRequest(id: string): Promise<AccessRequestRow | null> {
  const { data, error } = await supabase.from("access_requests").select(COLUMNS).eq("id", id).maybeSingle();
  if (error) throw new Error("Could not load the access request. Check your connection and try again.");
  if (!data) return null;
  const parsed = rowSchema.safeParse(data);
  if (!parsed.success) throw new Error("The access request could not be read.");
  return toRow(parsed.data);
}

const OPEN = ["submitted", "reviewed", "approved"];

// Status change on a request that is still open. The count shows whether
// a row was changed (another admin may have acted first).
async function setStatus(id: string, values: { status: "approved" | "rejected"; notes?: string }): Promise<void> {
  const { error, count } = await supabase
    .from("access_requests")
    .update(values, { count: "exact" })
    .eq("id", id)
    .in("status", OPEN);
  if (error) {
    console.warn(`[admin] access request update failed: code=${error.code || "none"} message=${error.message}`);
    throw new Error("The access request could not be updated. Check your connection and try again.");
  }
  if (count !== 1) {
    throw new Error("This access request has already been invited or rejected. Refresh the list.");
  }
}

// Before inviting: records this admin as the reviewer (the trigger), so the
// later service-role "invited" update keeps them.
export async function approveAccessRequest(id: string): Promise<void> {
  await setStatus(id, { status: "approved" });
}

export async function rejectAccessRequest(id: string, note: string): Promise<void> {
  await setStatus(id, { status: "rejected", notes: note });
}
