// recycler_material_totals (migration 008): aggregates only, for active
// recyclers and admins. Other callers are refused with 42501.

import { z } from "zod";

import { supabase } from "@/lib/supabase";

import type { MaterialTotal } from "./model";

const numeric = z.union([z.number(), z.string()]).transform((value) => Number(value));

const rowsSchema = z.array(
  z.object({
    material_code: z.string(),
    display_name: z.string(),
    sort_order: z.number(),
    verified_weight_kg: numeric,
  }),
);

const CONNECTION = "Could not load material totals. Check your connection and try again.";

export async function fetchMaterialTotals(filter: {
  siteId: string | null;
  from: string | null;
  to: string | null;
}): Promise<MaterialTotal[]> {
  let result;
  try {
    result = await supabase.rpc("recycler_material_totals", {
      p_site_id: filter.siteId,
      p_from: filter.from,
      p_to: filter.to,
    });
  } catch {
    throw new Error(CONNECTION);
  }

  if (result.error) {
    console.warn(`[recycler] totals failed: HTTP ${result.status} code=${result.error.code || "none"}`);
    throw new Error(
      result.error.code === "42501" ? "Only active recyclers and administrators can see material totals." : CONNECTION,
    );
  }

  const parsed = rowsSchema.safeParse(result.data ?? []);
  if (!parsed.success) throw new Error("The material totals could not be read.");
  return parsed.data.map((row) => ({
    code: row.material_code,
    displayName: row.display_name,
    sortOrder: row.sort_order,
    verifiedWeightKg: row.verified_weight_kg,
  }));
}
