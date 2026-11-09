import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";

import { InlineLink, Message, Screen, SecondaryButton, uiColors } from "@/components/Ui";
import { cachedMaterialNames } from "@/lib/collectorContext";
import { listMyDeliveries } from "@/lib/deliveries";
import { discardDelivery, retryDelivery, subscribeOutbox, type OutboxRow } from "@/lib/outbox";
import {
  deliveryStatusLabel,
  discardConfirmation,
  formatDateTime,
  formatKg,
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
        if (active) setServer({ status: "ready", deliveries });
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
    <Screen title="My deliveries" subtitle="Deliveries still on this phone are listed first.">
      {actionError ? <Message tone="error">{actionError}</Message> : null}
      {waiting.error ? <Message tone="error">{waiting.error}</Message> : null}

      {waiting.rows.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.heading}>On this phone</Text>
          {waiting.rows.map((row) => {
            const status = localRowStatus(
              row,
              row.collectionId ? serverStatusById.get(row.collectionId) : undefined,
            );
            const busy = busyId === row.clientRecordId;
            return (
              <View key={row.clientRecordId} style={styles.card}>
                <Text style={styles.title}>
                  {names.get(row.materialCode) ?? row.materialCode} · {formatKg(row.reportedWeightKg)}
                </Text>
                <Text style={styles.meta}>Saved {formatDateTime(row.createdAt)}</Text>
                <Message tone={status.tone}>{status.text}</Message>
                {row.syncState === "pending" && row.lastError ? (
                  <Text style={styles.meta}>{row.lastError}</Text>
                ) : null}
                {row.syncState === "failed" ? (
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
              </View>
            );
          })}
        </View>
      ) : null}

      <View style={styles.section}>
        <Text style={styles.heading}>Sent to Takalex</Text>
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
        {serverRows.map((delivery) => (
          <View key={delivery.id} style={styles.card}>
            <Text style={styles.title}>{delivery.materialName ?? delivery.materialCode}</Text>
            <Text style={styles.meta}>Submitted {formatDateTime(delivery.submittedAt)}</Text>
            <Row label="Reported weight" value={formatKg(delivery.reportedWeightKg)} />
            <Row label="Status" value={deliveryStatusLabel(delivery.status, delivery.rejectionReason)} />
            {delivery.status === "approved" && delivery.verifiedWeightKg !== null ? (
              <Row label="Verified total" value={formatKg(delivery.verifiedWeightKg)} />
            ) : null}
          </View>
        ))}
      </View>
    </Screen>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 10 },
  heading: { color: uiColors.text, fontSize: 18, fontWeight: "700" },
  card: {
    backgroundColor: uiColors.white,
    borderColor: uiColors.border,
    borderRadius: 12,
    borderWidth: 1,
    gap: 6,
    padding: 14,
  },
  title: { color: uiColors.text, fontSize: 16, fontWeight: "700" },
  meta: { color: uiColors.muted, fontSize: 13, lineHeight: 18 },
  actions: { flexDirection: "row", gap: 10, marginTop: 4 },
  row: { flexDirection: "row", gap: 12, justifyContent: "space-between" },
  rowLabel: { color: uiColors.muted, fontSize: 14 },
  rowValue: { color: uiColors.text, flexShrink: 1, fontSize: 14, fontWeight: "600", textAlign: "right" },
});
