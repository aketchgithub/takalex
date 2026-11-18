// Status shown as a coloured badge. The word is always there: colour is
// never the only signal.

import { StyleSheet, Text, View } from "react-native";

import type { InvitationDisplayStatus, RequestStatus } from "@/lib/admin/model";
import { deliveryStatusLabel, type DeliveryStatus } from "@/lib/outbox/presentation";
import type { Palette } from "@/theme/tokens";
import { useColors, useThemedStyles } from "@/theme/useTheme";

export type StatusTone = "amber" | "green" | "red" | "grey";

// Soft pill colours from theme/tokens.ts, in the current theme (text passes
// WCAG AA on its fill).
function toneColors(c: Palette, tone: StatusTone): { backgroundColor: string; borderColor: string; color: string } {
  switch (tone) {
    case "amber":
      return { backgroundColor: c.warningSoft, borderColor: c.warningSoft, color: c.warning };
    case "green":
      return { backgroundColor: c.successSoft, borderColor: c.successSoft, color: c.success };
    case "red":
      return { backgroundColor: c.dangerSoft, borderColor: c.dangerSoft, color: c.danger };
    case "grey":
      return { backgroundColor: c.divider, borderColor: c.divider, color: c.neutralText };
  }
}

export const DELIVERY_TONES: Record<DeliveryStatus, StatusTone> = {
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
  const styles = useThemedStyles(makeStyles);
  const { backgroundColor, borderColor, color } = toneColors(useColors(), tone);
  return (
    <View style={[styles.badge, { backgroundColor, borderColor }]}>
      <Text style={[styles.badgeText, { color }]}>{label}</Text>
    </View>
  );
}

// "Status" on the left, the badge on the right, and an optional note (a
// rejection reason) as plain text underneath.
export function StatusRow({ label, tone, note }: { label: string; tone: StatusTone; note?: string | null }) {
  const styles = useThemedStyles(makeStyles);
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

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    badge: {
      alignSelf: "flex-start",
      borderRadius: 999,
      borderWidth: 1,
      flexShrink: 1,
      paddingHorizontal: 10,
      paddingVertical: 4,
    },
    badgeText: { fontSize: 12, fontWeight: "600" },
    block: { gap: 4 },
    row: { alignItems: "center", flexDirection: "row", gap: 12, justifyContent: "space-between" },
    rowLabel: { color: c.muted, flexShrink: 0, fontSize: 14 },
    note: { color: c.text, fontSize: 14, lineHeight: 20 },
  });
