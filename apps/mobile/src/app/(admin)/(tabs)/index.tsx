import { router } from "expo-router";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { AdminAnalytics } from "@/components/AdminAnalytics";
import { MaterialTotalsCard } from "@/components/MaterialTotalsCard";
import { Screen, SecondaryButton, uiStylesOf, useUiStyles } from "@/components/Ui";
import { nairobiDate, rangeLabel, totalsHeading } from "@/lib/recycler/model";
import { useMaterialTotals } from "@/lib/recycler/useMaterialTotals";
import type { Palette } from "@/theme/tokens";
import { useThemedStyles } from "@/theme/useTheme";

export default function AdminOverview() {
  const ui = useUiStyles();
  const styles = useThemedStyles(makeStyles);
  // All sites, all time: the same numbers recyclers see by default.
  const totals = useMaterialTotals(null, null, null);
  // Analytics: today's Nairobi date and a counter, both renewed on pull to refresh.
  const [today, setToday] = useState(() => nairobiDate(new Date()));
  const [analyticsVersion, setAnalyticsVersion] = useState(0);

  return (
    <Screen
      align="top"
      title="Admin overview"
      subtitle="Access requests, invitations and sites are in the tabs below."
      refreshing={totals.refreshing}
      onRefresh={() => {
        totals.reload();
        setToday(nairobiDate(new Date()));
        setAnalyticsVersion((v) => v + 1);
      }}
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
      <AdminAnalytics today={today} version={analyticsVersion} />
    </Screen>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    card: { ...uiStylesOf(c).card, gap: 12 },
  });
