import { useEffect, useState } from "react";
import { View } from "react-native";

import { Message, PrimaryButton, Screen } from "@/components/Ui";
import { getAccessRequests, updateAccessRequestStatus, type AccessRequestRecord } from "@/lib/access";

export default function AccessRequestsScreen() {
  const [items, setItems] = useState<AccessRequestRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadRequests = async () => {
    setLoading(true);
    const { data, error: loadError } = await getAccessRequests();
    setLoading(false);

    if (loadError) {
      setError(loadError.message);
      setItems([]);
      return;
    }

    setItems((data ?? []) as AccessRequestRecord[]);
    setError(null);
  };

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      void loadRequests();
    }, 0);

    return () => clearTimeout(timeoutId);
  }, []);

  const handleStatus = async (id: string, status: "approved" | "rejected" | "invited") => {
    setBusyId(id);
    const { error: updateError } = await updateAccessRequestStatus(id, status, `Reviewed by admin: ${status}.`);
    setBusyId(null);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    await loadRequests();
  };

  return (
    <Screen
      title="Access requests"
      subtitle="Review public interest and invite the right users into the operational app."
    >
      {error ? <Message tone="error">{error}</Message> : null}
      {loading ? (
        <Message>Loading access requests…</Message>
      ) : items.length === 0 ? (
        <Message>No access requests have been submitted yet.</Message>
      ) : (
        items.map((item) => (
          <View key={item.id} style={{ borderWidth: 1, borderColor: "#d9dfd1", borderRadius: 12, padding: 16, gap: 8 }}>
            <Message>{item.full_name}</Message>
            <Message>{item.status.toUpperCase()}</Message>
            <Message>{item.email ?? "No email"} • {item.phone ?? "No phone"}</Message>
            <Message>Role: {item.role} • Site: {item.site_name ?? "Not provided"}</Message>
            <Message>Referral: {item.referral_source ?? "Not provided"}</Message>
            <Message>Submitted: {new Date(item.created_at).toLocaleString()}</Message>
            {item.notes ? <Message>{item.notes}</Message> : null}
            <PrimaryButton
              label="Approve"
              loading={busyId === item.id}
              onPress={() => void handleStatus(item.id, "approved")}
            />
            <PrimaryButton
              label="Invite"
              loading={busyId === item.id}
              onPress={() => void handleStatus(item.id, "invited")}
            />
            <PrimaryButton
              label="Reject"
              loading={busyId === item.id}
              onPress={() => void handleStatus(item.id, "rejected")}
            />
          </View>
        ))
      )}
    </Screen>
  );
}
