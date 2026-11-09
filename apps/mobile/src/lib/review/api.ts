// Site manager reads and the review call. Explicit columns only, under RLS:
// collections_read_permitted / evidence_read_permitted /
// verified_items_read_permitted let a manager read rows for sites they can
// review (can_review_site), and every query also filters by the manager's
// own assigned sites to state that intent. Collector names come from
// reviewable_collector_names() (007), never from profiles. Reviews go
// through review_collection() only.
//
// Embed rule: collection_logs reaches materials both directly
// (material_code) and through collection_verified_items, so every materials
// embed names its foreign key (PGRST201 otherwise).

import { z } from "zod";

import { loadAccountSummary, type AssignedSite } from "@/lib/account";
import type { DeliveryStatus } from "@/lib/outbox/presentation";
import { supabase } from "@/lib/supabase";
import type { Profile } from "@/types/auth";

import { reviewErrorMessage, type RpcBreakdownItem, type VerifiableMaterial } from "./model";

const EVIDENCE_BUCKET = "collection-evidence";
// Short-lived: the photo is re-signed whenever the screen asks again.
export const SIGNED_URL_SECONDS = 120;
const LIST_LIMIT = 100;

const numeric = z.union([z.number(), z.string()]).transform((value) => Number(value));

function one<T extends z.ZodTypeAny>(schema: T) {
  return z
    .union([schema, z.array(schema)])
    .nullable()
    .transform((value) => (Array.isArray(value) ? (value[0] ?? null) : value) as z.infer<T> | null);
}

const nameObject = z.object({ name: z.string() });
const displayNameObject = z.object({ display_name: z.string() });

export type ManagerDelivery = {
  id: string;
  collectorId: string;
  collectorName: string | null;
  siteId: string;
  siteName: string | null;
  materialCode: string;
  materialName: string | null;
  reportedWeightKg: number;
  status: DeliveryStatus;
  submittedAt: string;
};

export type ReviewedDelivery = ManagerDelivery & {
  verifiedWeightKg: number | null;
  verifiedAt: string | null;
  rejectionReason: string | null;
  items: { materialCode: string; materialName: string | null; weightKg: number }[];
};

export type DeliveryDetail = ManagerDelivery & {
  capturedAt: string | null;
  deviceLatitude: number | null;
  deviceLongitude: number | null;
  deviceAccuracyM: number | null;
  verifiedWeightKg: number | null;
  verifiedAt: string | null;
  rejectionReason: string | null;
  evidence: { storagePath: string; capturedAt: string | null; uploadedAt: string }[];
};

const BASE_COLUMNS =
  "id, collector_id, site_id, material_code, reported_weight_kg, status, submitted_at, " +
  "site:sites!collection_logs_site_id_fkey(name), " +
  "material:materials!collection_logs_material_code_fkey(display_name)";

const baseRow = z.object({
  id: z.string().uuid(),
  collector_id: z.string().uuid(),
  site_id: z.string().uuid(),
  material_code: z.string(),
  reported_weight_kg: numeric,
  status: z.enum(["pending", "approved", "rejected"]),
  submitted_at: z.string(),
  site: one(nameObject),
  material: one(displayNameObject),
});

function warnShape(where: string, error: z.ZodError): void {
  // Paths and messages only, never row values.
  console.warn(
    `[manager] ${where} rows did not match the expected shape: ${error.issues
      .slice(0, 5)
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ")}`,
  );
}

function warnQuery(where: string, status: number, error: { code?: string; message: string; hint?: string | null }) {
  console.warn(`[manager] ${where} failed: HTTP ${status} code=${error.code || "none"} message=${error.message} hint=${error.hint ?? "none"}`);
}

function toBase(row: z.infer<typeof baseRow>, names: Map<string, string | null>): ManagerDelivery {
  return {
    id: row.id,
    collectorId: row.collector_id,
    collectorName: names.get(row.collector_id) ?? null,
    siteId: row.site_id,
    siteName: row.site?.name ?? null,
    materialCode: row.material_code,
    materialName: row.material?.display_name ?? null,
    reportedWeightKg: row.reported_weight_kg,
    status: row.status,
    submittedAt: row.submitted_at,
  };
}

