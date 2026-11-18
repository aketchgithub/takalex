import { router } from "expo-router";
import { StyleSheet, Text, View } from "react-native";

import { MaterialTotalsCard } from "@/components/MaterialTotalsCard";
import { Screen, SecondaryButton, uiStylesOf, useUiStyles } from "@/components/Ui";
import { rangeLabel, totalsHeading } from "@/lib/recycler/model";
import { useMaterialTotals } from "@/lib/recycler/useMaterialTotals";
import type { Palette } from "@/theme/tokens";
import { useThemedStyles } from "@/theme/useTheme";

export default function AdminOverview() {
  const ui = useUiStyles();
  const styles = useThemedStyles(makeStyles);
  // All sites, all time: the same numbers recyclers see by default.
  const totals = useMaterialTotals(null, null, null);

  return (
    <Screen
      align="top"
      title="Admin overview"
      subtitle="Access requests, invitations and sites are in the tabs below."
      refreshing={totals.refreshing}
      onRefresh={totals.reload}
    >
      <View style={styles.card}>
        <Text accessibilityRole="header" style={ui.sectionHeading}>
          Materials
        </Text>
        <Text style={ui.meta}>Add, rename, reorder or retire the materials collectors can record.</Text>
        {/* Not a tab, so it is opened from here. "as any": the generated route
            types only learn new routes when Expo next starts. */}
        <SecondaryButton label="Manage materials" onPress={() => router.push("/(admin)/materials" as any)} />
      </View>
      <MaterialTotalsCard
        heading={totalsHeading("all")}
        note={`All sites. ${rangeLabel({ from: null, to: null })} Pull down to refresh.`}
        state={totals.state}
      />
    </Screen>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    card: { ...uiStylesOf(c).card, gap: 12 },
  });
