import { useRouter } from "expo-router";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { AccountSummary } from "@/components/AccountSummary";
import { InlineLink, Message, PrimaryButton, Screen, SecondaryButton, uiColors } from "@/components/Ui";
import { syncNow } from "@/lib/outbox";
import { deliveries, syncNowOutcome, type Notice } from "@/lib/outbox/presentation";
import { useWaitingDeliveries } from "@/lib/outbox/useWaitingDeliveries";
import { useAuthStore } from "@/stores/authStore";

export default function CollectorHome() {
  const router = useRouter();
  const profile = useAuthStore((state) => state.profile);
  const waiting = useWaitingDeliveries();
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  const total = waiting.pending + waiting.failed;

  const runSync = async () => {
    setSyncing(true);
    setNotice(null);
    try {
      setNotice(syncNowOutcome(await syncNow()));
    } finally {
      setSyncing(false);
    }
  };

  return (
    <Screen
      title={`Hello${profile?.full_name ? `, ${profile.full_name}` : ""}`}
      subtitle="Your collector account."
    >
      <PrimaryButton label="New delivery" onPress={() => router.push("/(collector)/log")} />

      <View style={styles.card}>
        <Text style={styles.count}>
          {waiting.loaded ? (total === 0 ? "Nothing waiting to upload" : `${deliveries(total)} waiting to upload`) : "Checking this phone…"}
        </Text>
        {waiting.failed > 0 ? (
          <Message tone="error">
            {deliveries(waiting.failed)} could not be uploaded. Open History to retry or discard.
          </Message>
        ) : null}
        {waiting.error ? <Message tone="error">{waiting.error}</Message> : null}
        <SecondaryButton label="Sync now" loading={syncing} onPress={() => void runSync()} />
        {notice ? <Message tone={notice.tone}>{notice.text}</Message> : null}
        <InlineLink label="View history" onPress={() => router.push("/(collector)/history")} />
      </View>

      <AccountSummary />
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: uiColors.white,
    borderColor: uiColors.border,
    borderRadius: 12,
    borderWidth: 1,
    gap: 10,
    padding: 14,
  },
  count: { color: uiColors.text, fontSize: 17, fontWeight: "700" },
});
