import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Text } from "react-native";

import { Card, Row, SectionHeading, reviewStyles } from "@/components/ReviewUi";
import { DeliveryStatusRow } from "@/components/StatusBadge";
import { InlineLink, Message, Screen } from "@/components/Ui";
import { formatDateTime, formatKg } from "@/lib/outbox/presentation";
import { listReviewedDeliveries, type ReviewedDelivery } from "@/lib/review/api";
import { collectorLabel } from "@/lib/review/model";
import { useManagerSites } from "@/lib/review/useManagerSites";
import { useAuthStore } from "@/stores/authStore";

type ListState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; deliveries: ReviewedDelivery[] };

export default function ReviewedDeliveriesScreen() {
  const router = useRouter();
  const managerId = useAuthStore((state) => state.profile?.id ?? null);
  const [version, setVersion] = useState(0);
  const sites = useManagerSites(version);
  const [list, setList] = useState<ListState>({ status: "loading" });

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  useFocusEffect(reload);

  useEffect(() => {
    if (sites.status !== "ready" || !managerId) return;
    let active = true;
    listReviewedDeliveries(managerId, sites.sites.map((site) => site.id))
      .then((deliveries) => {
        if (active) setList({ status: "ready", deliveries });
      })
      .catch((error: unknown) => {
        if (active) {
          setList({
            status: "error",
            message: error instanceof Error ? error.message : "Could not load reviewed deliveries.",
          });
        }
      });
    return () => {
      active = false;
    };
  }, [sites, managerId]);

  return (
    <Screen align="top" title="Reviewed" subtitle="Deliveries you have approved or rejected. Reviews are final.">
      <SectionHeading>Reviewed by you</SectionHeading>
      {sites.status === "error" ? <Message tone="error">{sites.message}</Message> : null}
      {list.status === "loading" && sites.status !== "error" ? <Message>Loading…</Message> : null}
      {list.status === "error" ? <Message tone="error">{list.message}</Message> : null}
      {sites.status === "error" || list.status === "error" ? <InlineLink label="Try again" onPress={reload} /> : null}
      {list.status === "ready" && list.deliveries.length === 0 ? (
        <Message>You have not reviewed any deliveries yet.</Message>
      ) : null}

      {list.status === "ready"
        ? list.deliveries.map((delivery) => (
            <Card
              key={delivery.id}
              label={`Open reviewed delivery from ${collectorLabel(delivery.collectorName)}`}
              onPress={() => router.push({ pathname: "/(manager)/delivery/[id]", params: { id: delivery.id } })}
            >
              <Text style={reviewStyles.title}>{collectorLabel(delivery.collectorName)}</Text>
              <Text style={reviewStyles.meta}>
                {delivery.siteName ?? "Unknown site"} · submitted {formatDateTime(delivery.submittedAt)}
                {delivery.verifiedAt ? ` · reviewed ${formatDateTime(delivery.verifiedAt)}` : ""}
              </Text>
              <DeliveryStatusRow status={delivery.status} rejectionReason={delivery.rejectionReason} />
              <Row
                label="Reported by collector"
                value={`${delivery.materialName ?? delivery.materialCode} · ${formatKg(delivery.reportedWeightKg)}`}
              />
              {delivery.status === "approved" ? (
                <>
                  {delivery.items.map((item) => (
                    <Row
                      key={item.materialCode}
                      label={`Verified ${item.materialName ?? item.materialCode}`}
                      value={formatKg(item.weightKg)}
                    />
                  ))}
                  {delivery.verifiedWeightKg !== null ? (
                    <Row label="Verified total" value={formatKg(delivery.verifiedWeightKg)} />
                  ) : null}
                </>
              ) : null}
            </Card>
          ))
        : null}

      <InlineLink label="Refresh" onPress={reload} />
    </Screen>
  );
}
