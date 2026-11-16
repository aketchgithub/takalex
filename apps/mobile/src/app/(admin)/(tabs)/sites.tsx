import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";

import { Card, reviewStyles } from "@/components/ReviewUi";
import { Field, InlineLink, Message, PrimaryButton, Screen, SecondaryButton, uiColors, uiStyles } from "@/components/Ui";
import {
  deactivateConfirmation,
  isRename,
  normaliseSiteName,
  reactivateConfirmation,
  siteNameError,
  type AdminSite,
} from "@/lib/admin/siteModel";
import { createSite, listAllSites, updateSite } from "@/lib/admin/sites";

type ListState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; sites: AdminSite[] };

// Every site, active first. Adding, renaming, deactivating and reactivating
// go through admin_create_site() / admin_update_site() (migration 009), which
// also record who changed what in site_events.
export default function SitesScreen() {
  const [list, setList] = useState<ListState>({ status: "loading" });
  const [version, setVersion] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  useFocusEffect(reload);

  useEffect(() => {
    let active = true;
    listAllSites()
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

  const sites = list.status === "ready" ? list.sites : [];
  const activeCount = sites.filter((site) => site.active).length;
  const inactiveCount = sites.length - activeCount;

  return (
    <Screen align="top" title="Site management" subtitle="Collection sites and their groups." refreshing={refreshing} onRefresh={refresh}>
      {list.status === "ready" ? <AddSiteForm sites={sites} onAdded={reload} /> : null}

      {list.status === "loading" ? <Message>Loading sites…</Message> : null}
      {list.status === "error" ? (
        <>
          <Message tone="error">{list.message}</Message>
          <InlineLink label="Try again" onPress={reload} />
        </>
      ) : null}
      {list.status === "ready" && sites.length === 0 ? <Message>No sites yet.</Message> : null}

      {list.status === "ready" && sites.length > 0 ? (
        <Text style={styles.count}>
          {activeCount} active {activeCount === 1 ? "site" : "sites"}
          {inactiveCount > 0 ? `, ${inactiveCount} inactive` : ""}
        </Text>
      ) : null}
      {sites.map((site) => (
        <SiteCard key={site.id} site={site} sites={sites} onChanged={reload} />
      ))}
    </Screen>
  );
}

function AddSiteForm({ sites, onAdded }: { sites: AdminSite[]; onAdded: () => void }) {
  const [name, setName] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const problem = siteNameError(name, sites);
    setFieldError(problem);
    setError(null);
    setAdded(null);
    if (problem) return;

    const clean = normaliseSiteName(name);
    setSaving(true);
    const failure = await createSite(clean);
    setSaving(false);
    if (failure) {
      setError(failure);
      return;
    }
    setName("");
    setAdded(`${clean} was added. Its group is “${clean} group”.`);
    onAdded();
  };

  return (
    <View style={styles.card}>
      <Text style={reviewStyles.title}>Add a site</Text>
      <Field
        autoCapitalize="words"
        autoCorrect={false}
        error={fieldError ?? undefined}
        label="Site name"
        onChangeText={(value) => {
          setName(value);
          setFieldError(null);
          setAdded(null);
        }}
        placeholder="e.g. Dandora"
        value={name}
      />
      {error ? <Message tone="error">{error}</Message> : null}
      {added ? <Message tone="success">{added}</Message> : null}
      <PrimaryButton label="Add site" loading={saving} loadingLabel="Adding…" onPress={() => void submit()} />
    </View>
  );
}

function SiteCard({ site, sites, onChanged }: { site: AdminSite; sites: AdminSite[]; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(site.name);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"rename" | "status" | null>(null);

  const startEditing = () => {
    setName(site.name);
    setFieldError(null);
    setError(null);
    setEditing(true);
  };

  const saveName = async () => {
    if (!isRename(site, name)) {
      setEditing(false);
      return;
    }
    const problem = siteNameError(name, sites, site.id);
    setFieldError(problem);
    setError(null);
    if (problem) return;

    setBusy("rename");
    const failure = await updateSite(site.id, normaliseSiteName(name), site.active);
    setBusy(null);
    if (failure) {
      setError(failure);
      return;
    }
    setEditing(false);
    onChanged();
  };

  const changeStatus = () => {
    const next = !site.active;
    Alert.alert(
      next ? `Reactivate ${site.name}?` : `Deactivate ${site.name}?`,
      next ? reactivateConfirmation(site.name) : deactivateConfirmation(site.name),
      [
        { text: "Cancel", style: "cancel" },
        {
          text: next ? "Reactivate" : "Deactivate",
          style: next ? "default" : "destructive",
          onPress: () => {
            setBusy("status");
            setError(null);
            void updateSite(site.id, site.name, next).then((failure) => {
              setBusy(null);
              if (failure) setError(failure);
              else onChanged();
            });
          },
        },
      ],
    );
  };

  return (
    <Card>
      {editing ? (
        <>
          <Field
            autoCapitalize="words"
            autoCorrect={false}
            autoFocus
            error={fieldError ?? undefined}
            label="New name"
            onChangeText={(value) => {
              setName(value);
              setFieldError(null);
            }}
            value={name}
          />
          <Text style={reviewStyles.meta}>Collectors at this site will see their group as “{normaliseSiteName(name) || "…"} group”.</Text>
        </>
      ) : (
        <View style={styles.titleRow}>
          <Text style={[reviewStyles.title, styles.name, site.active ? null : styles.inactiveName]}>{site.name}</Text>
          {site.active ? null : <Text style={styles.badge}>Inactive</Text>}
        </View>
      )}

      {error ? <Message tone="error">{error}</Message> : null}

      <View style={styles.actions}>
        {editing ? (
          <>
            <SecondaryButton label="Save name" loading={busy === "rename"} onPress={() => void saveName()} />
            <SecondaryButton label="Cancel" disabled={busy !== null} onPress={() => setEditing(false)} />
          </>
        ) : (
          <>
            <SecondaryButton label="Rename" disabled={busy !== null} onPress={startEditing} />
            <SecondaryButton
              label={site.active ? "Deactivate" : "Reactivate"}
              loading={busy === "status"}
              disabled={busy !== null}
              onPress={changeStatus}
              tone={site.active ? "danger" : "default"}
            />
          </>
        )}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: uiStyles.card,
  count: uiStyles.fieldLabel,
  titleRow: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: 8 },
  name: { flexShrink: 1 },
  inactiveName: { color: uiColors.muted },
  badge: {
    borderColor: uiColors.border,
    borderRadius: 10,
    borderWidth: 1,
    color: uiColors.muted,
    fontSize: 13,
    fontWeight: "600",
    overflow: "hidden",
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
});
