import { router } from "expo-router";

import { Message, PrimaryButton, Screen } from "@/components/Ui";

export default function SitesScreen() {
  return (
    <Screen
      title="Takalex sites"
      subtitle="Public discovery for site awareness and onboarding."
    >
      <Message>
        Site information is visible in the public layer to explain the network and onboarding flow.
      </Message>
      <Message>
        Operational site access, collection rules, and site-level data remain behind the invite-only access model.
      </Message>
      <PrimaryButton label="Request access" onPress={() => router.push("/request-access" as any)} />
      <PrimaryButton label="Back to home" onPress={() => router.replace("/" as any)} />
    </Screen>
  );
}
