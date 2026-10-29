import { router } from "expo-router";

import { Message, PrimaryButton, Screen } from "@/components/Ui";

export default function WaitlistScreen() {
  return (
    <Screen
      title="Join the waitlist"
      subtitle="A public request is the first step into the operational system."
    >
      <Message>
        If you are interested in becoming a collector or site partner, submit a request and the admin team will review it.
      </Message>
      <Message>
        We keep the operational app closed to unverified users to reduce fraud, support overhead, and onboarding confusion.
      </Message>
      <PrimaryButton label="Submit a request" onPress={() => router.push("/request-access" as any)} />
      <PrimaryButton label="Return home" onPress={() => router.replace("/" as any)} />
    </Screen>
  );
}
