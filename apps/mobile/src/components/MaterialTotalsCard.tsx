import { StyleSheet, Text, View } from "react-native";

import { Message, uiColors, uiStyles } from "@/components/Ui";
import { formatTotalKg, hasAnyMaterial, totalKg, type MaterialTotal } from "@/lib/recycler/model";

export type TotalsState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; rows: MaterialTotal[] };

// Material -> verified kg, with a total. Shared by the recycler home and the
// admin overview.
export function MaterialTotalsCard({
  heading,
  note,
  state,
  updating = false,
  emptyText = "No approved, verified material yet for this selection.",
}: {
  heading: string;
  note?: string;
  state: TotalsState;
  // The numbers shown belong to the previous filter; new ones are loading.
  updating?: boolean;
  emptyText?: string;
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.heading}>{heading}</Text>
      {note ? <Text style={styles.note}>{note}</Text> : null}

      {state.status === "loading" ? <Message>Loading totals…</Message> : null}
      {state.status === "error" ? <Message tone="error">{state.message}</Message> : null}

      {updating ? (
        <Text accessibilityLiveRegion="polite" style={styles.updating}>
          Updating…
        </Text>
      ) : null}

      {state.status === "ready" ? (
        <View accessibilityState={{ busy: updating }} style={updating ? styles.dimmed : null}>
          {state.rows.map((row) => (
            <View key={row.code} accessible accessibilityLabel={`${row.displayName}: ${formatTotalKg(row.verifiedWeightKg)}`} style={styles.row}>
              <Text style={styles.material}>{row.displayName}</Text>
              <Text style={[styles.kg, row.verifiedWeightKg === 0 ? styles.zero : null]}>
                {formatTotalKg(row.verifiedWeightKg)}
              </Text>
            </View>
          ))}
          <View accessible accessibilityLabel={`Total: ${formatTotalKg(totalKg(state.rows))}`} style={[styles.row, styles.totalRow]}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalKg}>{formatTotalKg(totalKg(state.rows))}</Text>
          </View>
          {!hasAnyMaterial(state.rows) && !updating ? <Message>{emptyText}</Message> : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: uiStyles.card,
  heading: uiStyles.sectionHeading,
  note: uiStyles.meta,
  updating: { color: uiColors.muted, fontSize: 13, fontStyle: "italic" },
  dimmed: { opacity: 0.4 },
  row: {
    borderBottomColor: uiColors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 8,
  },
  material: { color: uiColors.text, fontSize: 15 },
  kg: { color: uiColors.text, fontSize: 15, fontVariant: ["tabular-nums"], fontWeight: "600" },
  zero: { color: uiColors.muted, fontWeight: "400" },
  totalRow: { borderBottomWidth: 0, borderTopColor: uiColors.text, borderTopWidth: 1, marginTop: 2 },
  totalLabel: { color: uiColors.text, fontSize: 16, fontWeight: "700" },
  totalKg: { color: uiColors.text, fontSize: 16, fontVariant: ["tabular-nums"], fontWeight: "800" },
});
