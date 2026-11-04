import { supabase } from "@/lib/supabase";

export type SiteOption = {
  id: string;
  name: string;
};

export async function getActiveSites(): Promise<SiteOption[]> {
  const { data, error } = await supabase
    .from("sites")
    .select("id, name")
    .eq("active", true)
    .order("name", { ascending: true });

  if (error) {
    throw new Error(`Could not load sites: ${error.message}`);
  }

  return data ?? [];
}
