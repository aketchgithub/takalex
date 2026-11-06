import { AccountSummary } from "@/components/AccountSummary";
import { Message, Screen } from "@/components/Ui";
import { useAuthStore } from "@/stores/authStore";

export default function CollectorHome() {
  const profile = useAuthStore((state) => state.profile);

  return (
    <Screen
      title={`Hello${profile?.full_name ? `, ${profile.full_name}` : ""}`}
      subtitle="Your collector account."
    >
      <AccountSummary />
      <Message>
        Recording deliveries (material, weight and a photo) is not available in
        the app yet. Your deliveries and their review status will appear here
        once it is.
      </Message>
    </Screen>
  );
}