// The manager's assigned sites (their own user_sites rows).
export async function loadManagerSites(profile: Profile): Promise<AssignedSite[]> {
  return (await loadAccountSummary(profile)).sites;
}

const nameRows = z.array(z.object({ collector_id: z.string().uuid(), full_name: z.string().nullable() }));

// Names for the given collectors. A failure here is not fatal: the list
// still shows, with "Name not available".
async function collectorNames(ids: string[]): Promise<Map<string, string | null>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const { data, error, status } = await supabase.rpc("reviewable_collector_names", { p_collector_ids: unique });
  if (error) {
    warnQuery("reviewable_collector_names", status, error);
    return new Map();
  }
  const parsed = nameRows.safeParse(data ?? []);
  if (!parsed.success) {
    warnShape("reviewable_collector_names", parsed.error);
    return new Map();
  }
  return new Map(parsed.data.map((row) => [row.collector_id, row.full_name]));
}

// Pending deliveries at the manager's sites, newest first.
export async function listPendingDeliveries(siteIds: string[]): Promise<ManagerDelivery[]> {
  if (siteIds.length === 0) return [];
  const { data, error, status } = await supabase
    .from("collection_logs")
    .select(BASE_COLUMNS)
    .eq("status", "pending")
    .in("site_id", siteIds)
    .order("submitted_at", { ascending: false })
    .limit(LIST_LIMIT);
  if (error) {
    warnQuery("pending deliveries", status, error);
    throw new Error("Could not load pending deliveries. Check your connection and try again.");
  }
  const parsed = z.array(baseRow).safeParse(data ?? []);
  if (!parsed.success) {
    warnShape("pending deliveries", parsed.error);
    throw new Error("The pending deliveries could not be read.");
  }
  const names = await collectorNames(parsed.data.map((row) => row.collector_id));
  return parsed.data.map((row) => toBase(row, names));
}

const reviewedRow = baseRow.extend({
  verified_weight_kg: numeric.nullable(),
  verified_at: z.string().nullable(),
  rejection_reason: z.string().nullable(),
  items: z
    .array(
      z.object({
        material_code: z.string(),
        weight_kg: numeric,
        material: one(displayNameObject),
      }),
    )
    .nullable(),
});

const REVIEWED_COLUMNS =
  `${BASE_COLUMNS}, verified_weight_kg, verified_at, rejection_reason, ` +
  "items:collection_verified_items!collection_verified_items_collection_id_fkey(" +
  "material_code, weight_kg, material:materials!collection_verified_items_material_code_fkey(display_name))";

// Deliveries at the manager's sites that this manager reviewed, most
// recently reviewed first.
export async function listReviewedDeliveries(managerId: string, siteIds: string[]): Promise<ReviewedDelivery[]> {
  if (siteIds.length === 0) return [];
  const { data, error, status } = await supabase
    .from("collection_logs")
    .select(REVIEWED_COLUMNS)
    .in("status", ["approved", "rejected"])
    .eq("verified_by", managerId)
    .in("site_id", siteIds)
    .order("verified_at", { ascending: false })
    .limit(LIST_LIMIT);
  if (error) {
    warnQuery("reviewed deliveries", status, error);
    throw new Error("Could not load reviewed deliveries. Check your connection and try again.");
  }
  const parsed = z.array(reviewedRow).safeParse(data ?? []);
  if (!parsed.success) {
    warnShape("reviewed deliveries", parsed.error);
    throw new Error("The reviewed deliveries could not be read.");
  }
  const names = await collectorNames(parsed.data.map((row) => row.collector_id));
  return parsed.data.map((row) => ({
    ...toBase(row, names),
    verifiedWeightKg: row.verified_weight_kg,
    verifiedAt: row.verified_at,
    rejectionReason: row.rejection_reason,
    items: (row.items ?? []).map((item) => ({
      materialCode: item.material_code,
      materialName: item.material?.display_name ?? null,
      weightKg: item.weight_kg,
    })),
  }));
}

