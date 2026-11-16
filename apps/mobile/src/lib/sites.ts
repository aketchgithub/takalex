import { supabase } from "@/lib/supabase";

export type SiteOption = {
  id: string;
  name: string;
};

export async function getActiveSites(): Promise<SiteOption[]> {
  const { data, error, status } = await supabase
    .from("sites")
    .select("id, name")
    .eq("active", true)
    .order("name", { ascending: true });

  if (error) {
    // Status 0: no answer from the server (no connection or a timeout).
    if (status === 0) throw new Error("Could not load sites. Check your connection and try again.");
    throw new Error(`Could not load sites: ${error.message}`);
  }

  return data ?? [];
}
