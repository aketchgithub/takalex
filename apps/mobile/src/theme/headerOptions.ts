// Navigation header colours for the Stack screens that show a header
// (manager delivery, admin approve / invite / materials).

import type { Palette } from "@/theme/tokens";

export function headerOptions(c: Palette) {
  return {
    headerStyle: { backgroundColor: c.surface },
    headerTintColor: c.primary,
    headerTitleStyle: { color: c.text },
    contentStyle: { backgroundColor: c.background },
  };
}
