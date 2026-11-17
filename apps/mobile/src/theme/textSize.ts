// The user's text size preference (Account > Display > Text size). Pure
// TypeScript, tested by textSize.test.ts.

export type TextSize = "small" | "normal" | "large";

export const TEXT_SIZES: { value: TextSize; label: string }[] = [
  { value: "small", label: "Small" },
  { value: "normal", label: "Normal" },
  { value: "large", label: "Large" },
];

const MULTIPLIER: Record<TextSize, number> = { small: 0.9, normal: 1, large: 1.15 };

// A font size from the type scale at the chosen text size, in whole points.
export function scaleFont(base: number, size: TextSize): number {
  return Math.round(base * MULTIPLIER[size]);
}

export function isTextSize(value: unknown): value is TextSize {
  return value === "small" || value === "normal" || value === "large";
}
