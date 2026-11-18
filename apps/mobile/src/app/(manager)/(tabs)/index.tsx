import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";

import { DeliveryRow, ListCard } from "@/components/DeliveryList";
import { SectionHeading } from "@/components/ReviewUi";
import { InlineLink, Message, Screen } from "@/components/Ui";
import { firstName, greeting } from "@/lib/collectorView";
import { listPendingDeliveries, type ManagerDelivery } from "@/lib/review/api";
import { pendingLines, sitesLine, waitingLabel } from "@/lib/review/managerView";
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
  // "Today" and the greeting are worked out on each reload.
  const [now, setNow] = useState(() => new Date());

  // Reload whenever the tab is shown, so a reviewed delivery leaves the queue.
  const reload = useCallback(() => {
    setNow(new Date());
    setVersion((v) => v + 1);
  }, []);
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

  const name = firstName(profile?.full_name);
  const heading =
    list.status === "ready" && sites.status === "ready" ? waitingLabel(list.deliveries.length) : "Waiting for review";

  return (
    <Screen
      align="top"
      title={name ? `${greeting(now)}, ${name}` : greeting(now)}
      subtitle={sites.status === "ready" ? (sitesLine(sites.sites.map((site) => site.name)) ?? undefined) : undefined}
      refreshing={false}
      onRefresh={reload}
    >
      <SectionHeading note="Newest first. Tap a delivery to weigh and review it. Pull down to refresh.">
        {heading}
      </SectionHeading>

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

      {list.status === "ready" && list.deliveries.length > 0 ? (
        <ListCard>
          {list.deliveries.map((delivery) => (
            <DeliveryRow
              key={delivery.id}
              accessibilityHint="Opens the delivery to review it"
              badge={{ label: "Pending review", tone: "amber" }}
              detail={pendingLines(delivery, now)}
              onPress={() => router.push({ pathname: "/(manager)/delivery/[id]", params: { id: delivery.id } })}
              title={collectorLabel(delivery.collectorName)}
            />
          ))}
        </ListCard>
      ) : null}
    </Screen>
  );
}
