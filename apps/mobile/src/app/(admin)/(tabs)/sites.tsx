import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text } from "react-native";

import { Card, reviewStyles } from "@/components/ReviewUi";
import { InlineLink, Message, Screen, uiStyles } from "@/components/Ui";
import { getActiveSites, type SiteOption } from "@/lib/sites";

type ListState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; sites: SiteOption[] };

// Read-only: admins can read every site (sites_read_assigned allows
// is_active_admin()).
export default function SitesScreen() {
  const [list, setList] = useState<ListState>({ status: "loading" });
  const [version, setVersion] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  useFocusEffect(reload);

  useEffect(() => {
    let active = true;
    getActiveSites()
      .then((sites) => {
        if (active) setList({ status: "ready", sites });
      })
      .catch((error: unknown) => {
        if (active) setList({ status: "error", message: error instanceof Error ? error.message : "Could not load sites." });
      })
      .finally(() => {
        if (active) setRefreshing(false);
      });
    return () => {
      active = false;
    };
  }, [version]);

  const refresh = () => {
    setRefreshing(true);
    reload();
  };

  return (
    <Screen
      align="top"
      title="Site management"
      subtitle="Active collection sites."
      refreshing={refreshing}
      onRefresh={refresh}
    >
      {list.status === "loading" ? <Message>Loading sites…</Message> : null}
      {list.status === "error" ? (
        <>
          <Message tone="error">{list.message}</Message>
          <InlineLink label="Try again" onPress={reload} />
        </>
      ) : null}
      {list.status === "ready" && list.sites.length === 0 ? <Message>No active sites.</Message> : null}

      {list.status === "ready" && list.sites.length > 0 ? (
        <Text style={styles.count}>
          {list.sites.length} active {list.sites.length === 1 ? "site" : "sites"}
        </Text>
      ) : null}
      {list.status === "ready"
        ? list.sites.map((site) => (
            <Card key={site.id}>
              <Text style={reviewStyles.title}>{site.name}</Text>
            </Card>
          ))
        : null}

      <Text style={uiStyles.meta}>Adding and editing sites is not available in the app yet.</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  count: uiStyles.fieldLabel,
});
