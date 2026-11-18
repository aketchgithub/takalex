// The admin analytics functions (migration 011): aggregates only, for active
// administrators. Other callers are refused with 42501.

import { z } from "zod";

import { supabase } from "@/lib/supabase";

const numeric = z.union([z.number(), z.string()]).transform((value) => Number(value));

export type SiteVolume = { siteId: string; siteName: string; active: boolean; weightKg: number; approved: number };
export type MaterialShare = { code: string; name: string; weightKg: number };
export type MonthTrend = { monthStart: string; weightKg: number; approved: number; rejected: number };

const siteSchema = z.array(
  z.object({
    site_id: z.string().uuid(),
    site_name: z.string(),
    site_active: z.boolean(),
    verified_weight_kg: numeric,
    approved_count: numeric,
  }),
);
const materialSchema = z.array(
  z.object({ material_code: z.string(), display_name: z.string(), verified_weight_kg: numeric }),
);
const monthSchema = z.array(
  z.object({ month_start: z.string(), verified_weight_kg: numeric, approved_count: numeric, rejected_count: numeric }),
);

const CONNECTION = "Could not load the charts. Check your connection and try again.";

async function call(fn: string, args: Record<string, unknown>): Promise<unknown> {
  let result;
  try {
    result = await supabase.rpc(fn, args);
  } catch {
    throw new Error(CONNECTION);
  }
  if (result.error) {
    console.warn(`[analytics] ${fn} failed: HTTP ${result.status} code=${result.error.code || "none"}`);
    throw new Error(result.error.code === "42501" ? "Only active administrators can see analytics." : CONNECTION);
  }
  return result.data ?? [];
}

function parsed<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) throw new Error("The chart data could not be read.");
  return result.data;
}

export async function fetchSiteVolume(from: string, to: string): Promise<SiteVolume[]> {
  const rows = parsed(siteSchema, await call("admin_site_volume", { p_from: from, p_to: to }));
  return rows.map((r) => ({
    siteId: r.site_id,
    siteName: r.site_name,
    active: r.site_active,
    weightKg: r.verified_weight_kg,
    approved: r.approved_count,
  }));
}

export async function fetchMaterialBreakdown(from: string, to: string): Promise<MaterialShare[]> {
  const rows = parsed(materialSchema, await call("admin_material_breakdown", { p_from: from, p_to: to }));
  return rows.map((r) => ({ code: r.material_code, name: r.display_name, weightKg: r.verified_weight_kg }));
}

export async function fetchMonthlyTrend(until: string, months: number): Promise<MonthTrend[]> {
  const rows = parsed(monthSchema, await call("admin_monthly_trend", { p_until: until, p_months: months }));
  return rows.map((r) => ({
    monthStart: r.month_start,
    weightKg: r.verified_weight_kg,
    approved: r.approved_count,
    rejected: r.rejected_count,
  }));
}
