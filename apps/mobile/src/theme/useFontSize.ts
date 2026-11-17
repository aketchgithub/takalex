import { useCallback } from "react";

import { usePreferencesStore } from "@/stores/preferencesStore";
import { scaleFont } from "@/theme/textSize";

// Returns fs(base): a type-scale size at the user's chosen text size.
//   const fs = useFontSize();  <Text style={{ fontSize: fs(type.body) }}>
export function useFontSize(): (base: number) => number {
  const textSize = usePreferencesStore((state) => state.textSize);
  return useCallback((base: number) => scaleFont(base, textSize), [textSize]);
}
