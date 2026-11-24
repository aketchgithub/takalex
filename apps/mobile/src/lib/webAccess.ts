// Which roles may use Takalex in a web browser. Pure TypeScript, tested by
// webAccess.test.ts.
//
// The web version is for the office admin on a laptop. Collectors, site
// managers and recyclers use the phone app: recording needs the camera,
// offline saving and GPS, and reviewing is done at the site.

import type { UserRole } from "../types/auth.ts";

export function webAllowsRole(role: UserRole): boolean {
  return role === "admin";
}

export const WEB_PHONE_ONLY_MESSAGE =
  "The Takalex website is for administrators. Collectors, site managers and recyclers use the Takalex app on an Android phone. Ask your administrator for the app link.";
