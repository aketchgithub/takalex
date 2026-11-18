// Pure helpers for the Account screen (components/AccountScreen.tsx).
// Tested by accountView.test.ts.

import type { UserRole } from "@/types/auth";

// Up to two initials for the avatar circle: "Amina Wanjiku" -> "AW",
// "amina" -> "A". No name (or only spaces) -> "?".
export function initials(fullName: string | null | undefined): string {
  const words = (fullName ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = words[0][0];
  const last = words.length > 1 ? words[words.length - 1][0] : "";
  return (first + last).toUpperCase();
}

// The line under the name: "Collector · Njiru group", "Site manager".
export function roleLine(roleLabel: string, groupLabel: string | null): string {
  return groupLabel ? `${roleLabel} · ${groupLabel}` : roleLabel;
}

// Collectors and site managers work at assigned sites, so their Account
// screen lists them; recyclers and admins have none.
export function showsAssignedSites(role: UserRole): boolean {
  return role === "collector" || role === "site_manager";
}

// "Takalex 1.0.0", or just "Takalex" when the version is unknown.
export function appVersionLabel(version: string | null | undefined): string {
  const trimmed = version?.trim();
  return trimmed ? `Takalex ${trimmed}` : "Takalex";
}
