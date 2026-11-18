import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";

import { AddToggle, ExpandableRow } from "@/components/AdminList";
import { ListCard } from "@/components/DeliveryList";
import { SectionHeading, reviewStyles } from "@/components/ReviewUi";
import { Field, InlineLink, Message, PrimaryButton, Screen, SecondaryButton } from "@/components/Ui";
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
  const [adding, setAdding] = useState(false);
  // One site open at a time.
  const [openId, setOpenId] = useState<string | null>(null);

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
    <Screen
      align="top"
      title="Sites"
      subtitle="Each site's collectors form a group with the site's name. Tap a site to rename or deactivate it."
      refreshing={refreshing}
      onRefresh={refresh}
    >
      {list.status === "ready" ? (
        <AddToggle label="Add a site" open={adding} onToggle={() => setAdding((v) => !v)}>
          <AddSiteForm sites={sites} onAdded={reload} />
        </AddToggle>
      ) : null}

      {list.status === "loading" ? <Message>Loading sites…</Message> : null}
      {list.status === "error" ? (
        <>
          <Message tone="error">{list.message}</Message>
          <InlineLink label="Try again" onPress={reload} />
        </>
      ) : null}
      {list.status === "ready" && sites.length === 0 ? <Message>No sites yet.</Message> : null}

      {list.status === "ready" && sites.length > 0 ? (
        <View style={reviewStyles.section}>
          <SectionHeading>
            {`${activeCount} active ${activeCount === 1 ? "site" : "sites"}${inactiveCount > 0 ? `, ${inactiveCount} inactive` : ""}`}
          </SectionHeading>
          <ListCard>
            {sites.map((site) => (
              <SiteRow
                key={site.id}
                site={site}
                sites={sites}
                expanded={openId === site.id}
                onToggle={() => setOpenId((current) => (current === site.id ? null : site.id))}
                onChanged={reload}
              />
            ))}
          </ListCard>
        </View>
      ) : null}
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
    <>
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
    </>
  );
}

function SiteRow({
  site,
  sites,
  expanded,
  onToggle,
  onChanged,
}: {
  site: AdminSite;
  sites: AdminSite[];
  expanded: boolean;
  onToggle: () => void;
  onChanged: () => void;
}) {
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
    <ExpandableRow
      icon="map-pin"
      title={site.name}
      detail={`${site.name} group`}
      badge={site.active ? undefined : { label: "Inactive", tone: "grey" }}
      dimmed={!site.active}
      expanded={expanded}
      onToggle={() => {
        setEditing(false);
        setError(null);
        onToggle();
      }}
    >
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
      ) : null}

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
    </ExpandableRow>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
});
