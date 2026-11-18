// Design tokens: the one place for colours, spacing, corner radii and the
// type scale (docs: the "Takalex UI refresh" mockups, 17 Nov 2026), with a
// light and a dark colour set. Pure TypeScript. Brand colours are provisional
// until Chemolex's logo colours are confirmed; change them here only.

// Light theme. Every theme has the same keys (Palette).
export const lightColors = {
  // Brand
  primary: "#1F6B45",
  primaryPressed: "#164F33",
  primarySoft: "#E7F2EA",
  // Text and icons on a primary-coloured background (buttons, selected chips)
  onPrimary: "#FFFFFF",
  // Surfaces and lines
  background: "#F4F6F1",
  surface: "#FFFFFF",
  // Pure white whatever the theme (camera controls, text on photos)
  white: "#FFFFFF",
  border: "#E2E7DC",
  inputBorder: "#D5DCCD",
  divider: "#EEF1EA",
  track: "#EEF1EA",
  // Text
  text: "#14231A",
  muted: "#5B6658",
  placeholder: "#6B7466",
  // States (text on its soft background passes WCAG AA)
  danger: "#9B2C2C",
  dangerSoft: "#FBEAEA",
  dangerBorder: "#E8C4C4",
  warning: "#8A4B05",
  warningSoft: "#FDF3E3",
  success: "#1F6B45",
  successSoft: "#E7F2EA",
  // The grey status pill's text
  neutralText: "#3F4A3F",
};

export type Palette = { readonly [K in keyof typeof lightColors]: string };

// Dark theme: deep green-grey surfaces (not pure black), light text, and a
// brighter brand green with dark text on it, so buttons and links stay
// readable. Each text colour passes WCAG AA on the surfaces it is used on.
export const darkColors: Palette = {
  primary: "#5BC48F",
  primaryPressed: "#4AAE7C",
  primarySoft: "#1D3A2B",
  onPrimary: "#06140D",
  background: "#0F1512",
  surface: "#18201B",
  white: "#FFFFFF",
  border: "#2A352E",
  inputBorder: "#3A473F",
  divider: "#222B25",
  track: "#26302A",
  text: "#E6EDE8",
  muted: "#9AA69E",
  placeholder: "#7F8A83",
  danger: "#F28B82",
  dangerSoft: "#3A1F1E",
  dangerBorder: "#6B3330",
  warning: "#F0B866",
  warningSoft: "#3A2E17",
  success: "#5BC48F",
  successSoft: "#1D3A2B",
  neutralText: "#C9D1CB",
};

export type ColorScheme = "light" | "dark";

export function paletteFor(scheme: ColorScheme): Palette {
  return scheme === "dark" ? darkColors : lightColors;
}

export const space = { xxs: 4, xs: 8, sm: 12, md: 16, lg: 24, xl: 32 } as const;

export const radius = { sm: 8, md: 10, lg: 12, xl: 16, pill: 999 } as const;

// Font sizes at the "Normal" text size. Components scale them with
// useFontSize() (theme/useFontSize.ts); the phone's own font setting also
// applies on top.
export const type = {
  display: 24, // screen titles
  title: 18, // section headings
  cardTitle: 16,
  body: 15, // text, inputs, buttons
  label: 13, // field labels, small links
  meta: 13, // secondary text
  caption: 12, // tab labels, small print
} as const;

// Touch targets (Owino's UI-22: about 44-48 dp).
export const touch = { min: 44, button: 48 } as const;
