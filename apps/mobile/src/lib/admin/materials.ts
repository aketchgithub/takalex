// Materials for the admin screen. Every signed-in user can read the list
// (001); writes go through admin_create_material(), admin_update_material(),
// admin_move_material() and admin_delete_material() (migration 010) only.

import { z } from "zod";

import { materialWriteErrorMessage, sortMaterials, type AdminMaterial, type MaterialRoles } from "@/lib/admin/materialModel";
import { toRemoteError } from "@/lib/outbox/errors";
import { supabase } from "@/lib/supabase";

const rowSchema = z.object({
  code: z.string(),
  display_name: z.string(),
  is_reportable: z.boolean(),
  is_verifiable: z.boolean(),
  is_recycler_visible: z.boolean(),
  is_active: z.boolean(),
  sort_order: z.number(),
});

export async function listAllMaterials(): Promise<AdminMaterial[]> {
  const { data, error, status } = await supabase
    .from("materials")
    .select("code, display_name, is_reportable, is_verifiable, is_recycler_visible, is_active, sort_order")
    .order("sort_order")
    .order("code");
  if (error) {
    console.warn(`[admin] materials query failed: code=${error.code || "none"}`);
    throw new Error(
      status === 0 ? "Could not load materials. Check your connection and try again." : "Could not load materials. Try again.",
    );
  }
  const parsed = z.array(rowSchema).safeParse(data ?? []);
  if (!parsed.success) throw new Error("Materials could not be read.");
  return sortMaterials(
    parsed.data.map((row) => ({
      code: row.code,
      displayName: row.display_name,
      isReportable: row.is_reportable,
      isVerifiable: row.is_verifiable,
      isRecyclerVisible: row.is_recycler_visible,
      isActive: row.is_active,
      sortOrder: row.sort_order,
    })),
  );
}

// Each returns null on success, otherwise a message for the admin.
async function call(fn: string, args: Record<string, unknown>): Promise<string | null> {
  try {
    const { error, status } = await supabase.rpc(fn, args);
    if (!error) return null;
    console.warn(`[admin] ${fn} failed: code=${error.code || "none"}`);
    return materialWriteErrorMessage({ ...toRemoteError(error), status });
  } catch (error: unknown) {
    return materialWriteErrorMessage(toRemoteError(error));
  }
}

export function createMaterial(name: string, roles: MaterialRoles): Promise<string | null> {
  return call("admin_create_material", {
    p_display_name: name,
    p_is_reportable: roles.isReportable,
    p_is_verifiable: roles.isVerifiable,
    p_is_recycler_visible: roles.isRecyclerVisible,
  });
}

// Sets the name, roles and active flag (pass current values for the rest).
export function updateMaterial(code: string, name: string, roles: MaterialRoles, isActive: boolean): Promise<string | null> {
  return call("admin_update_material", {
    p_code: code,
    p_display_name: name,
    p_is_reportable: roles.isReportable,
    p_is_verifiable: roles.isVerifiable,
    p_is_recycler_visible: roles.isRecyclerVisible,
    p_is_active: isActive,
  });
}

export function moveMaterial(code: string, direction: "up" | "down"): Promise<string | null> {
  return call("admin_move_material", { p_code: code, p_direction: direction });
}

export function deleteMaterial(code: string): Promise<string | null> {
  return call("admin_delete_material", { p_code: code });
}
