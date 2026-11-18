// The current colours, from the user's Appearance choice and the phone's own
// light/dark setting.
//
//   const c = useColors();                     // for icons and one-off colours
//   const styles = useThemedStyles(makeStyles); // for a StyleSheet
//   const makeStyles = (c: Palette) => StyleSheet.create({ ... c.surface ... });
//
// makeStyles must be defined outside the component (module level): its styles
// are built once per theme and shared by every component that uses it.

import { useColorScheme } from "react-native";

import { usePreferencesStore } from "@/stores/preferencesStore";
import { resolveScheme } from "@/theme/appearance";
import { paletteFor, type ColorScheme, type Palette } from "@/theme/tokens";

export function useColorSchemeChoice(): ColorScheme {
  const appearance = usePreferencesStore((state) => state.appearance);
  const phone = useColorScheme();
  return resolveScheme(appearance, phone);
}

export function useColors(): Palette {
  return paletteFor(useColorSchemeChoice());
}

const cache = new WeakMap<(c: Palette) => unknown, Partial<Record<ColorScheme, unknown>>>();

// The factory's result for a theme, built once and reused.
export function stylesFor<T>(factory: (c: Palette) => T, scheme: ColorScheme): T {
  let entry = cache.get(factory);
  if (!entry) {
    entry = {};
    cache.set(factory, entry);
  }
  if (!(scheme in entry)) entry[scheme] = factory(paletteFor(scheme));
  return entry[scheme] as T;
}

export function useThemedStyles<T>(factory: (c: Palette) => T): T {
  return stylesFor(factory, useColorSchemeChoice());
}
