// Admin material management: name and role rules, ordering, labels and
// messages. Pure TypeScript (tested by materialModel.test.ts). The functions
// in migration 010 enforce the same rules; these let the admin see a problem
// before saving.

import { isNetworkError } from "../outbox/errors.ts";
import type { RemoteError } from "../outbox/types.ts";

export type AdminMaterial = {
  code: string;
  displayName: string;
  isReportable: boolean;
  isVerifiable: boolean;
  isRecyclerVisible: boolean;
  isActive: boolean;
  sortOrder: number;
};

export type MaterialRoles = { isReportable: boolean; isVerifiable: boolean; isRecyclerVisible: boolean };

export const MATERIAL_NAME_MAX = 60;

// Mixed may be reported but never verified or shown to recyclers, and never
// deleted (CLAUDE.md; migrations 001 and 010).
export const MIXED_CODE = "MIXED";

export function normaliseMaterialName(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/;

// The problem with a name for a new material (ownCode undefined) or an
// existing one, or null.
export function materialNameError(input: string, materials: AdminMaterial[], ownCode?: string): string | null {
  const name = normaliseMaterialName(input);
  if (name.length === 0) return "Enter a material name.";
  if (name.length > MATERIAL_NAME_MAX) return `A material name can be at most ${MATERIAL_NAME_MAX} characters.`;
  if (CONTROL_CHARACTERS.test(name)) return "Remove the special characters from the name.";
  const lower = name.toLowerCase();
  const clash = materials.find((m) => m.code !== ownCode && m.displayName.toLowerCase() === lower);
  if (clash) {
    return clash.isActive
      ? `A material named "${clash.displayName}" already exists.`
      : `An inactive material named "${clash.displayName}" already exists. Reactivate it instead.`;
  }
  return null;
}

// The problem with a combination of roles, or null.
export function materialRolesError(roles: MaterialRoles, code?: string): string | null {
  if (code === MIXED_CODE && (roles.isVerifiable || roles.isRecyclerVisible)) {
    return "Mixed can be reported, but never used when sorting or shown to recyclers.";
  }
  if (roles.isRecyclerVisible && !roles.isVerifiable) {
    return "Recyclers only see sorted material, so managers must be able to use it when sorting.";
  }
  if (!roles.isReportable && !roles.isVerifiable) {
    return "Choose at least: collectors can report it, or managers can use it when sorting.";
  }
  return null;
}

// Turning "managers can use it" off also turns "recyclers see it" off, since
// recyclers only see verified material.
export function withRole(roles: MaterialRoles, role: keyof MaterialRoles, on: boolean): MaterialRoles {
  const next = { ...roles, [role]: on };
  if (role === "isVerifiable" && !on) next.isRecyclerVisible = false;
  if (role === "isRecyclerVisible" && on) next.isVerifiable = true;
  return next;
}

// Whether saving this draft would change anything (the database refuses a
// save that changes nothing).
export function isMaterialEdited(material: AdminMaterial, name: string, roles: MaterialRoles): boolean {
  return (
    normaliseMaterialName(name) !== material.displayName ||
    roles.isReportable !== material.isReportable ||
    roles.isVerifiable !== material.isVerifiable ||
    roles.isRecyclerVisible !== material.isRecyclerVisible
  );
}

// "Collectors · Managers · Recyclers", or the subset that applies.
export function rolesSummary(roles: MaterialRoles): string {
  const parts: string[] = [];
  if (roles.isReportable) parts.push("Collectors");
  if (roles.isVerifiable) parts.push("Managers");
  if (roles.isRecyclerVisible) parts.push("Recyclers");
  return parts.length > 0 ? parts.join(" · ") : "Nobody";
}

// The order every screen uses: sort order, then code.
export function sortMaterials(materials: AdminMaterial[]): AdminMaterial[] {
  return [...materials].sort((a, b) =>
    a.sortOrder !== b.sortOrder ? a.sortOrder - b.sortOrder : a.code < b.code ? -1 : a.code > b.code ? 1 : 0,
  );
}

export const MATERIAL_MESSAGES = {
  network: "Could not reach Takalex. Check your connection and try again.",
  notAdmin: "Only an active administrator can manage materials.",
  duplicate: "Another material already has that name (or a very similar one).",
  used: "This material is used in deliveries, so it cannot be deleted. Deactivate it instead.",
  notFound: "This material no longer exists. Pull down to refresh.",
  lastReportable: "At least one active material must stay reportable by collectors.",
  lastVerifiable: "At least one active material must stay usable by managers when sorting.",
  mixed: "Mixed can be reported, but never used when sorting, shown to recyclers or deleted.",
  edge: "It is already at the end of the list.",
  invalid: "Check the material's name and roles and try again.",
  other: "The material could not be saved. Try again.",
} as const;

// One plain message for a failed admin_*_material call. 22023 carries one of
// migration 010's fixed messages; each known one gets a plain version.
export function materialWriteErrorMessage(error: RemoteError): string {
  if (isNetworkError(error)) return MATERIAL_MESSAGES.network;
  const text = error.message ?? "";
  switch (error.code) {
    case "42501":
      return MATERIAL_MESSAGES.notAdmin;
    case "23505":
      return MATERIAL_MESSAGES.duplicate;
    case "23503":
      return MATERIAL_MESSAGES.used;
    case "P0002":
      return MATERIAL_MESSAGES.notFound;
    case "22023":
      if (/stay reportable/i.test(text)) return MATERIAL_MESSAGES.lastReportable;
      if (/stay verifiable/i.test(text)) return MATERIAL_MESSAGES.lastVerifiable;
      if (/mixed/i.test(text)) return MATERIAL_MESSAGES.mixed;
      if (/already (first|last)/i.test(text)) return MATERIAL_MESSAGES.edge;
      return MATERIAL_MESSAGES.invalid;
    default:
      return MATERIAL_MESSAGES.other;
  }
}

export function deactivateMaterialConfirmation(name: string): string {
  return (
    `Collectors will no longer be able to report ${name}, managers will no longer be able to use it when sorting, ` +
    "and its kilograms will no longer appear in recyclers' totals. " +
    `A delivery of ${name} that is still waiting to upload on a collector's phone will be refused. ` +
    "Past deliveries keep it. You can reactivate it later."
  );
}

export function reactivateMaterialConfirmation(name: string): string {
  return `${name} can be reported, used when sorting and shown to recyclers again, as its roles allow.`;
}

export function deleteMaterialConfirmation(name: string): string {
  return `${name} will be removed from the list. This only works if it has never been used in a delivery.`;
}
