import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";

import { FilterChips } from "@/components/FilterChips";
import { Card, Row, reviewStyles } from "@/components/ReviewUi";
import { REQUEST_TONES, StatusRow } from "@/components/StatusBadge";
import { Field, InlineLink, Message, PrimaryButton, Screen, SecondaryButton, uiColors } from "@/components/Ui";
import {
  REQUEST_FILTERS,
  checkRejectionNote,
  contactLabel,
  filterRequests,
  groupLabel,
  isOpenRequest,
  requestStatusLabel,
  type AccessRequestRow,
  type RequestFilter,
} from "@/lib/admin/model";
import { listAccessRequests, rejectAccessRequest } from "@/lib/admin/requests";
import { formatDateTime } from "@/lib/outbox/presentation";
import { roleLabels } from "@/types/auth";

type ListState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; rows: AccessRequestRow[] };

export default function AccessRequestsScreen() {
  const router = useRouter();
  const [filter, setFilter] = useState<RequestFilter>("submitted");
  const [list, setList] = useState<ListState>({ status: "loading" });
  const [version, setVersion] = useState(0);

  // Reload whenever the tab is shown (e.g. after approving and inviting).
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  useFocusEffect(reload);

  useEffect(() => {
    let active = true;
    listAccessRequests()
      .then((rows) => {
        if (active) setList({ status: "ready", rows });
      })
      .catch((error: unknown) => {
        if (active) setList({ status: "error", message: error instanceof Error ? error.message : "Could not load access requests." });
      });
    return () => {
      active = false;
    };
  }, [version]);

  const rows = list.status === "ready" ? filterRequests(list.rows, filter) : [];

  return (
    <Screen align="top" title="Access requests" subtitle="Newest first. Approve a request to invite the person, or reject it with a note.">
      <FilterChips options={REQUEST_FILTERS} value={filter} onChange={setFilter} />

      {list.status === "loading" ? <Message>Loading access requests…</Message> : null}
      {list.status === "error" ? (
        <>
          <Message tone="error">{list.message}</Message>
          <InlineLink label="Try again" onPress={reload} />
        </>
      ) : null}
      {list.status === "ready" && rows.length === 0 ? <Message>No requests here.</Message> : null}

      {rows.map((request) => (
        <RequestCard
          key={request.id}
          request={request}
          onApprove={() => router.push({ pathname: "/(admin)/approve/[id]", params: { id: request.id } })}
          onChanged={reload}
        />
      ))}

      <InlineLink label="Refresh" onPress={reload} />
    </Screen>
  );
}

// Email and phone on separate lines (contactLabel's wording when neither is set).
function contactLines(email: string | null, phone: string | null): string {
  const lines = [email?.trim(), phone?.trim()].filter((line): line is string => Boolean(line));
  return lines.length ? lines.join("\n") : contactLabel(email, phone);
}

function RequestCard({
  request,
  onApprove,
  onChanged,
}: {
  request: AccessRequestRow;
  onApprove: () => void;
  onChanged: () => void;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const [noteError, setNoteError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = isOpenRequest(request.status);

  const reject = () => {
    const checked = checkRejectionNote(note);
    setNoteError(checked.error);
    if (!checked.note) return;
    const text = checked.note;
    Alert.alert("Reject this request?", `${request.fullName} will not be invited. Note: “${text}”`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Reject",
        style: "destructive",
        onPress: () => {
          setBusy(true);
          setError(null);
          rejectAccessRequest(request.id, text)
            .then(onChanged)
            .catch((e: unknown) => setError(e instanceof Error ? e.message : "Could not reject the request."))
            .finally(() => setBusy(false));
        },
      },
    ]);
  };

  return (
    <Card>
      <Text style={reviewStyles.title}>{request.fullName}</Text>
      <Text style={reviewStyles.meta}>Submitted {formatDateTime(request.createdAt)}</Text>
      <Row label="Contact" stacked value={contactLines(request.email, request.phone)} />
      <Row label="Requested role" value={roleLabels[request.role]} />
      <Row label={request.role === "collector" ? "Group (site)" : "Site"} value={groupLabel(request.role, request.siteName, request.siteId)} />
      <StatusRow label={requestStatusLabel(request.status)} tone={REQUEST_TONES[request.status]} />
      {request.notes ? <Row label="Note" stacked value={request.notes} /> : null}
      {open && !request.email ? (
        <Text style={styles.warning}>No email on this request: you will confirm one with the requester by phone.</Text>
      ) : null}
      {error ? <Message tone="error">{error}</Message> : null}

      {open && !rejecting ? (
        <View style={styles.actions}>
          <PrimaryButton label="Approve and invite" disabled={busy} onPress={onApprove} />
          <SecondaryButton label="Reject" tone="danger" disabled={busy} onPress={() => setRejecting(true)} />
        </View>
      ) : null}

      {open && rejecting ? (
        <View style={styles.actions}>
          <Field
            autoCapitalize="sentences"
            error={noteError ?? undefined}
            label="Note (required)"
            multiline
            onChangeText={(text) => {
              setNote(text);
              if (noteError) setNoteError(null);
            }}
            placeholder="Why is this request rejected?"
            value={note}
          />
          <SecondaryButton label="Reject request" tone="danger" loading={busy} onPress={reject} />
          <InlineLink
            label="Cancel"
            onPress={() => {
              setRejecting(false);
              setNoteError(null);
            }}
          />
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  actions: { gap: 12, marginTop: 8 },
  warning: { color: uiColors.danger, fontSize: 13, lineHeight: 18 },
});
