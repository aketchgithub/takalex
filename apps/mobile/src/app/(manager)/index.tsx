import { AccountSummary } from "@/components/AccountSummary";
import { Message, Screen } from "@/components/Ui";
import { useAuthStore } from "@/stores/authStore";

export default function ManagerHome() {
  const profile = useAuthStore((state) => state.profile);

  return (
    <Screen
      title={`Hello${profile?.full_name ? `, ${profile.full_name}` : ""}`}
      subtitle="Your site manager account."
    >
      <AccountSummary />
      <Message>
        Reviewing deliveries for your sites (checking the photo, recording the
        verified weight by material, approving or rejecting) is not available
        yet. Pending deliveries will appear here once it is.
      </Message>
    </Screen>
  );
}
