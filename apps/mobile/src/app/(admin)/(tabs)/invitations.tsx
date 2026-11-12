import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";

import { FilterChips } from "@/components/FilterChips";
import { InvitationCodeCard, type IssuedInvitation } from "@/components/InvitationCodeCard";
import { Card, Row, reviewStyles } from "@/components/ReviewUi";
import { INVITATION_TONES, StatusRow } from "@/components/StatusBadge";
import { InlineLink, Message, Screen, SecondaryButton } from "@/components/Ui";
import { listInvitations, reissueInvitation, revokeInvitation, type InvitationRow } from "@/lib/admin/invitations";
import {
  INVITATION_FILTERS,
  INVITATION_STATUS_LABELS,
  MAX_FAILED_ATTEMPTS,
  invitationActions,
  invitationDisplayStatus,
  type InvitationFilter,
} from "@/lib/admin/model";
import { formatDateTime } from "@/lib/outbox/presentation";
import { roleLabels } from "@/types/auth";

type ListState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; rows: InvitationRow[]; loadedAt: Date };

export default function InvitationsScreen() {
  const [filter, setFilter] = useState<InvitationFilter>("pending");
  const [list, setList] = useState<ListState>({ status: "loading" });
  const [version, setVersion] = useState(0);
  const [issued, setIssued] = useState<IssuedInvitation | null>(null);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  // Reload on focus; leaving the tab drops a reissued code from memory.
  useFocusEffect(
    useCallback(() => {
      reload();
      return () => setIssued(null);
    }, [reload]),
  );

  useEffect(() => {
    let active = true;
    listInvitations()
      .then((rows) => {
        if (active) setList({ status: "ready", rows, loadedAt: new Date() });
      })
      .catch((error: unknown) => {
        if (active) setList({ status: "error", message: error instanceof Error ? error.message : "Could not load invitations." });
      });
    return () => {
      active = false;
    };
  }, [version]);

  if (issued) {
    return (
      <InvitationCodeCard
        issued={issued}
        title="Invitation reissued"
        onDone={() => {
          setIssued(null);
          reload();
        }}
      />
    );
  }

  const rows =
    list.status === "ready"
      ? list.rows
          .map((row) => ({ row, display: invitationDisplayStatus(row.status, row.expiresAt, list.loadedAt) }))
          .filter(({ display }) => filter === "all" || display === filter)
      : [];

  return (
    <Screen align="top" title="Invitations" subtitle="Expiry is checked against the current time. Codes are never shown again here.">
      <FilterChips options={INVITATION_FILTERS} value={filter} onChange={setFilter} />
      {list.status === "loading" ? <Message>Loading invitations…</Message> : null}
      {list.status === "error" ? (
        <>
          <Message tone="error">{list.message}</Message>
          <InlineLink label="Try again" onPress={reload} />
        </>
      ) : null}
      {list.status === "ready" && rows.length === 0 ? <Message>No invitations here.</Message> : null}

      {rows.map(({ row, display }) => (
        <InvitationCard key={row.id} row={row} display={display} onChanged={reload} onIssued={setIssued} />
      ))}

      <InlineLink label="Refresh" onPress={reload} />
    </Screen>
  );
}

function InvitationCard({
  row,
  display,
  onChanged,
  onIssued,
}: {
  row: InvitationRow;
  display: ReturnType<typeof invitationDisplayStatus>;
  onChanged: () => void;
  onIssued: (issued: IssuedInvitation) => void;
}) {
  const [busy, setBusy] = useState<"revoke" | "reissue" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const actions = invitationActions(display);
  const name = row.fullName ?? row.email;

  const revoke = () => {
    Alert.alert("Revoke this invitation?", `The code sent to ${row.email} will stop working. You can reissue it later.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Revoke",
        style: "destructive",
        onPress: () => {
          setBusy("revoke");
          setError(null);
          void revokeInvitation(row.id).then((failure) => {
            setBusy(null);
            if (failure) setError(failure);
            else onChanged();
          });
        },
      },
    ]);
  };

  const reissue = () => {
    Alert.alert(
      "Reissue this invitation?",
      `A new code will be created for ${row.email}, valid for 7 days, and shown once. The old code stays invalid.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Reissue",
          onPress: () => {
            setBusy("reissue");
            setError(null);
            void reissueInvitation(row.id).then((result) => {
              setBusy(null);
              if (!result.ok) setError(result.message);
              else onIssued({ code: result.issued.code, email: row.email, role: row.role, expiresAt: result.issued.expiresAt });
            });
          },
        },
      ],
    );
  };

  return (
    <Card>
      <Text style={reviewStyles.title}>{name}</Text>
      {row.fullName ? <Text style={reviewStyles.meta}>{row.email}</Text> : null}
      <Row label="Role" value={roleLabels[row.role]} />
      <StatusRow label={INVITATION_STATUS_LABELS[display]} tone={INVITATION_TONES[display]} />
      <Row label="Created" value={formatDateTime(row.createdAt)} />
      {display === "pending" || display === "expired" ? (
        <Row label={display === "expired" ? "Expired" : "Expires"} value={formatDateTime(row.expiresAt)} />
      ) : null}
      {row.acceptedAt ? <Row label="Accepted" value={formatDateTime(row.acceptedAt)} /> : null}
      {row.revokedAt ? <Row label="Revoked" value={formatDateTime(row.revokedAt)} /> : null}
      {display === "pending" && row.failedAttempts >= MAX_FAILED_ATTEMPTS ? (
        <Message tone="error">Locked after {MAX_FAILED_ATTEMPTS} wrong codes. Revoke it, then reissue.</Message>
      ) : null}
      {error ? <Message tone="error">{error}</Message> : null}
      {actions.revoke || actions.reissue ? (
        <View style={styles.actions}>
          {actions.revoke ? (
            <SecondaryButton label="Revoke" tone="danger" loading={busy === "revoke"} disabled={busy !== null} onPress={revoke} />
          ) : null}
          {actions.reissue ? (
            <SecondaryButton label="Reissue" loading={busy === "reissue"} disabled={busy !== null} onPress={reissue} />
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: "row", gap: 12, marginTop: 8 },
});
