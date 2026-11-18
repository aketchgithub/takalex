// Wording for the collector's Home and History screens. Pure TypeScript
// (tested by collectorView.test.ts). Times are in the phone's time zone,
// like formatDateTime.

import type { DeliveryStatus, ServerDelivery } from "./outbox/presentation.ts";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "Good morning" before 12:00, "Good afternoon" before 17:00, then "Good evening".
export function greeting(now: Date): string {
  const hour = now.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

// The first word of the name, for the greeting. null without a name.
export function firstName(fullName: string | null | undefined): string | null {
  return (fullName ?? "").trim().split(/\s+/)[0] || null;
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

// "Today, 09:14", "Yesterday, 16:02", "14 Nov, 11:30", or "14 Nov 2025, 11:30"
// for another year.
export function friendlyDateTime(iso: string, now: Date): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const time = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  if (days === 0) return `Today, ${time}`;
  if (days === 1) return `Yesterday, ${time}`;
  const year = date.getFullYear() === now.getFullYear() ? "" : ` ${date.getFullYear()}`;
  return `${date.getDate()} ${MONTHS[date.getMonth()]}${year}, ${time}`;
}

// The short word on the status pill (the rejection reason goes in the line
// under the title instead).
export function deliveryPillLabel(status: DeliveryStatus): string {
  if (status === "approved") return "Approved";
  if (status === "rejected") return "Rejected";
  return "Pending review";
}

// "PET · 6.50 kg"
export function deliveryTitle(materialName: string, weightKg: number | string): string {
  const kg = typeof weightKg === "number" ? weightKg : Number(weightKg);
  return `${materialName} · ${Number.isFinite(kg) ? kg.toFixed(2) : String(weightKg)} kg`;
}

// The line under the title: when it was submitted, plus the verified weight
// once approved or the reason once rejected.
export function deliveryDetail(delivery: ServerDelivery, now: Date): string {
  const when = friendlyDateTime(delivery.submittedAt, now);
  if (delivery.status === "approved" && delivery.verifiedWeightKg !== null) {
    return `${when} · verified ${delivery.verifiedWeightKg.toFixed(2)} kg`;
  }
  const reason = delivery.status === "rejected" ? delivery.rejectionReason?.trim() : null;
  return reason ? `${when} · ${reason}` : when;
}

export const RECENT_COUNT = 3;

// The newest deliveries for Home (the list is already newest first).
export function recentDeliveries(deliveries: ServerDelivery[], count = RECENT_COUNT): ServerDelivery[] {
  return deliveries.slice(0, count);
}
