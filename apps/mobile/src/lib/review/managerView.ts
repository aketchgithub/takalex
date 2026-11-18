// Wording for the site manager's Pending and Reviewed lists. Pure TypeScript
// (tested by managerView.test.ts).

import { deliveryTitle, friendlyDateTime } from "../collectorView.ts";
import type { ManagerDelivery, ReviewedDelivery } from "./api.ts";

// "1 delivery waiting for review" / "3 deliveries waiting for review"
export function waitingLabel(count: number): string {
  return `${count} ${count === 1 ? "delivery" : "deliveries"} waiting for review`;
}

// "Your sites: Njiru, Kariobangi", or null with no sites.
export function sitesLine(names: string[]): string | null {
  return names.length > 0 ? `Your sites: ${names.join(", ")}` : null;
}

function reported(delivery: ManagerDelivery): string {
  return `${deliveryTitle(delivery.materialName ?? delivery.materialCode, delivery.reportedWeightKg)} reported`;
}

function site(delivery: ManagerDelivery): string {
  return delivery.siteName ?? "Unknown site";
}

// Under the collector's name in Pending:
//   "PET · 6.50 kg reported"
//   "Njiru · Today, 09:14"
export function pendingLines(delivery: ManagerDelivery, now: Date): string[] {
  return [reported(delivery), `${site(delivery)} · ${friendlyDateTime(delivery.submittedAt, now)}`];
}

// Under the collector's name in Reviewed: what was reported, what was
// verified (each material) or why it was rejected, and where and when it was
// reviewed.
export function reviewedLines(delivery: ReviewedDelivery, now: Date): string[] {
  const lines = [reported(delivery)];
  if (delivery.status === "approved") {
    const items = delivery.items.map((item) => `${item.materialName ?? item.materialCode} ${item.weightKg.toFixed(2)} kg`);
    const total = delivery.verifiedWeightKg !== null ? ` (total ${delivery.verifiedWeightKg.toFixed(2)} kg)` : "";
    if (items.length > 0) lines.push(`Verified: ${items.join(", ")}${total}`);
    else if (total) lines.push(`Verified${total}`);
  }
  const reason = delivery.status === "rejected" ? delivery.rejectionReason?.trim() : null;
  if (reason) lines.push(`Reason: ${reason}`);
  const when = friendlyDateTime(delivery.verifiedAt ?? delivery.submittedAt, now);
  lines.push(`${site(delivery)} · ${delivery.verifiedAt ? "reviewed" : "submitted"} ${when}`);
  return lines;
}
