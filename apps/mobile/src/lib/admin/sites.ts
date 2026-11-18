// Sites for the admin screen. Reads every site (sites_read_assigned lets
// active admins read all of them, active or not); writes go through
// admin_create_site() and admin_update_site() (migration 009) and
// admin_set_site_location() (012) only.

import { z } from "zod";

import { locationWriteErrorMessage, type Coordinates } from "@/lib/admin/siteLocation";
import { siteWriteErrorMessage, sortSites, type AdminSite } from "@/lib/admin/siteModel";
import { toRemoteError } from "@/lib/outbox/errors";
import { supabase } from "@/lib/supabase";

const rowSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  active: z.boolean(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
});

export async function listAllSites(): Promise<AdminSite[]> {
  const { data, error, status } = await supabase.from("sites").select("id, name, active, latitude, longitude").order("name");
  if (error) {
    console.warn(`[admin] sites query failed: code=${error.code || "none"}`);
    throw new Error(
      status === 0 ? "Could not load sites. Check your connection and try again." : "Could not load sites. Try again.",
    );
  }
  const parsed = z.array(rowSchema).safeParse(data ?? []);
  if (!parsed.success) throw new Error("Sites could not be read.");
  return sortSites(parsed.data);
}

// null on success, otherwise a message for the admin.
export async function createSite(name: string): Promise<string | null> {
  try {
    const { error, status } = await supabase.rpc("admin_create_site", { p_name: name });
    if (!error) return null;
    console.warn(`[admin] admin_create_site failed: code=${error.code || "none"}`);
    return siteWriteErrorMessage({ ...toRemoteError(error), status });
  } catch (error: unknown) {
    return siteWriteErrorMessage(toRemoteError(error));
  }
}

// Sets both the name and the active flag (pass the current value of the one
// that should not change).
export async function updateSite(id: string, name: string, active: boolean): Promise<string | null> {
  try {
    const { error, status } = await supabase.rpc("admin_update_site", {
      p_site_id: id,
      p_name: name,
      p_active: active,
    });
    if (!error) return null;
    console.warn(`[admin] admin_update_site failed: code=${error.code || "none"}`);
    return siteWriteErrorMessage({ ...toRemoteError(error), status });
  } catch (error: unknown) {
    return siteWriteErrorMessage(toRemoteError(error));
  }
}

// Sets the site's location, or clears it with null. null on success,
// otherwise a message for the admin.
export async function setSiteLocation(id: string, location: Coordinates | null): Promise<string | null> {
  try {
    const { error, status } = await supabase.rpc("admin_set_site_location", {
      p_site_id: id,
      p_latitude: location?.latitude ?? null,
      p_longitude: location?.longitude ?? null,
    });
    if (!error) return null;
    console.warn(`[admin] admin_set_site_location failed: code=${error.code || "none"}`);
    return locationWriteErrorMessage({ ...toRemoteError(error), status });
  } catch (error: unknown) {
    return locationWriteErrorMessage(toRemoteError(error));
  }
}
