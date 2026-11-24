import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Linking, StyleSheet, Text, View } from "react-native";

import { AddToggle, ExpandableRow } from "@/components/AdminList";
import { ListCard } from "@/components/DeliveryList";
import { SectionHeading } from "@/components/ReviewUi";
import { Field, InlineLink, Message, PrimaryButton, Screen, SecondaryButton, useUiStyles } from "@/components/Ui";
import { currentPosition } from "@/lib/admin/currentPosition";
import {
  LOCATION_HINT,
  REMOVE_LOCATION_CONFIRMATION,
  formatCoordinates,
  hasLocation,
  mapsUrl,
  parseCoordinates,
  sameCoordinates,
} from "@/lib/admin/siteLocation";
import {
  deactivateConfirmation,
  isRename,
  normaliseSiteName,
  reactivateConfirmation,
  siteNameError,
  type AdminSite,
} from "@/lib/admin/siteModel";
import { createSite, listAllSites, setSiteLocation, updateSite } from "@/lib/admin/sites";
import { confirmAction } from "@/lib/dialogs";

type ListState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; sites: AdminSite[] };

// Every site, active first. Adding, renaming, deactivating and reactivating
// go through admin_create_site() / admin_update_site() (migration 009), and
// setting a location through admin_set_site_location() (012); all of them
// record who changed what in site_events.
export default function SitesScreen() {
  const ui = useUiStyles();
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
        <View style={ui.section}>
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
  const ui = useUiStyles();
  // What the open row is showing: its actions, the rename form or the location form.
  const [mode, setMode] = useState<"actions" | "rename" | "location">("actions");
  const editing = mode === "rename";
  const setEditing = (on: boolean) => setMode(on ? "rename" : "actions");
  const [name, setName] = useState(site.name);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"rename" | "status" | "location" | null>(null);
  const located = hasLocation(site) ? { latitude: site.latitude, longitude: site.longitude } : null;

  const startEditing = () => {
    setName(site.name);
    setFieldError(null);
    setError(null);
    setEditing(true);
  };

  const removeLocation = () => {
    void confirmAction({
      title: `Remove ${site.name}'s location?`,
      message: REMOVE_LOCATION_CONFIRMATION,
      confirmLabel: "Remove",
      destructive: true,
    }).then((ok) => {
      if (!ok) return;
      setBusy("location");
      setError(null);
      void setSiteLocation(site.id, null).then((failure) => {
        setBusy(null);
        if (failure) setError(failure);
        else onChanged();
      });
    });
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
    void confirmAction({
      title: next ? `Reactivate ${site.name}?` : `Deactivate ${site.name}?`,
      message: next ? reactivateConfirmation(site.name) : deactivateConfirmation(site.name),
      confirmLabel: next ? "Reactivate" : "Deactivate",
      destructive: !next,
    }).then((ok) => {
      if (!ok) return;
      setBusy("status");
      setError(null);
      void updateSite(site.id, site.name, next).then((failure) => {
        setBusy(null);
        if (failure) setError(failure);
        else onChanged();
      });
    });
  };

  return (
    <ExpandableRow
      icon="map-pin"
      title={site.name}
      detail={`${site.name} group · ${located ? formatCoordinates(located) : "no location yet"}`}
      badge={site.active ? undefined : { label: "Inactive", tone: "grey" }}
      dimmed={!site.active}
      expanded={expanded}
      onToggle={() => {
        setMode("actions");
        setError(null);
        onToggle();
      }}
    >
      {mode === "location" ? (
        <LocationForm
          site={site}
          current={located}
          onCancel={() => setMode("actions")}
          onSaved={() => {
            setMode("actions");
            onChanged();
          }}
        />
      ) : null}

      {mode === "actions" ? (
        located ? (
          <View style={styles.locationLine}>
            <Text style={ui.meta}>Location: {formatCoordinates(located)}</Text>
            <InlineLink label="Open in Maps" onPress={() => void Linking.openURL(mapsUrl(located))} />
          </View>
        ) : (
          <Text style={ui.meta}>No location yet. Set one so this site can appear on the map.</Text>
        )
      ) : null}

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
          <Text style={ui.meta}>Collectors at this site will see their group as “{normaliseSiteName(name) || "…"} group”.</Text>
        </>
      ) : null}

      {error ? <Message tone="error">{error}</Message> : null}

      {mode === "location" ? null : (
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
                label={located ? "Change location" : "Set location"}
                disabled={busy !== null}
                onPress={() => {
                  setError(null);
                  setMode("location");
                }}
              />
              {located ? (
                <SecondaryButton
                  label="Remove location"
                  loading={busy === "location"}
                  disabled={busy !== null}
                  onPress={removeLocation}
                  tone="danger"
                />
              ) : null}
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
      )}
    </ExpandableRow>
  );
}

// Type or paste "latitude, longitude", or fill it from the phone's GPS while
// standing at the site, then save.
function LocationForm({
  site,
  current,
  onCancel,
  onSaved,
}: {
  site: AdminSite;
  current: { latitude: number; longitude: number } | null;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const ui = useUiStyles();
  const [text, setText] = useState(current ? `${current.latitude}, ${current.longitude}` : "");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [saving, setSaving] = useState(false);

  const fillFromPhone = async () => {
    setLocating(true);
    setFieldError(null);
    setError(null);
    setNote(null);
    const result = await currentPosition();
    setLocating(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    const lat = Math.round(result.latitude * 1e6) / 1e6;
    const lng = Math.round(result.longitude * 1e6) / 1e6;
    setText(`${lat}, ${lng}`);
    setNote(
      result.accuracyM !== null
        ? `From this phone, accurate to about ${Math.round(result.accuracyM)} m. Check it with Open in Maps after saving.`
        : "From this phone. Check it with Open in Maps after saving.",
    );
  };

  const save = async () => {
    const parsed = parseCoordinates(text);
    if ("error" in parsed) {
      setFieldError(parsed.error);
      return;
    }
    if (current && sameCoordinates(parsed, current)) {
      onCancel();
      return;
    }
    setSaving(true);
    setError(null);
    const failure = await setSiteLocation(site.id, parsed);
    setSaving(false);
    if (failure) setError(failure);
    else onSaved();
  };

  return (
    <>
      <Field
        autoCorrect={false}
        error={fieldError ?? undefined}
        keyboardType="numbers-and-punctuation"
        label="Latitude, longitude"
        onChangeText={(value) => {
          setText(value);
          setFieldError(null);
          setNote(null);
        }}
        placeholder="-1.2667, 36.8833"
        value={text}
      />
      <Text style={ui.meta}>{LOCATION_HINT}. You can paste a point copied from Google Maps.</Text>
      <SecondaryButton
        label={locating ? "Getting your location…" : "Use my current location"}
        loading={locating}
        disabled={saving}
        onPress={() => void fillFromPhone()}
      />
      {note ? <Message tone="success">{note}</Message> : null}
      {error ? <Message tone="error">{error}</Message> : null}
      <View style={styles.actions}>
        <PrimaryButton label="Save location" loading={saving} disabled={locating} onPress={() => void save()} />
        <SecondaryButton label="Cancel" disabled={saving} onPress={onCancel} />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  locationLine: { gap: 2 },
});
