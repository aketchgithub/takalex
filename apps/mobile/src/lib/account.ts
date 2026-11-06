import { z } from "zod";

import { supabase } from "@/lib/supabase";
import type { Profile } from "@/types/auth";

export type AssignedSite = { id: string; name: string; active: boolean };
export type CollectorGroup = { id: string; name: string; siteId: string | null };

export type AccountSummary = {
  sites: AssignedSite[];
  group: CollectorGroup | null;
};

const siteRowSchema = z.object({
  site_id: z.string().uuid(),
  sites: z
    .object({ id: z.string().uuid(), name: z.string(), active: z.boolean() })
    .nullable(),
});

const groupRowSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  site_id: z.string().uuid().nullable(),
});

// Reads the signed-in user's own site assignments and (for collectors) group,
// with explicit columns, under the existing RLS: user_sites rows where
// user_id = auth.uid(); sites and sme_groups rows for sites the user is an
// active member of.
export async function loadAccountSummary(profile: Profile): Promise<AccountSummary> {
  const { data: siteData, error: siteError } = await supabase
    .from("user_sites")
    .select("site_id, sites(id, name, active)")
    .eq("user_id", profile.id);

  if (siteError) {
    throw new Error("Could not load your assigned sites.");
  }

  const rows = z.array(siteRowSchema).safeParse(siteData ?? []);
  if (!rows.success) {
    throw new Error("Your site assignments could not be read.");
  }

  const sites = rows.data
    .flatMap((row) => (row.sites ? [row.sites] : []))
    .sort((a, b) => a.name.localeCompare(b.name));

  let group: CollectorGroup | null = null;
  if (profile.role === "collector" && profile.group_id) {
    const { data: groupData, error: groupError } = await supabase
      .from("sme_groups")
      .select("id, name, site_id")
      .eq("id", profile.group_id)
      .maybeSingle();

    if (groupError) {
      throw new Error("Could not load your group.");
    }

    const parsed = groupRowSchema.nullable().safeParse(groupData);
    if (parsed.success && parsed.data) {
      group = { id: parsed.data.id, name: parsed.data.name, siteId: parsed.data.site_id };
    }
  }

  return { sites, group };
}
