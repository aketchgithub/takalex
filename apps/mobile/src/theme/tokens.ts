// Design tokens: the one place for colours, spacing, corner radii and the
// type scale (docs: the "Takalex UI refresh" mockups, 17 Nov 2026). Pure
// TypeScript. Brand colours are provisional until Chemolex's logo colours are
// confirmed; change them here only.

export const colors = {
  // Brand
  primary: "#1F6B45",
  primaryPressed: "#164F33",
  primarySoft: "#E7F2EA",
  // Surfaces and lines
  background: "#F4F6F1",
  surface: "#FFFFFF",
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
} as const;

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
