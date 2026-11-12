import { router } from "expo-router";
import { StyleSheet, Text, View } from "react-native";

import { AccountSummary } from "@/components/AccountSummary";
import { MaterialTotalsCard } from "@/components/MaterialTotalsCard";
import { PrimaryButton, Screen, SecondaryButton, uiStyles } from "@/components/Ui";
import { rangeLabel, totalsHeading } from "@/lib/recycler/model";
import { useMaterialTotals } from "@/lib/recycler/useMaterialTotals";

export default function AdminOverview() {
  // All sites, all time: the same numbers recyclers see by default.
  const totals = useMaterialTotals(null, null, null);

  return (
    <Screen
      align="top"
      title="Admin overview"
      subtitle="Manage invitations and access requests."
      refreshing={totals.refreshing}
      onRefresh={totals.reload}
    >
      <View style={styles.card}>
        <Text accessibilityRole="header" style={uiStyles.sectionHeading}>
          Quick actions
        </Text>
        <PrimaryButton
          label="Review access requests"
          onPress={() => router.push("/(admin)/(tabs)/access-requests")}
        />
        <SecondaryButton
          label="Invite a team member"
          onPress={() => router.push("/(admin)/(tabs)/invite")}
        />
        <SecondaryButton
          label="Manage invitations"
          onPress={() => router.push("/(admin)/(tabs)/invitations")}
        />
      </View>
      <MaterialTotalsCard
        heading={totalsHeading("all")}
        note={`All sites. ${rangeLabel({ from: null, to: null })} Pull down to refresh.`}
        state={totals.state}
      />
      <AccountSummary showSites={false} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { ...uiStyles.card, gap: 12 },
});
