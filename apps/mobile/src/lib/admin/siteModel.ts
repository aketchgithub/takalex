// Admin site management: name rules, ordering and messages. Pure TypeScript
// (tested by siteModel.test.ts). admin_create_site() and admin_update_site()
// (migration 009) enforce the same rules; these let the admin see a problem
// before saving.

import { isNetworkError } from "../outbox/errors.ts";
import type { RemoteError } from "../outbox/types.ts";

export type AdminSite = { id: string; name: string; active: boolean };

export const SITE_NAME_MAX = 80;

// The form the database stores: trimmed, any run of whitespace as one space.
export function normaliseSiteName(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

// C0 and C1 control characters (whitespace ones are already spaces).
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/;

// The problem with a name typed for a new site (ownId undefined) or for an
// existing one, or null when it can be saved.
export function siteNameError(input: string, sites: AdminSite[], ownId?: string): string | null {
  const name = normaliseSiteName(input);
  if (name.length === 0) return "Enter a site name.";
  if (name.length > SITE_NAME_MAX) return `A site name can be at most ${SITE_NAME_MAX} characters.`;
  if (CONTROL_CHARACTERS.test(name)) return "Remove the special characters from the name.";

  const lower = name.toLowerCase();
  const clash = sites.find((site) => site.id !== ownId && site.name.toLowerCase() === lower);
  if (clash) {
    return clash.active
      ? `A site named "${clash.name}" already exists.`
      : `An inactive site named "${clash.name}" already exists. Reactivate it instead.`;
  }
  return null;
}

// Whether saving this name would change anything (the database refuses a
// save that changes nothing).
export function isRename(site: AdminSite, input: string): boolean {
  return normaliseSiteName(input) !== site.name;
}

// Active sites first, then by name (ignoring case).
export function sortSites(sites: AdminSite[]): AdminSite[] {
  return [...sites].sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    const x = a.name.toLowerCase();
    const y = b.name.toLowerCase();
    return x < y ? -1 : x > y ? 1 : 0;
  });
}

export const SITE_MESSAGES = {
  network: "Could not reach Takalex. Check your connection and try again.",
  notAdmin: "Only an active administrator can manage sites.",
  duplicate: "Another site already has that name.",
  notFound: "This site no longer exists. Pull down to refresh.",
  invalid: "Check the site name and try again.",
  other: "The site could not be saved. Try again.",
} as const;

// One plain message for a failed admin_create_site / admin_update_site call.
export function siteWriteErrorMessage(error: RemoteError): string {
  if (isNetworkError(error)) return SITE_MESSAGES.network;
  switch (error.code) {
    case "42501":
      return SITE_MESSAGES.notAdmin;
    case "23505":
      return SITE_MESSAGES.duplicate;
    case "P0002":
      return SITE_MESSAGES.notFound;
    case "22023":
      return SITE_MESSAGES.invalid;
    default:
      return SITE_MESSAGES.other;
  }
}

// What deactivating means (decided 16 Nov 2026: "no new people").
export function deactivateConfirmation(name: string): string {
  return (
    `${name} will no longer be offered when people request access or are invited. ` +
    "Collectors already assigned to it can still record deliveries, and its deliveries can still be reviewed. " +
    "You can reactivate it later."
  );
}

export function reactivateConfirmation(name: string): string {
  return `${name} will be offered again when people request access or are invited.`;
}
