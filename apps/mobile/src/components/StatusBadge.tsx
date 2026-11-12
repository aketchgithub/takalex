// Status shown as a coloured badge. The word is always there: colour is
// never the only signal.

import { StyleSheet, Text, View } from "react-native";

import { uiColors } from "@/components/Ui";
import type { InvitationDisplayStatus, RequestStatus } from "@/lib/admin/model";
import { deliveryStatusLabel, type DeliveryStatus } from "@/lib/outbox/presentation";

export type StatusTone = "amber" | "green" | "red" | "grey";

// Text on its badge background is at least 7:1.
const TONES: Record<StatusTone, { backgroundColor: string; borderColor: string; color: string }> = {
  amber: { backgroundColor: "#fff4d6", borderColor: "#e3c56f", color: "#6b4e00" },
  green: { backgroundColor: "#e3f1e7", borderColor: "#9cc9ad", color: "#1b5637" },
  red: { backgroundColor: "#fbe9e9", borderColor: "#e0a9a9", color: "#8a2424" },
  grey: { backgroundColor: "#eceee8", borderColor: "#c9cfc2", color: "#3f4a3d" },
};

const DELIVERY_TONES: Record<DeliveryStatus, StatusTone> = {
  pending: "amber",
  approved: "green",
  rejected: "red",
};

// Waiting for the admin = amber; done = green; refused = red.
export const REQUEST_TONES: Record<RequestStatus, StatusTone> = {
  submitted: "amber",
  reviewed: "amber",
  approved: "amber",
  invited: "green",
  rejected: "red",
};

export const INVITATION_TONES: Record<InvitationDisplayStatus, StatusTone> = {
  pending: "amber",
  accepted: "green",
  revoked: "red",
  expired: "grey",
  superseded: "grey",
};

export function StatusBadge({ label, tone }: { label: string; tone: StatusTone }) {
  const { backgroundColor, borderColor, color } = TONES[tone];
  return (
    <View style={[styles.badge, { backgroundColor, borderColor }]}>
      <Text style={[styles.badgeText, { color }]}>{label}</Text>
    </View>
  );
}

// "Status" on the left, the badge on the right, and an optional note (a
// rejection reason) as plain text underneath.
export function StatusRow({ label, tone, note }: { label: string; tone: StatusTone; note?: string | null }) {
  return (
    <View style={styles.block}>
      <View accessible accessibilityLabel={`Status: ${label}`} style={styles.row}>
        <Text style={styles.rowLabel}>Status</Text>
        <StatusBadge label={label} tone={tone} />
      </View>
      {note ? <Text style={styles.note}>{note}</Text> : null}
    </View>
  );
}

// A delivery's status with the usual wording; the rejection reason stays
// visible under the badge.
export function DeliveryStatusRow({
  status,
  rejectionReason,
}: {
  status: DeliveryStatus;
  rejectionReason: string | null;
}) {
  const reason = status === "rejected" ? rejectionReason?.trim() : null;
  return (
    <StatusRow
      label={deliveryStatusLabel(status, null)}
      note={reason ? `Reason: ${reason}` : null}
      tone={DELIVERY_TONES[status]}
    />
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: "flex-start",
    borderRadius: 8,
    borderWidth: 1,
    flexShrink: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  badgeText: { fontSize: 13, fontWeight: "700" },
  block: { gap: 4 },
  row: { alignItems: "center", flexDirection: "row", gap: 12, justifyContent: "space-between" },
  rowLabel: { color: uiColors.muted, flexShrink: 0, fontSize: 14 },
  note: { color: uiColors.text, fontSize: 14, lineHeight: 20 },
});
