import { router } from "expo-router";

import { Message, PrimaryButton, Screen } from "@/components/Ui";

export default function HowItWorksScreen() {
  return (
    <Screen
      title="How Takalex works"
      subtitle="Public discovery, invitation-based action."
    >
      <Message>
        1. The public learns about Takalex and sees how the network works.
      </Message>
      <Message>
        2. A potential collector or team member submits a request for access.
      </Message>
      <Message>
        3. An admin reviews the request and sends an invitation.
      </Message>
      <Message>
        4. The invited user verifies their account and enters the protected collector or admin workspace.
      </Message>
      <Message>
        5. Only approved, invited users can log collections, manage groups, or view operational data.
      </Message>
      <PrimaryButton label="Request access" onPress={() => router.push("/request-access" as any)} />
      <PrimaryButton label="View public home" onPress={() => router.replace("/" as any)} />
    </Screen>
  );
}
