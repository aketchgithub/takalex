// Recycler totals: date presets and formatting. Pure TypeScript (tested by
// model.test.ts). recycler_material_totals (migration 008) filters by
// calendar day in Africa/Nairobi time, so the presets compute Nairobi dates,
// whatever time zone the phone is set to.

export type MaterialTotal = {
  code: string;
  displayName: string;
  sortOrder: number;
  verifiedWeightKg: number;
};

export type DatePreset = "all" | "month" | "last30";

export const DATE_PRESETS: { value: DatePreset; label: string }[] = [
  { value: "all", label: "All time" },
  { value: "month", label: "This month" },
  { value: "last30", label: "Last 30 days" },
];

// East Africa Time is UTC+3 all year (no daylight saving).
const NAIROBI_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function isoDate(utcMidnightish: Date): string {
  return utcMidnightish.toISOString().slice(0, 10);
}

// Today's date in Nairobi, as YYYY-MM-DD.
export function nairobiDate(now: Date): string {
  return isoDate(new Date(now.getTime() + NAIROBI_OFFSET_MS));
}

// The p_from / p_to dates for a preset (inclusive, Nairobi calendar days).
//   all     no bounds
//   month   the 1st of the current Nairobi month to today
//   last30  today and the 29 days before it
export function presetRange(preset: DatePreset, now: Date): { from: string | null; to: string | null } {
  if (preset === "all") return { from: null, to: null };
  const today = nairobiDate(now);
  if (preset === "month") return { from: `${today.slice(0, 8)}01`, to: today };
  const start = new Date(Date.parse(`${today}T00:00:00Z`) - 29 * DAY_MS);
  return { from: isoDate(start), to: today };
}

const HEADING_SUFFIX: Record<DatePreset, string> = {
  all: "all time",
  month: "this month",
  last30: "last 30 days",
};

// Worded so the totals are not mistaken for live stock.
export function totalsHeading(preset: DatePreset): string {
  return `Approved, verified material (${HEADING_SUFFIX[preset]})`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function dayLabel(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

export function rangeLabel(range: { from: string | null; to: string | null }): string {
  if (!range.from && !range.to) return "Every approved delivery so far.";
  if (range.from && range.to) {
    return range.from === range.to
      ? `Verified on ${dayLabel(range.from)} (Nairobi time).`
      : `Verified ${dayLabel(range.from)} to ${dayLabel(range.to)} (Nairobi time).`;
  }
  return range.from ? `Verified from ${dayLabel(range.from)} (Nairobi time).` : `Verified up to ${dayLabel(range.to!)} (Nairobi time).`;
}

// Weights to whole grams-of-ten (cents of a kg), so totals are exact.
function toCents(kg: number): number {
  return Math.round(kg * 100);
}

export function totalKg(rows: MaterialTotal[]): number {
  return rows.reduce((sum, row) => sum + toCents(row.verifiedWeightKg), 0) / 100;
}

// "1,234.50 kg": two decimals, thousands separated (no Intl dependency).
export function formatTotalKg(kg: number): string {
  if (!Number.isFinite(kg)) return `${kg} kg`;
  const cents = toCents(Math.abs(kg));
  const whole = String(Math.floor(cents / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fraction = String(cents % 100).padStart(2, "0");
  return `${kg < 0 ? "-" : ""}${whole}.${fraction} kg`;
}

export function hasAnyMaterial(rows: MaterialTotal[]): boolean {
  return rows.some((row) => toCents(row.verifiedWeightKg) > 0);
}
