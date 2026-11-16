import { z } from "zod";

import { supabase } from "@/lib/supabase";
import type { Profile } from "@/types/auth";

export type AssignedSite = { id: string; name: string; active: boolean };

export type AccountSummary = {
  sites: AssignedSite[];
};

// Each waste picker group has the same name as its site, so a collector's
// group is shown as "{site name} group" for each assigned site.
export function collectorGroupLabel(sites: AssignedSite[]): string | null {
  if (sites.length === 0) {
    return null;
  }
  return sites.map((site) => `${site.name} group`).join(", ");
}

const siteRowSchema = z.object({
  site_id: z.string().uuid(),
  sites: z
    .object({ id: z.string().uuid(), name: z.string(), active: z.boolean() })
    .nullable(),
});

// Reads the signed-in user's own site assignments with explicit columns,
// under the existing RLS: user_sites rows where user_id = auth.uid(), and
// sites rows for sites the user is an active member of.
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

  return { sites };
}
