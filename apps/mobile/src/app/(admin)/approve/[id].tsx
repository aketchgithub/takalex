import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";

import { InvitationCodeCard, type IssuedInvitation } from "@/components/InvitationCodeCard";
import { InviteForm } from "@/components/InviteForm";
import { InlineLink, Message, Screen } from "@/components/Ui";
import { contactLabel, groupLabel, invitePrefill, isOpenRequest, type AccessRequestRow } from "@/lib/admin/model";
import { approveAccessRequest, getAccessRequest } from "@/lib/admin/requests";
import { useAuthStore } from "@/stores/authStore";
import { roleLabels } from "@/types/auth";

// A Stack screen: every open pushes a new instance and Back unmounts it, so
// each visit starts with a fresh read, empty form state and no code left on
// screen. The key also resets the content if the id param changes in place.
export default function ApproveRequestScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  if (!id) return null;
  return <ApproveContent key={id} id={id} />;
}

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; request: AccessRequestRow | null };

function ApproveContent({ id }: { id: string }) {
  const router = useRouter();
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [issued, setIssued] = useState<IssuedInvitation | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const inviteUser = useAuthStore((state) => state.inviteUser);
  // Set once this screen has approved the request (so a retry after a failed
  // invitation does not approve again).
  const approvedHere = useRef(false);

  useEffect(() => {
    let active = true;
    getAccessRequest(id)
      .then((request) => {
        if (active) setLoad({ status: "ready", request });
      })
      .catch((error: unknown) => {
        if (active) setLoad({ status: "error", message: error instanceof Error ? error.message : "Could not load the request." });
      });
    return () => {
      active = false;
    };
  }, [id]);

  // Pop back to Access requests (which reloads on focus). replace() here would
  // put a second copy of the tabs on the Stack.
  const back = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/(admin)/(tabs)/access-requests");
  };

  if (issued) {
    return <InvitationCodeCard brand={false} issued={issued} title="Request approved" onDone={back} />;
  }
  if (load.status === "loading") {
    return (
      <Screen align="top" brand={false}>
        <Message>Loading the request…</Message>
      </Screen>
    );
  }
  if (load.status === "error" || !load.request) {
    return (
      <Screen align="top" brand={false}>
        <Message tone="error">{load.status === "error" ? load.message : "This access request was not found."}</Message>
        <InlineLink label="Back to access requests" onPress={back} />
      </Screen>
    );
  }

  const request = load.request;
  if (!isOpenRequest(request.status)) {
    return (
      <Screen align="top" brand={false}>
        <Message>This request has already been {request.status}.</Message>
        <InlineLink label="Back to access requests" onPress={back} />
      </Screen>
    );
  }

  return (
    <Screen
      align="top"
      brand={false}
      subtitle={`${request.fullName} asked to join as ${roleLabels[request.role].toLowerCase()} (${groupLabel(
        request.role,
        request.siteName,
        request.siteId,
      )}). Contact: ${contactLabel(request.email, request.phone)}. Check the details; every field can be changed.`}
    >
      <InviteForm
        initial={invitePrefill(request)}
        request={{ email: request.email }}
        submitLabel="Approve and create invitation"
        loading={submitting}
        onSubmit={async (values) => {
          setSubmitting(true);
          try {
            // Approve first, as this admin, so the reviewer trigger records
            // them; invite-user then marks the request invited and keeps
            // that reviewer. A request already approved (an earlier attempt
            // whose invitation failed) is not approved again.
            if (request.status !== "approved" && !approvedHere.current) {
              try {
                await approveAccessRequest(request.id);
              } catch (e: unknown) {
                return e instanceof Error ? e.message : "The request could not be approved.";
              }
              approvedHere.current = true;
            }
            const result = await inviteUser(values.email, values.fullName, values.role, values.siteIds, request.id);
            if (!result.ok) {
              return `${result.message} The request is approved; you can try the invitation again.`;
            }
            setIssued({
              code: result.code,
              email: values.email,
              role: values.role,
              expiresAt: result.expiresAt,
              phone: request.phone,
              warning: result.warning,
            });
            return null;
          } finally {
            setSubmitting(false);
          }
        }}
      />
    </Screen>
  );
}
