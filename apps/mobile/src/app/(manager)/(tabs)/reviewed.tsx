import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";

import { DeliveryRow, ListCard } from "@/components/DeliveryList";
import { DELIVERY_TONES } from "@/components/StatusBadge";
import { InlineLink, Message, Screen } from "@/components/Ui";
import { deliveryPillLabel } from "@/lib/collectorView";
import { listReviewedDeliveries, type ReviewedDelivery } from "@/lib/review/api";
import { reviewedLines } from "@/lib/review/managerView";
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
  const [now, setNow] = useState(() => new Date());

  const reload = useCallback(() => {
    setNow(new Date());
    setVersion((v) => v + 1);
  }, []);
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
    <Screen
      align="top"
      title="Reviewed"
      subtitle="Deliveries you have approved or rejected, newest first. Reviews are final."
      refreshing={false}
      onRefresh={reload}
    >
      {sites.status === "error" ? <Message tone="error">{sites.message}</Message> : null}
      {list.status === "loading" && sites.status !== "error" ? <Message>Loading your reviews…</Message> : null}
      {list.status === "error" ? <Message tone="error">{list.message}</Message> : null}
      {sites.status === "error" || list.status === "error" ? <InlineLink label="Try again" onPress={reload} /> : null}
      {list.status === "ready" && list.deliveries.length === 0 ? (
        <Message>You have not reviewed any deliveries yet.</Message>
      ) : null}

      {list.status === "ready" && list.deliveries.length > 0 ? (
        <ListCard>
          {list.deliveries.map((delivery) => (
            <DeliveryRow
              key={delivery.id}
              accessibilityHint="Opens the reviewed delivery"
              badge={{ label: deliveryPillLabel(delivery.status), tone: DELIVERY_TONES[delivery.status] }}
              detail={reviewedLines(delivery, now)}
              onPress={() => router.push({ pathname: "/(manager)/delivery/[id]", params: { id: delivery.id } })}
              title={collectorLabel(delivery.collectorName)}
            />
          ))}
        </ListCard>
      ) : null}
    </Screen>
  );
}
