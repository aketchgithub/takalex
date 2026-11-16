import { router } from "expo-router";

import { Message, PrimaryButton, Screen } from "@/components/Ui";

export default function AboutScreen() {
  return (
    <Screen
      title="About Takalex"
      subtitle="A trusted operating layer for recyclable collection and site coordination."
    >
      <Message>
        Takalex is built to make collection operations more transparent, traceable, and easier to manage for local teams and site operators.
      </Message>
      <Message>
        The public surface explains the mission and how access works. Real operational actions remain invite-only so the platform stays secure, compliant, and manageable for non-technical administrators.
      </Message>
      <PrimaryButton label="Request access" onPress={() => router.push("/request-access" as any)} />
      <PrimaryButton label="Back home" onPress={() => router.replace("/" as any)} />
    </Screen>
  );
}
