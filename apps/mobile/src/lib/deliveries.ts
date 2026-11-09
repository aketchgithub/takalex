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

export async function listMyDeliveries(userId: string): Promise<ServerDelivery[]> {
  const { data, error } = await supabase
    .from("collection_logs")
    .select(
      "id, client_record_id, material_code, reported_weight_kg, verified_weight_kg, status, rejection_reason, submitted_at, material:materials(display_name)",
    )
    .eq("collector_id", userId)
    .order("submitted_at", { ascending: false })
    .limit(HISTORY_LIMIT);

  if (error) throw new Error("Could not load your deliveries from Takalex. Check your connection and try again.");

  const parsed = z.array(rowSchema).safeParse(data ?? []);
  if (!parsed.success) throw new Error("Your deliveries could not be read.");

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
