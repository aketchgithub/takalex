import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";

import { DeliveryRow, ListCard } from "@/components/DeliveryList";
import { SectionHeading, reviewStyles } from "@/components/ReviewUi";
import { DELIVERY_TONES } from "@/components/StatusBadge";
import { InlineLink, Message, Screen, SecondaryButton } from "@/components/Ui";
import { cachedMaterialNames } from "@/lib/collectorContext";
import { deliveryDetail, deliveryPillLabel, deliveryTitle, friendlyDateTime } from "@/lib/collectorView";
import { listMyDeliveries } from "@/lib/deliveries";
import { discardDelivery, retryDelivery, subscribeOutbox, type OutboxRow } from "@/lib/outbox";
import {
  discardConfirmation,
  localRowStatus,
  visibleServerDeliveries,
  type DeliveryStatus,
  type ServerDelivery,
} from "@/lib/outbox/presentation";
import { useWaitingDeliveries } from "@/lib/outbox/useWaitingDeliveries";
import { useAuthStore } from "@/stores/authStore";

type ServerState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; deliveries: ServerDelivery[] };

export default function DeliveryHistoryScreen() {
  const userId = useAuthStore((state) => state.profile?.id ?? null);
  const waiting = useWaitingDeliveries();
  const [server, setServer] = useState<ServerState>({ status: "loading" });
  const [serverVersion, setServerVersion] = useState(0);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // "Today" / "Yesterday" are worked out when the list is (re)loaded.
  const [now, setNow] = useState(() => new Date());

  const reloadServer = useCallback(() => setServerVersion((v) => v + 1), []);

  // Reload when the screen is shown and after any outbox change (a sync run
  // may have just put new deliveries on the server).
  useFocusEffect(reloadServer);
  useEffect(() => subscribeOutbox(reloadServer), [reloadServer]);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    listMyDeliveries(userId)
      .then((deliveries) => {
        if (!active) return;
        setNow(new Date());
        setServer({ status: "ready", deliveries });
      })
      .catch((error: unknown) => {
        if (active) {
          setServer({
            status: "error",
            message: error instanceof Error ? error.message : "Could not load your deliveries.",
          });
        }
      });
    return () => {
      active = false;
    };
  }, [userId, serverVersion]);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    void cachedMaterialNames(userId).then((map) => {
      if (active) setNames(map);
    });
    return () => {
      active = false;
    };
  }, [userId, waiting.rows.length]);

  const serverStatusById = useMemo(() => {
    const map = new Map<string, DeliveryStatus>();
    if (server.status === "ready") {
      for (const delivery of server.deliveries) map.set(delivery.id, delivery.status);
    }
    return map;
  }, [server]);

  const serverRows =
    server.status === "ready" ? visibleServerDeliveries(server.deliveries, waiting.rows) : [];

  const retry = async (row: OutboxRow) => {
    setBusyId(row.clientRecordId);
    setActionError(null);
    try {
      await retryDelivery(row.clientRecordId);
    } catch (error: unknown) {
      setActionError(error instanceof Error ? error.message : "Retry failed.");
    } finally {
      setBusyId(null);
    }
  };

  const confirmDiscard = (row: OutboxRow) => {
    Alert.alert("Discard this delivery?", discardConfirmation(row), [
      { text: "Keep it", style: "cancel" },
      {
        text: "Discard",
        style: "destructive",
        onPress: () => {
          setBusyId(row.clientRecordId);
          setActionError(null);
          discardDelivery(row.clientRecordId)
            .catch((error: unknown) =>
              setActionError(error instanceof Error ? error.message : "Could not discard the delivery."),
            )
            .finally(() => setBusyId(null));
        },
      },
    ]);
  };

  return (
    <Screen align="top" title="History" subtitle="Your deliveries, newest first.">
      {actionError ? <Message tone="error">{actionError}</Message> : null}
      {waiting.error ? <Message tone="error">{waiting.error}</Message> : null}

      {waiting.rows.length > 0 ? (
        <View style={reviewStyles.section}>
          <SectionHeading note="Saved here and not on Takalex yet.">On this phone</SectionHeading>
          <ListCard>
            {waiting.rows.map((row) => {
              const status = localRowStatus(
                row,
                row.collectionId ? serverStatusById.get(row.collectionId) : undefined,
              );
              const busy = busyId === row.clientRecordId;
              const failed = row.syncState === "failed";
              return (
                <DeliveryRow
                  key={row.clientRecordId}
                  title={deliveryTitle(names.get(row.materialCode) ?? row.materialCode, row.reportedWeightKg)}
                  detail={`Saved ${friendlyDateTime(row.createdAt, now)}`}
                  badge={failed ? { label: "Upload failed", tone: "red" } : { label: "Waiting to upload", tone: "grey" }}
                >
                  {failed ? <Message tone={status.tone}>{status.text}</Message> : null}
                  {!failed && row.lastError ? <Text style={reviewStyles.meta}>{row.lastError}</Text> : null}
                  {failed ? (
                    <View style={styles.actions}>
                      <SecondaryButton label="Retry" loading={busy} onPress={() => void retry(row)} />
                      <SecondaryButton
                        label="Discard"
                        tone="danger"
                        disabled={busy}
                        onPress={() => confirmDiscard(row)}
                      />
                    </View>
                  ) : null}
                </DeliveryRow>
              );
            })}
          </ListCard>
        </View>
      ) : null}

      <View style={reviewStyles.section}>
        <SectionHeading>Sent to Takalex</SectionHeading>
        {server.status === "loading" ? <Message>Loading your deliveries…</Message> : null}
        {server.status === "error" ? (
          <>
            <Message tone="error">{server.message}</Message>
            <InlineLink label="Try again" onPress={reloadServer} />
          </>
        ) : null}
        {server.status === "ready" && serverRows.length === 0 ? (
          <Message>No deliveries yet.</Message>
        ) : null}
        {serverRows.length > 0 ? (
          <ListCard>
            {serverRows.map((delivery) => (
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
  actions: { flexDirection: "row", gap: 12 },
});
