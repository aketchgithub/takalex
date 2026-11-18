import Feather from "@expo/vector-icons/Feather";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { DeliveryRow, ListCard } from "@/components/DeliveryList";
import { SectionHeading } from "@/components/ReviewUi";
import { DELIVERY_TONES } from "@/components/StatusBadge";
import { InlineLink, Message, Screen, SecondaryButton, uiColors, uiStyles } from "@/components/Ui";
import { loadCollectorContext } from "@/lib/collectorContext";
import {
  deliveryDetail,
  deliveryPillLabel,
  deliveryTitle,
  firstName,
  greeting,
  RECENT_COUNT,
  recentDeliveries,
} from "@/lib/collectorView";
import { listMyDeliveries } from "@/lib/deliveries";
import { subscribeOutbox, syncNow } from "@/lib/outbox";
import { deliveries, syncNowOutcome, type Notice, type ServerDelivery } from "@/lib/outbox/presentation";
import { useWaitingDeliveries } from "@/lib/outbox/useWaitingDeliveries";
import { useAuthStore } from "@/stores/authStore";
import { radius, type } from "@/theme/tokens";
import { useFontSize } from "@/theme/useFontSize";

type RecentState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; deliveries: ServerDelivery[] };

export default function CollectorHome() {
  const router = useRouter();
  const fs = useFontSize();
  const profile = useAuthStore((state) => state.profile);
  const waiting = useWaitingDeliveries();
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [siteName, setSiteName] = useState<string | null>(null);
  const [recent, setRecent] = useState<RecentState>({ status: "loading" });
  const [recentVersion, setRecentVersion] = useState(0);
  // "Today" and the greeting are worked out when the screen is shown.
  const [now, setNow] = useState(() => new Date());

  const reloadRecent = useCallback(() => setRecentVersion((v) => v + 1), []);
  useFocusEffect(
    useCallback(() => {
      setNow(new Date());
      reloadRecent();
    }, [reloadRecent]),
  );
  // A sync run may have just put new deliveries on the server.
  useEffect(() => subscribeOutbox(reloadRecent), [reloadRecent]);

  // The group under the greeting: the collector's site (cached offline).
  useEffect(() => {
    if (!profile) return;
    let active = true;
    loadCollectorContext(profile)
      .then((context) => {
        if (active) setSiteName(context.site?.name ?? null);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [profile]);

  useEffect(() => {
    if (!profile) return;
    let active = true;
    listMyDeliveries(profile.id)
      .then((list) => {
        if (active) setRecent({ status: "ready", deliveries: recentDeliveries(list) });
      })
      .catch((error: unknown) => {
        if (active) {
          setRecent({ status: "error", message: error instanceof Error ? error.message : "Could not load your deliveries." });
        }
      });
    return () => {
      active = false;
    };
  }, [profile, recentVersion]);

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

  const name = firstName(profile?.full_name);
  const upload = !waiting.loaded
    ? { icon: "loader" as const, color: uiColors.muted, text: "Checking this phone…" }
    : waiting.failed > 0
      ? { icon: "alert-circle" as const, color: uiColors.danger, text: `${deliveries(waiting.failed)} could not be uploaded` }
      : total > 0
        ? { icon: "upload-cloud" as const, color: uiColors.warning, text: `${deliveries(total)} waiting to upload` }
        : { icon: "check-circle" as const, color: uiColors.success, text: "All deliveries uploaded" };

  return (
    <Screen
      align="top"
      title={name ? `${greeting(now)}, ${name}` : greeting(now)}
      subtitle={siteName ? `${siteName} group` : undefined}
      refreshing={false}
      onRefresh={() => {
        setNow(new Date());
        reloadRecent();
        waiting.reload();
      }}
    >
      <Pressable
        accessibilityHint="Opens the Record tab"
        accessibilityLabel="Record a delivery"
        accessibilityRole="button"
        onPress={() => router.push("/(collector)/log")}
        style={({ pressed }) => [styles.record, pressed ? styles.recordPressed : null]}
      >
        <View style={styles.recordIcon}>
          <Feather color={uiColors.white} name="camera" size={24} />
        </View>
        <View style={styles.recordText}>
          <Text style={[styles.recordTitle, { fontSize: fs(type.title) }]}>Record a delivery</Text>
          <Text style={[styles.recordSubtitle, { fontSize: fs(type.meta) }]}>Photo, material and weight</Text>
        </View>
        <Feather color={uiColors.white} name="chevron-right" size={22} />
      </Pressable>

      <View style={styles.card}>
        <View style={styles.uploadRow}>
          <Feather color={upload.color} name={upload.icon} size={22} />
          <Text style={[styles.uploadText, { fontSize: fs(type.cardTitle) }]}>{upload.text}</Text>
        </View>
        {waiting.failed > 0 ? (
          <Message tone="error">Open the History tab to retry or discard.</Message>
        ) : null}
        {waiting.error ? <Message tone="error">{waiting.error}</Message> : null}
        <SecondaryButton label="Sync now" loading={syncing} onPress={() => void runSync()} />
        {notice ? <Message tone={notice.tone}>{notice.text}</Message> : null}
      </View>

      <View style={uiStyles.section}>
        <SectionHeading>Recent deliveries</SectionHeading>
        {recent.status === "loading" ? <Message>Loading your deliveries…</Message> : null}
        {recent.status === "error" ? (
          <>
            <Message tone="error">{recent.message}</Message>
            <InlineLink label="Try again" onPress={reloadRecent} />
          </>
        ) : null}
        {recent.status === "ready" && recent.deliveries.length === 0 ? (
          <Message>No deliveries sent yet. Your last {RECENT_COUNT} will show here.</Message>
        ) : null}
        {recent.status === "ready" && recent.deliveries.length > 0 ? (
          <ListCard>
            {recent.deliveries.map((delivery) => (
              <DeliveryRow
                key={delivery.id}
                title={deliveryTitle(delivery.materialName ?? delivery.materialCode, delivery.reportedWeightKg)}
                detail={deliveryDetail(delivery, now)}
                badge={{ label: deliveryPillLabel(delivery.status), tone: DELIVERY_TONES[delivery.status] }}
              />
            ))}
          </ListCard>
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  record: {
    alignItems: "center",
    backgroundColor: uiColors.primary,
    borderRadius: radius.xl,
    flexDirection: "row",
    gap: 14,
    minHeight: 84,
    paddingHorizontal: 18,
    paddingVertical: 16,
  },
  recordPressed: { backgroundColor: uiColors.primaryPressed },
  recordIcon: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.18)",
    borderRadius: radius.pill,
    height: 48,
    justifyContent: "center",
    width: 48,
  },
  recordText: { flex: 1, gap: 2 },
  recordTitle: { color: uiColors.white, fontWeight: "700" },
  recordSubtitle: { color: "rgba(255,255,255,0.85)" },
  card: { ...uiStyles.card, gap: 12 },
  uploadRow: { alignItems: "center", flexDirection: "row", gap: 10 },
  uploadText: { color: uiColors.text, flex: 1, fontWeight: "700" },
});
