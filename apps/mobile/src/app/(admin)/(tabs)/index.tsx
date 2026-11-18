import { router } from "expo-router";
import { StyleSheet, Text, View } from "react-native";

import { MaterialTotalsCard } from "@/components/MaterialTotalsCard";
import { Screen, SecondaryButton, uiStyles } from "@/components/Ui";
import { rangeLabel, totalsHeading } from "@/lib/recycler/model";
import { useMaterialTotals } from "@/lib/recycler/useMaterialTotals";

export default function AdminOverview() {
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
        <Text accessibilityRole="header" style={uiStyles.sectionHeading}>
          Materials
        </Text>
        <Text style={uiStyles.meta}>Add, rename, reorder or retire the materials collectors can record.</Text>
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

const styles = StyleSheet.create({
  card: { ...uiStyles.card, gap: 12 },
});
