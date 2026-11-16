// The signed-in collector's deliveries on the server, explicit columns only.
// collections_read_permitted lets a collector read only their own rows; the
// collector_id filter states that intent explicitly as well.

import { z } from "zod";

import type { ServerDelivery } from "@/lib/outbox/presentation";
import { supabase } from "@/lib/supabase";

const HISTORY_LIMIT = 100;

// NUMERIC comes back from PostgREST as a JSON number; accept a string too.
const numeric = z.union([z.number(), z.string()]).transform((value) => Number(value));

// The embedded material may be an object or a one-element array (no
// generated types).
const embeddedMaterial = z
  .union([z.object({ display_name: z.string() }), z.array(z.object({ display_name: z.string() }))])
  .nullable()
  .transform((value) => (Array.isArray(value) ? value[0] ?? null : value));

const rowSchema = z.object({
  id: z.string().uuid(),
  client_record_id: z.string().uuid(),
  material_code: z.string(),
  reported_weight_kg: numeric,
  verified_weight_kg: numeric.nullable(),
  status: z.enum(["pending", "approved", "rejected"]),
  rejection_reason: z.string().nullable(),
  submitted_at: z.string(),
  material: embeddedMaterial,
});

// collection_logs reaches materials two ways: the direct material_code FK and
// many-to-many through collection_verified_items (whose primary key is
// (collection_id, material_code)). A bare materials(...) embed is ambiguous
// (PGRST201, HTTP 300), so name the direct FK.
const SELECT_COLUMNS =
  "id, client_record_id, material_code, reported_weight_kg, verified_weight_kg, status, rejection_reason, submitted_at, material:materials!collection_logs_material_code_fkey(display_name)";

export async function listMyDeliveries(userId: string): Promise<ServerDelivery[]> {
  const { data, error, status } = await supabase
    .from("collection_logs")
    .select(SELECT_COLUMNS)
    .eq("collector_id", userId)
    .order("submitted_at", { ascending: false })
    .limit(HISTORY_LIMIT);

  if (error) {
    // Diagnostics for the Metro log: the PostgREST error fields only (no
    // headers, keys or tokens). The collector sees the generic message.
    console.warn(
      `[history] collection_logs query failed: HTTP ${status} code=${error.code || "none"} message=${error.message}` +
        ` details=${JSON.stringify(error.details ?? null)} hint=${error.hint ?? "none"}`,
    );
    throw new Error("Could not load your deliveries from Takalex. Check your connection and try again.");
  }

  const parsed = z.array(rowSchema).safeParse(data ?? []);
  if (!parsed.success) {
    // Paths and messages only, not row values.
    console.warn(
      `[history] collection_logs rows did not match the expected shape: ${parsed.error.issues
        .slice(0, 5)
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ")}`,
    );
    throw new Error("Your deliveries could not be read.");
  }

  return parsed.data.map((row) => ({
    id: row.id,
    clientRecordId: row.client_record_id,
    materialCode: row.material_code,
    materialName: row.material?.display_name ?? null,
    reportedWeightKg: row.reported_weight_kg,
    verifiedWeightKg: row.verified_weight_kg,
    status: row.status,
    rejectionReason: row.rejection_reason,
    submittedAt: row.submitted_at,
  }));
}
