// The user's Appearance choice (Account > Display > Appearance). Pure
// TypeScript, tested by appearance.test.ts.

import type { ColorScheme } from "./tokens.ts";

export type Appearance = "system" | "light" | "dark";

export const APPEARANCES: { value: Appearance; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

export function isAppearance(value: unknown): value is Appearance {
  return value === "system" || value === "light" || value === "dark";
}

// The colours to use. "System" follows the phone (light when it says
// nothing, for example on older Android versions).
export function resolveScheme(appearance: Appearance, phone: string | null | undefined): ColorScheme {
  if (appearance === "system") return phone === "dark" ? "dark" : "light";
  return appearance;
}
