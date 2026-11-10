import { router } from "expo-router";

import { AccountSummary } from "@/components/AccountSummary";
import { PrimaryButton, Screen } from "@/components/Ui";

export default function AdminOverview() {
  return (
    <Screen title="Admin overview" subtitle="Manage invitations and access requests.">
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
    </Screen>
  );
}
