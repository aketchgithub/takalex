// What the new-delivery screen needs before it can save anything: the
// collector's one site and the reportable materials. Loaded from Supabase
// (explicit columns, under RLS) and cached on the phone per user, so a
// collector who has opened the app online once can log deliveries offline.

import Storage from "expo-sqlite/kv-store";
import { z } from "zod";

import { loadAccountSummary, type AssignedSite } from "@/lib/account";
import { supabase } from "@/lib/supabase";
import type { Profile } from "@/types/auth";

export type ReportableMaterial = { code: string; displayName: string };

export type CollectorContext = {
  // The collector's site, or null with siteProblem explaining why.
  site: AssignedSite | null;
  siteProblem: string | null;
  materials: ReportableMaterial[];
  // "cache" when the server could not be reached.
  source: "server" | "cache";
  savedAt: string;
};

const NETWORK_TIMEOUT_MS = 8000;
const cacheKey = (userId: string) => `collector-context:v1:${userId.toLowerCase()}`;

const siteSchema = z.object({ id: z.string().uuid(), name: z.string(), active: z.boolean() });
const materialSchema = z.object({ code: z.string(), displayName: z.string() });
const cachedSchema = z.object({
  sites: z.array(siteSchema),
  materials: z.array(materialSchema),
  savedAt: z.string(),
});
type Cached = z.infer<typeof cachedSchema>;

const materialRowsSchema = z.array(
  z.object({ code: z.string(), display_name: z.string(), sort_order: z.number() }),
);

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

// Active, reportable materials in the admin-defined order.
async function fetchReportableMaterials(): Promise<ReportableMaterial[]> {
  const { data, error } = await supabase
    .from("materials")
    .select("code, display_name, sort_order")
    .eq("is_reportable", true)
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("display_name", { ascending: true });
  if (error) throw new Error(`Could not load materials: ${error.message}`);
  const parsed = materialRowsSchema.safeParse(data ?? []);
  if (!parsed.success) throw new Error("The list of materials could not be read.");
  return parsed.data.map((row) => ({ code: row.code, displayName: row.display_name }));
}

// Collectors are assigned exactly one site (the invitation functions in
// 003_public_access_flow.sql refuse anything else); anything else is shown
// as a problem rather than guessed.
function resolveSite(sites: AssignedSite[]): { site: AssignedSite | null; siteProblem: string | null } {
  if (sites.length === 0) {
    return { site: null, siteProblem: "You have no assigned site. Ask an administrator to assign one." };
  }
  if (sites.length > 1) {
    return {
      site: null,
      siteProblem: "Your account has more than one site. Ask an administrator to keep only your site.",
    };
  }
  if (!sites[0].active) {
    return { site: null, siteProblem: `${sites[0].name} is no longer active. Ask an administrator.` };
  }
  return { site: sites[0], siteProblem: null };
}

function toContext(cached: Cached, source: CollectorContext["source"]): CollectorContext {
  return { ...resolveSite(cached.sites), materials: cached.materials, source, savedAt: cached.savedAt };
}

async function readCache(userId: string): Promise<Cached | null> {
  try {
    const raw = await Storage.getItemAsync(cacheKey(userId));
    if (!raw) return null;
    const parsed = cachedSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

// Server first; the cached copy when the server cannot be reached.
export async function loadCollectorContext(profile: Profile): Promise<CollectorContext> {
  try {
    const [summary, materials] = await withTimeout(
      Promise.all([loadAccountSummary(profile), fetchReportableMaterials()]),
      NETWORK_TIMEOUT_MS,
    );
    const cached: Cached = { sites: summary.sites, materials, savedAt: new Date().toISOString() };
    await Storage.setItemAsync(cacheKey(profile.id), JSON.stringify(cached)).catch(() => undefined);
    return toContext(cached, "server");
  } catch {
    const cached = await readCache(profile.id);
    if (cached) return toContext(cached, "cache");
    throw new Error(
      "Could not load your site and materials. Connect to the internet and try again; after one successful load you can log deliveries offline.",
    );
  }
}

// Material names from the cache only (no network), for labelling rows that
// are still on the phone. Empty map if nothing is cached.
export async function cachedMaterialNames(userId: string): Promise<Map<string, string>> {
  const cached = await readCache(userId);
  return new Map((cached?.materials ?? []).map((m) => [m.code, m.displayName]));
}
