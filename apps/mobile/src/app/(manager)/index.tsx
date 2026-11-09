import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Text } from "react-native";

import { AccountSummary } from "@/components/AccountSummary";
import { Card, Row, SectionHeading, reviewStyles } from "@/components/ReviewUi";
import { InlineLink, Message, Screen } from "@/components/Ui";
import { formatDateTime, formatKg } from "@/lib/outbox/presentation";
import { listPendingDeliveries, type ManagerDelivery } from "@/lib/review/api";
import { collectorLabel } from "@/lib/review/model";
import { useManagerSites } from "@/lib/review/useManagerSites";
import { useAuthStore } from "@/stores/authStore";

type ListState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; deliveries: ManagerDelivery[] };

export default function PendingDeliveriesScreen() {
  const router = useRouter();
  const profile = useAuthStore((state) => state.profile);
  const [version, setVersion] = useState(0);
  const sites = useManagerSites(version);
  const [list, setList] = useState<ListState>({ status: "loading" });

  // Reload whenever the tab is shown, so a reviewed delivery leaves the queue.
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  useFocusEffect(reload);

  useEffect(() => {
    if (sites.status !== "ready") return;
    let active = true;
    listPendingDeliveries(sites.sites.map((site) => site.id))
      .then((deliveries) => {
        if (active) setList({ status: "ready", deliveries });
      })
      .catch((error: unknown) => {
        if (active) {
          setList({
            status: "error",
            message: error instanceof Error ? error.message : "Could not load pending deliveries.",
          });
        }
      });
    return () => {
      active = false;
    };
  }, [sites]);

  const siteNames = sites.status === "ready" ? sites.sites.map((site) => site.name).join(", ") : "";

  return (
    <Screen
      title={`Hello${profile?.full_name ? `, ${profile.full_name}` : ""}`}
      subtitle="Deliveries waiting for your review, newest first."
    >
      <SectionHeading note={siteNames ? `Your sites: ${siteNames}` : undefined}>Pending review</SectionHeading>

      {sites.status === "error" ? <Message tone="error">{sites.message}</Message> : null}
      {sites.status === "ready" && sites.sites.length === 0 ? (
        <Message>You have no assigned sites. Ask an administrator to assign one.</Message>
      ) : null}
      {list.status === "loading" && sites.status !== "error" ? <Message>Loading deliveries…</Message> : null}
      {list.status === "error" ? <Message tone="error">{list.message}</Message> : null}
      {sites.status === "error" || list.status === "error" ? <InlineLink label="Try again" onPress={reload} /> : null}
      {list.status === "ready" && list.deliveries.length === 0 && sites.status === "ready" && sites.sites.length > 0 ? (
        <Message>No deliveries are waiting for review.</Message>
      ) : null}

      {list.status === "ready"
        ? list.deliveries.map((delivery) => (
            <Card
              key={delivery.id}
              label={`Open delivery from ${collectorLabel(delivery.collectorName)}`}
              onPress={() => router.push({ pathname: "/(manager)/delivery/[id]", params: { id: delivery.id } })}
            >
              <Text style={reviewStyles.title}>{collectorLabel(delivery.collectorName)}</Text>
              <Text style={reviewStyles.meta}>
                {delivery.siteName ?? "Unknown site"} · submitted {formatDateTime(delivery.submittedAt)}
              </Text>
              <Row label="Reported material" value={delivery.materialName ?? delivery.materialCode} />
              <Row label="Reported weight" value={formatKg(delivery.reportedWeightKg)} />
            </Card>
          ))
        : null}

      <InlineLink label="Refresh" onPress={reload} />
      <AccountSummary showSites={false} />
    </Screen>
  );
}
