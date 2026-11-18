import { StyleSheet, Text, View } from "react-native";

import { Message, uiStylesOf } from "@/components/Ui";
import { barFraction, formatTotalKg, hasAnyMaterial, totalKg, type MaterialTotal } from "@/lib/recycler/model";
import { radius, type, type Palette } from "@/theme/tokens";
import { useFontSize } from "@/theme/useFontSize";
import { useThemedStyles } from "@/theme/useTheme";

export type TotalsState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; rows: MaterialTotal[] };

// The total first, in large type, then each material with its weight and a
// bar showing its share of the largest one. Shared by the recycler home and
// the admin overview.
//   scope      what the numbers cover, e.g. "All sites · This month"
//   totalLabel label above the total
export function MaterialTotalsCard({
  heading,
  scope,
  note,
  state,
  updating = false,
  emptyText = "No approved, verified material yet for this selection.",
  totalLabel = "Total",
}: {
  heading: string;
  scope?: string;
  note?: string;
  totalLabel?: string;
  state: TotalsState;
  // The numbers shown belong to the previous filter; new ones are loading.
  updating?: boolean;
  emptyText?: string;
}) {
  const styles = useThemedStyles(makeStyles);
  const fs = useFontSize();
  return (
    <View style={styles.card}>
      <Text accessibilityRole="header" style={[styles.heading, { fontSize: fs(type.title) }]}>
        {heading}
      </Text>
      {scope ? <Text style={[styles.scope, { fontSize: fs(type.meta) }]}>{scope}</Text> : null}

      {state.status === "loading" ? <Message>Loading totals…</Message> : null}
      {state.status === "error" ? <Message tone="error">{state.message}</Message> : null}

      {updating ? (
        <Text accessibilityLiveRegion="polite" style={[styles.updating, { fontSize: fs(type.meta) }]}>
          Updating…
        </Text>
      ) : null}

      {state.status === "ready" ? (
        <View accessibilityState={{ busy: updating }} style={[styles.body, updating ? styles.dimmed : null]}>
          <View
            accessible
            accessibilityLabel={`${totalLabel}: ${formatTotalKg(totalKg(state.rows))}`}
            style={styles.totalBox}
          >
            <Text style={[styles.totalLabel, { fontSize: fs(type.label) }]}>{totalLabel}</Text>
            <Text style={[styles.totalKg, { fontSize: fs(30) }]}>{formatTotalKg(totalKg(state.rows))}</Text>
          </View>

          {state.rows.map((row) => {
            const share = barFraction(row.verifiedWeightKg, state.rows);
            return (
              <View
                key={row.code}
                accessible
                accessibilityLabel={`${row.displayName}: ${formatTotalKg(row.verifiedWeightKg)}`}
                style={styles.row}
              >
                <View style={styles.rowText}>
                  <Text style={[styles.material, { fontSize: fs(type.body) }]}>{row.displayName}</Text>
                  <Text
                    style={[styles.kg, row.verifiedWeightKg === 0 ? styles.zero : null, { fontSize: fs(type.body) }]}
                  >
                    {formatTotalKg(row.verifiedWeightKg)}
                  </Text>
                </View>
                {/* The bar and the empty rest share the track by flex. */}
                <View style={styles.track}>
                  {share > 0 ? <View style={[styles.bar, { flex: share }]} /> : null}
                  <View style={{ flex: 1 - share }} />
                </View>
              </View>
            );
          })}
          {!hasAnyMaterial(state.rows) && !updating ? <Message>{emptyText}</Message> : null}
        </View>
      ) : null}

      {note ? <Text style={[styles.note, { fontSize: fs(type.meta) }]}>{note}</Text> : null}
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    card: { ...uiStylesOf(c).card, gap: 12 },
    heading: uiStylesOf(c).sectionHeading,
    scope: { color: c.muted, fontWeight: "600" },
    note: uiStylesOf(c).meta,
    updating: { color: c.muted, fontStyle: "italic" },
    dimmed: { opacity: 0.4 },
    body: { gap: 14 },
    totalBox: {
      backgroundColor: c.primarySoft,
      borderRadius: radius.lg,
      gap: 2,
      paddingHorizontal: 16,
      paddingVertical: 14,
    },
    totalLabel: { color: c.primary, fontWeight: "700" },
    totalKg: { color: c.text, fontVariant: ["tabular-nums"], fontWeight: "800" },
    row: { gap: 6 },
    rowText: { flexDirection: "row", gap: 12, justifyContent: "space-between" },
    material: { color: c.text, flex: 1 },
    kg: { color: c.text, fontVariant: ["tabular-nums"], fontWeight: "700" },
    zero: { color: c.muted, fontWeight: "400" },
    track: { backgroundColor: c.track, borderRadius: radius.pill, flexDirection: "row", height: 8, overflow: "hidden" },
    bar: { backgroundColor: c.primary, borderRadius: radius.pill },
  });
