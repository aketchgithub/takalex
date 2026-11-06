import { AccountSummary } from "@/components/AccountSummary";
import { Message, Screen } from "@/components/Ui";
import { useAuthStore } from "@/stores/authStore";

export default function RecyclerHome() {
  const profile = useAuthStore((state) => state.profile);

  return (
    <Screen
      title={`Hello${profile?.full_name ? `, ${profile.full_name}` : ""}`}
      subtitle="Your recycler account."
    >
      <AccountSummary noSitesText="None. Recyclers do not need a site assignment." />
      <Message>
        Available sorted material by type, with its approved verified weight, is
        not available in the app yet. It will appear here once it is.
      </Message>
    </Screen>
  );
}
