import { router } from "expo-router";

import { AccountSummary } from "@/components/AccountSummary";
import { MaterialTotalsCard } from "@/components/MaterialTotalsCard";
import { PrimaryButton, Screen } from "@/components/Ui";
import { rangeLabel, totalsHeading } from "@/lib/recycler/model";
import { useMaterialTotals } from "@/lib/recycler/useMaterialTotals";

export default function AdminOverview() {
  // All sites, all time: the same numbers recyclers see by default.
  const totals = useMaterialTotals(null, null, null);

  return (
    <Screen
      title="Admin overview"
      subtitle="Manage invitations and access requests."
      refreshing={totals.refreshing}
      onRefresh={totals.reload}
    >
      <AccountSummary showSites={false} />
      <PrimaryButton
        label="Invite a team member"
        onPress={() => router.push("/(admin)/invite")}
      />
      <PrimaryButton
        label="Review access requests"
        onPress={() => router.push("/(admin)/access-requests")}
      />
      <PrimaryButton
        label="Manage invitations"
        onPress={() => router.push("/(admin)/invitations")}
      />
      <MaterialTotalsCard
        heading={totalsHeading("all")}
        note={`All sites. ${rangeLabel({ from: null, to: null })} Pull down to refresh.`}
        state={totals.state}
      />
    </Screen>
  );
}
