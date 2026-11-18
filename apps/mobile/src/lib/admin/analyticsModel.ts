// Date ranges and chart arithmetic for the admin analytics (migration 011).
// Pure TypeScript, tested by analyticsModel.test.ts. Dates are Nairobi
// calendar days as YYYY-MM-DD (nairobiDate in lib/recycler/model.ts).

const DAY_MS = 24 * 60 * 60 * 1000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export type WeekChoice = "this" | "last";

export const WEEK_CHOICES: { value: WeekChoice; label: string }[] = [
  { value: "this", label: "This week" },
  { value: "last", label: "Last week" },
];

export const TREND_MONTHS = 3;

function utc(day: string): number {
  return Date.parse(`${day}T00:00:00Z`);
}

function day(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

// Weeks start on Monday. This week: Monday to today. Last week: the Monday
// before to the Sunday before.
export function weekRange(choice: WeekChoice, today: string): { from: string; to: string } {
  const t = utc(today);
  const sinceMonday = (new Date(t).getUTCDay() + 6) % 7;
  const monday = t - sinceMonday * DAY_MS;
  if (choice === "this") return { from: day(monday), to: today };
  return { from: day(monday - 7 * DAY_MS), to: day(monday - DAY_MS) };
}

// "30 Nov – 6 Dec", or "1–7 Dec" within one month.
export function rangeLabel(range: { from: string; to: string }): string {
  const [, fm, fd] = range.from.split("-").map(Number);
  const [, tm, td] = range.to.split("-").map(Number);
  if (range.from === range.to) return `${td} ${MONTHS[tm - 1]}`;
  if (fm === tm) return `${fd}–${td} ${MONTHS[tm - 1]}`;
  return `${fd} ${MONTHS[fm - 1]} – ${td} ${MONTHS[tm - 1]}`;
}

// The 1st of the month (months - 1) months before today's month: the start
// of the trend, and of the material breakdown so both cover the same months.
export function monthsStart(today: string, months: number): string {
  const [y, m] = today.split("-").map(Number);
  const index = y * 12 + (m - 1) - (months - 1);
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

// "2026-11-01" -> "Nov"
export function monthLabel(monthStart: string): string {
  return MONTHS[Number(monthStart.slice(5, 7)) - 1] ?? monthStart;
}

// value as a share of the largest value (0 to 1); 0 when all are 0.
export function fractionOfMax(value: number, values: number[]): number {
  const max = Math.max(0, ...values);
  if (!(value > 0) || !(max > 0)) return 0;
  return Math.min(1, value / max);
}

// Whole percentages that add up to 100 (largest remainder), or all 0 when
// the total is 0.
export function percentages(values: number[]): number[] {
  const cents = values.map((v) => Math.max(0, Math.round(v * 100)));
  const total = cents.reduce((a, b) => a + b, 0);
  if (total === 0) return values.map(() => 0);
  const exact = cents.map((c) => (c * 100) / total);
  const floors = exact.map(Math.floor);
  let left = 100 - floors.reduce((a, b) => a + b, 0);
  const order = exact
    .map((x, i) => ({ i, rest: x - Math.floor(x) }))
    .sort((a, b) => b.rest - a.rest || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    floors[i] += 1;
    left -= 1;
  }
  return floors;
}

// "12 deliveries", "1 delivery"
export function deliveriesLabel(count: number): string {
  return `${count} ${count === 1 ? "delivery" : "deliveries"}`;
}