const detailRow = baseRow.extend({
  captured_at: z.string().nullable(),
  device_latitude: z.number().nullable(),
  device_longitude: z.number().nullable(),
  device_accuracy_m: z.number().nullable(),
  verified_weight_kg: numeric.nullable(),
  verified_at: z.string().nullable(),
  rejection_reason: z.string().nullable(),
  evidence: z
    .array(z.object({ storage_path: z.string(), captured_at: z.string().nullable(), uploaded_at: z.string() }))
    .nullable(),
});

const DETAIL_COLUMNS =
  `${BASE_COLUMNS}, captured_at, device_latitude, device_longitude, device_accuracy_m, ` +
  "verified_weight_kg, verified_at, rejection_reason, " +
  "evidence:collection_evidence!collection_evidence_collection_id_fkey(storage_path, captured_at, uploaded_at)";

// One delivery, or null if it does not exist or RLS hides it.
export async function getDeliveryDetail(id: string): Promise<DeliveryDetail | null> {
  const { data, error, status } = await supabase
    .from("collection_logs")
    .select(DETAIL_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) {
    warnQuery("delivery detail", status, error);
    throw new Error("Could not load this delivery. Check your connection and try again.");
  }
  if (!data) return null;
  const parsed = detailRow.safeParse(data);
  if (!parsed.success) {
    warnShape("delivery detail", parsed.error);
    throw new Error("This delivery could not be read.");
  }
  const row = parsed.data;
  const names = await collectorNames([row.collector_id]);
  return {
    ...toBase(row, names),
    capturedAt: row.captured_at,
    deviceLatitude: row.device_latitude,
    deviceLongitude: row.device_longitude,
    deviceAccuracyM: row.device_accuracy_m,
    verifiedWeightKg: row.verified_weight_kg,
    verifiedAt: row.verified_at,
    rejectionReason: row.rejection_reason,
    evidence: (row.evidence ?? [])
      .map((e) => ({ storagePath: e.storage_path, capturedAt: e.captured_at, uploadedAt: e.uploaded_at }))
      .sort((a, b) => a.uploadedAt.localeCompare(b.uploadedAt)),
  };
}

// A short-lived signed URL for one evidence photo (the bucket is private;
// storage RLS allows reviewers of the collection's site).
export async function signEvidenceUrl(storagePath: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from(EVIDENCE_BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_SECONDS);
  if (error || !data?.signedUrl) {
    console.warn(`[manager] signed URL failed: ${error?.message ?? "no URL returned"}`);
    throw new Error("Could not open the photo. Check your connection and try again.");
  }
  return data.signedUrl;
}

const materialRows = z.array(z.object({ code: z.string(), display_name: z.string() }));

// Active, verifiable materials in the admin-defined order (never MIXED).
export async function fetchVerifiableMaterials(): Promise<VerifiableMaterial[]> {
  const { data, error, status } = await supabase
    .from("materials")
    .select("code, display_name")
    .eq("is_verifiable", true)
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("display_name", { ascending: true });
  if (error) {
    warnQuery("materials", status, error);
    throw new Error("Could not load the list of materials.");
  }
  const parsed = materialRows.safeParse(data ?? []);
  if (!parsed.success) throw new Error("The list of materials could not be read.");
  return parsed.data.map((row) => ({ code: row.code, displayName: row.display_name }));
}

export type ReviewDecision =
  | { approved: true; items: RpcBreakdownItem[] }
  | { approved: false; reason: string };

// review_collection(uuid, boolean, jsonb, text). Returns null on success or
// the message to show.
export async function submitReview(collectionId: string, decision: ReviewDecision): Promise<string | null> {
  try {
    const { error, status } = await supabase.rpc("review_collection", {
      p_collection_id: collectionId,
      p_approved: decision.approved,
      p_verified_items: decision.approved ? decision.items : null,
      p_rejection_reason: decision.approved ? null : decision.reason,
    });
    if (!error) return null;
    warnQuery("review_collection", status, error);
    return reviewErrorMessage({ code: error.code, message: error.message, status });
  } catch (error: unknown) {
    return reviewErrorMessage({ message: error instanceof Error ? error.message : String(error) });
  }
}
