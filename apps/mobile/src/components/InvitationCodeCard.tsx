import { useState } from "react";
import { Share, StyleSheet, Text, View } from "react-native";

import { InlineLink, Message, PrimaryButton, Screen, uiColors } from "@/components/Ui";
import { formatExpiry, inviteShareMessage } from "@/lib/admin/model";
import { roleLabels, type InviteRole } from "@/types/auth";

// A just-issued invitation code. Lives only in the parent screen's state;
// the parent drops it when dismissed or when the screen loses focus. It is
// never written to the auth store or to storage.
export type IssuedInvitation = {
  code: string;
  email: string;
  role: InviteRole;
  expiresAt: string | null;
  // The requester's phone, when the invitation answers an access request.
  phone?: string | null;
  warning?: string | null;
};

export function InvitationCodeCard({
  issued,
  title = "Invitation created",
  onDone,
}: {
  issued: IssuedInvitation;
  title?: string;
  onDone: () => void;
}) {
  const [shareError, setShareError] = useState<string | null>(null);

  async function share() {
    setShareError(null);
    try {
      await Share.share({
        message: inviteShareMessage({
          roleLabel: roleLabels[issued.role],
          email: issued.email,
          code: issued.code,
          expiresAt: issued.expiresAt,
        }),
      });
    } catch {
      setShareError("Could not open the share sheet. Copy the code from this screen instead.");
    }
  }

  return (
    <Screen title={title} subtitle={`For ${issued.email} (${roleLabels[issued.role]}).`}>
      <View style={styles.codeCard}>
        <Text style={styles.codeLabel}>Invitation code</Text>
        <Text selectable style={styles.code}>{issued.code}</Text>
        <Text style={styles.codeMeta}>Expires {formatExpiry(issued.expiresAt)}.</Text>
      </View>
      <Message tone="error">
        This code is shown only once. Share it with the invitee now. It cannot
        be shown again; if it is lost, the invitation must be revoked and
        reissued.
      </Message>
      {issued.phone ? (
        <Message>
          Send it by WhatsApp or SMS to the requester&apos;s phone ({issued.phone}): that is the expected channel.
        </Message>
      ) : (
        <Message>WhatsApp or SMS to the person&apos;s phone is the expected channel.</Message>
      )}
      {issued.warning ? <Message tone="error">{issued.warning}</Message> : null}
      {shareError ? <Message tone="error">{shareError}</Message> : null}
      <PrimaryButton label="Share code" onPress={() => void share()} />
      <InlineLink label="Done, hide the code" onPress={onDone} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  codeCard: {
    alignItems: "center",
    backgroundColor: uiColors.white,
    borderColor: uiColors.primary,
    borderRadius: 14,
    borderWidth: 2,
    gap: 8,
    padding: 20,
  },
  codeLabel: { color: uiColors.muted, fontSize: 13, fontWeight: "600" },
  code: {
    color: uiColors.text,
    fontFamily: "monospace",
    fontSize: 28,
    fontWeight: "800",
    letterSpacing: 2,
  },
  codeMeta: { color: uiColors.muted, fontSize: 13 },
});
