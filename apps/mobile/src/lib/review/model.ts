// Site manager review rules on the phone. Pure TypeScript (tested by
// model.test.ts). The database (review_collection in 001) is the authority;
// these checks mirror it so the manager sees problems before sending, and
// the server's own messages are still shown when it refuses.

import { normalizeReportedWeight } from "../outbox/validation.ts";

export type VerifiableMaterial = { code: string; displayName: string };

// One editor line. weightText is what the manager typed.
export type BreakdownLine = {
  key: string;
  materialCode: string | null;
  weightText: string;
};

export type LineErrors = { material?: string; weight?: string };

// review_collection's p_verified_items: weight_kg must be a JSON number
// (the function refuses strings, see 20_collections.sql).
export type RpcBreakdownItem = { material_code: string; weight_kg: number };

export type BreakdownCheck = {
  // One entry per line, same order.
  lineErrors: LineErrors[];
  // Problems with the breakdown as a whole.
  formError: string | null;
  // Sum of the lines whose weight is valid, as "12.30".
  totalText: string;
  // How many lines the total counts.
  countedLines: number;
  // Present only when every check passed.
  items: RpcBreakdownItem[] | null;
};

// NUMERIC(10,2) limit on collection_logs.verified_weight_kg.
const MAX_TOTAL_CENTS = 9_999_999_999;

// "12.30" (already normalised) -> 1230. Integer cents, so sums are exact.
function toCents(normalized: string): number {
  const [whole, fraction] = normalized.split(".");
  return Number(whole) * 100 + Number(fraction);
}

export function centsToText(cents: number): string {
  const whole = Math.floor(cents / 100);
  const fraction = String(cents % 100).padStart(2, "0");
  return `${whole}.${fraction}`;
}

// The weight as sent to review_collection. The input is a normalised
// string with at most 2 decimals and at most 8 integer digits;
// JSON.stringify writes the shortest decimal that reads back as the same
// double, which for such values is exactly the typed decimal (trailing
// zeros dropped: "3.10" -> 3.1). Postgres parses JSON numbers as exact
// NUMERIC. model.test.ts checks the round trip.
export function weightForRpc(normalized: string): number {
  return Number(normalized);
}

export function checkBreakdown(
  lines: BreakdownLine[],
  materials: VerifiableMaterial[],
): BreakdownCheck {
  const allowed = new Set(materials.map((m) => m.code));
  const seen = new Set<string>();
  const lineErrors: LineErrors[] = [];
  const items: RpcBreakdownItem[] = [];
  let totalCents = 0;
  let countedLines = 0;
  let anyError = false;

  for (const line of lines) {
    const errors: LineErrors = {};

    if (!line.materialCode) {
      errors.material = "Choose a material.";
    } else if (!allowed.has(line.materialCode)) {
      errors.material = "This material cannot be used in a verified breakdown.";
    } else if (seen.has(line.materialCode)) {
      errors.material = "This material is already in the breakdown.";
    }
    if (line.materialCode) seen.add(line.materialCode);

    const normalized = normalizeReportedWeight(line.weightText);
    if (normalized === null) {
      errors.weight =
        line.weightText.trim() === ""
          ? "Enter the weight in kg."
          : "Enter a weight above 0 with at most 2 decimals, e.g. 3.25.";
    } else {
      totalCents += toCents(normalized);
      countedLines += 1;
    }

    if (errors.material || errors.weight) {
      anyError = true;
    } else if (line.materialCode && normalized !== null) {
      items.push({ material_code: line.materialCode, weight_kg: weightForRpc(normalized) });
    }
    lineErrors.push(errors);
  }

  let formError: string | null = null;
  if (lines.length === 0) {
    formError = "Add at least one material line to approve.";
  } else if (totalCents > MAX_TOTAL_CENTS) {
    formError = "The verified total is too large.";
  }

  return {
    lineErrors,
    formError,
    totalText: centsToText(totalCents),
    countedLines,
    items: anyError || formError ? null : items,
  };
}

// Materials still free for a new line (active + verifiable, not yet used).
export function unusedMaterials(
  lines: BreakdownLine[],
  materials: VerifiableMaterial[],
): VerifiableMaterial[] {
  const used = new Set(lines.map((l) => l.materialCode).filter((c): c is string => c !== null));
  return materials.filter((m) => !used.has(m.code));
}

// The trimmed reason, or null with an error when blank (review_collection
// requires a non-blank reason).
export function checkRejectionReason(text: string): { reason: string | null; error: string | null } {
  const reason = text.trim();
  return reason ? { reason, error: null } : { reason: null, error: "Enter a reason for rejecting." };
}

export function approveConfirmation(totalText: string): string {
  return (
    `The verified total of ${totalText} kg will be recorded and this delivery becomes ` +
    "eligible for payment to the collector. Reviewed deliveries are final."
  );
}

export function rejectConfirmation(reason: string): string {
  return (
    `This delivery will be rejected with the reason “${reason}” and will not be eligible ` +
    "for payment. Reviewed deliveries are final."
  );
}

type ErrorLike = { message?: string; code?: string; status?: number } | null | undefined;

const NETWORK =
  /network request failed|failed to fetch|fetch failed|timed? ?out|timeout|aborted/i;

// What the manager sees when review_collection fails. RAISE EXCEPTION in
// the function gives P0001 with a readable message, shown as is.
export function reviewErrorMessage(error: ErrorLike): string {
  const message = error?.message?.trim() ?? "";
  if (error?.code === "P0001" && message) return `Not saved: ${message}.`.replace(/\.\.$/, ".");
  if (!error?.status || NETWORK.test(message)) {
    return "Not saved: no connection to Takalex. Check your connection and try again.";
  }
  if (error.status === 401 || error.status === 403) {
    return "Not saved: you are not allowed to review this delivery. Sign in again if this persists.";
  }
  return message ? `Not saved: ${message}` : "Not saved: the server refused the review.";
}

// Device location as recorded by the collector's phone.
export function deviceLocationLabel(
  latitude: number | null,
  longitude: number | null,
  accuracyM: number | null,
): string {
  if (latitude === null || longitude === null) return "Not recorded";
  const accuracy = accuracyM !== null ? ` (±${Math.round(accuracyM)} m)` : "";
  return `${latitude.toFixed(5)}, ${longitude.toFixed(5)}${accuracy}`;
}

export function collectorLabel(name: string | null | undefined): string {
  return name?.trim() || "Name not available";
}
