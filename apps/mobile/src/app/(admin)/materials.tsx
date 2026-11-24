import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { StyleSheet, Switch, Text, View } from "react-native";

import { AddToggle, ExpandableRow, IconButton } from "@/components/AdminList";
import { ListCard } from "@/components/DeliveryList";

import {
  deactivateMaterialConfirmation,
  deleteMaterialConfirmation,
  isMaterialEdited,
  materialNameError,
  materialRolesError,
  MIXED_CODE,
  normaliseMaterialName,
  reactivateMaterialConfirmation,
  rolesSummary,
  withRole,
  type AdminMaterial,
  type MaterialRoles,
} from "@/lib/admin/materialModel";
import { Field, InlineLink, Message, PrimaryButton, Screen, SecondaryButton, useUiStyles } from "@/components/Ui";
import { createMaterial, deleteMaterial, listAllMaterials, moveMaterial, updateMaterial } from "@/lib/admin/materials";
import { confirmAction } from "@/lib/dialogs";
import type { Palette } from "@/theme/tokens";
import { useColors, useThemedStyles } from "@/theme/useTheme";

type ListState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; materials: AdminMaterial[] };

const NEW_ROLES: MaterialRoles = { isReportable: true, isVerifiable: true, isRecyclerVisible: true };

// The material list every role uses, in the order every screen shows it.
// All changes go through migration 010's admin_*_material functions, which
// also record who changed what in material_events.
export default function MaterialsScreen() {
  const [list, setList] = useState<ListState>({ status: "loading" });
  const [version, setVersion] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [adding, setAdding] = useState(false);
  // One material open at a time.
  const [openCode, setOpenCode] = useState<string | null>(null);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  useFocusEffect(reload);

  useEffect(() => {
    let active = true;
    listAllMaterials()
      .then((materials) => {
        if (active) setList({ status: "ready", materials });
      })
      .catch((error: unknown) => {
        if (active) setList({ status: "error", message: error instanceof Error ? error.message : "Could not load materials." });
      })
      .finally(() => {
        if (active) setRefreshing(false);
      });
    return () => {
      active = false;
    };
  }, [version]);

  const materials = list.status === "ready" ? list.materials : [];

  return (
    <Screen
      align="top"
      brand={false}
      subtitle="In the order every screen shows them. Use the arrows to reorder; tap a material to edit, deactivate or delete it. A material used in deliveries can only be deactivated."
      refreshing={refreshing}
      onRefresh={() => {
        setRefreshing(true);
        reload();
      }}
    >
      {list.status === "ready" ? (
        <AddToggle label="Add a material" open={adding} onToggle={() => setAdding((v) => !v)}>
          <AddMaterialForm materials={materials} onAdded={reload} />
        </AddToggle>
      ) : null}

      {list.status === "loading" ? <Message>Loading materials…</Message> : null}
      {list.status === "error" ? (
        <>
          <Message tone="error">{list.message}</Message>
          <InlineLink label="Try again" onPress={reload} />
        </>
      ) : null}

      {materials.length > 0 ? (
        <ListCard>
          {materials.map((material, index) => (
            <MaterialRow
              key={material.code}
              material={material}
              materials={materials}
              isFirst={index === 0}
              isLast={index === materials.length - 1}
              expanded={openCode === material.code}
              onToggle={() => setOpenCode((current) => (current === material.code ? null : material.code))}
              onChanged={reload}
            />
          ))}
        </ListCard>
      ) : null}
    </Screen>
  );
}

function RoleSwitches({
  roles,
  code,
  onChange,
}: {
  roles: MaterialRoles;
  code?: string;
  onChange: (roles: MaterialRoles) => void;
}) {
  const c = useColors();
  const ui = useUiStyles();
  const styles = useThemedStyles(makeStyles);
  const mixed = code === MIXED_CODE;
  const rows: { key: keyof MaterialRoles; label: string; locked: boolean }[] = [
    { key: "isReportable", label: "Collectors can report it", locked: false },
    { key: "isVerifiable", label: "Managers can use it when sorting", locked: mixed },
    { key: "isRecyclerVisible", label: "Recyclers see it", locked: mixed },
  ];
  return (
    <View style={styles.switches}>
      {rows.map((row) => (
        <View key={row.key} style={styles.switchRow}>
          <Text style={[styles.switchLabel, row.locked ? styles.locked : null]}>{row.label}</Text>
          <Switch
            accessibilityLabel={row.label}
            disabled={row.locked}
            onValueChange={(on) => onChange(withRole(roles, row.key, on))}
            thumbColor={c.white}
            trackColor={{ false: c.inputBorder, true: c.primary }}
            value={roles[row.key]}
          />
        </View>
      ))}
      {mixed ? <Text style={ui.meta}>Mixed is only for unsorted deliveries reported by collectors.</Text> : null}
    </View>
  );
}

function AddMaterialForm({ materials, onAdded }: { materials: AdminMaterial[]; onAdded: () => void }) {
  const [name, setName] = useState("");
  const [roles, setRoles] = useState<MaterialRoles>(NEW_ROLES);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const problem = materialNameError(name, materials);
    setFieldError(problem);
    setError(null);
    setAdded(null);
    if (problem) return;
    const rolesProblem = materialRolesError(roles);
    if (rolesProblem) {
      setError(rolesProblem);
      return;
    }

    const clean = normaliseMaterialName(name);
    setSaving(true);
    const failure = await createMaterial(clean, roles);
    setSaving(false);
    if (failure) {
      setError(failure);
      return;
    }
    setName("");
    setRoles(NEW_ROLES);
    setAdded(`${clean} was added at the end of the list.`);
    onAdded();
  };

  return (
    <>
      <Field
        autoCapitalize="words"
        autoCorrect={false}
        error={fieldError ?? undefined}
        label="Material name"
        onChangeText={(value) => {
          setName(value);
          setFieldError(null);
          setAdded(null);
        }}
        placeholder="e.g. PVC"
        value={name}
      />
      <RoleSwitches roles={roles} onChange={setRoles} />
      {error ? <Message tone="error">{error}</Message> : null}
      {added ? <Message tone="success">{added}</Message> : null}
      <PrimaryButton label="Add material" loading={saving} loadingLabel="Adding…" onPress={() => void submit()} />
    </>
  );
}

function MaterialRow({
  material,
  materials,
  isFirst,
  isLast,
  expanded,
  onToggle,
  onChanged,
}: {
  material: AdminMaterial;
  materials: AdminMaterial[];
  isFirst: boolean;
  isLast: boolean;
  expanded: boolean;
  onToggle: () => void;
  onChanged: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const current: MaterialRoles = {
    isReportable: material.isReportable,
    isVerifiable: material.isVerifiable,
    isRecyclerVisible: material.isRecyclerVisible,
  };
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(material.displayName);
  const [roles, setRoles] = useState<MaterialRoles>(current);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "status" | "up" | "down" | "delete" | null>(null);

  const run = async (kind: NonNullable<typeof busy>, action: () => Promise<string | null>, after?: () => void) => {
    setBusy(kind);
    setError(null);
    const failure = await action();
    setBusy(null);
    if (failure) {
      setError(failure);
      return;
    }
    after?.();
    onChanged();
  };

  const startEditing = () => {
    setName(material.displayName);
    setRoles(current);
    setFieldError(null);
    setError(null);
    setEditing(true);
  };

  const save = () => {
    if (!isMaterialEdited(material, name, roles)) {
      setEditing(false);
      return;
    }
    const problem = materialNameError(name, materials, material.code);
    setFieldError(problem);
    if (problem) return;
    const rolesProblem = materialRolesError(roles, material.code);
    if (rolesProblem) {
      setError(rolesProblem);
      return;
    }
    void run("save", () => updateMaterial(material.code, normaliseMaterialName(name), roles, material.isActive), () =>
      setEditing(false),
    );
  };

  const changeStatus = () => {
    const next = !material.isActive;
    void confirmAction({
      title: next ? `Reactivate ${material.displayName}?` : `Deactivate ${material.displayName}?`,
      message: next
        ? reactivateMaterialConfirmation(material.displayName)
        : deactivateMaterialConfirmation(material.displayName),
      confirmLabel: next ? "Reactivate" : "Deactivate",
      destructive: !next,
    }).then((ok) => {
      if (ok) void run("status", () => updateMaterial(material.code, material.displayName, current, next));
    });
  };

  const remove = () => {
    void confirmAction({
      title: `Delete ${material.displayName}?`,
      message: deleteMaterialConfirmation(material.displayName),
      confirmLabel: "Delete",
      destructive: true,
    }).then((ok) => {
      if (ok) void run("delete", () => deleteMaterial(material.code));
    });
  };

  const locked = busy !== null;

  return (
    <ExpandableRow
      title={material.displayName}
      detail={`${rolesSummary(current)} · code ${material.code}`}
      badge={material.isActive ? undefined : { label: "Inactive", tone: "grey" }}
      dimmed={!material.isActive}
      expanded={expanded}
      onToggle={() => {
        setEditing(false);
        setError(null);
        onToggle();
      }}
      trailing={
        <View style={styles.move}>
          <IconButton
            icon="arrow-up"
            label={`Move ${material.displayName} up`}
            disabled={locked || isFirst}
            onPress={() => void run("up", () => moveMaterial(material.code, "up"))}
          />
          <IconButton
            icon="arrow-down"
            label={`Move ${material.displayName} down`}
            disabled={locked || isLast}
            onPress={() => void run("down", () => moveMaterial(material.code, "down"))}
          />
        </View>
      }
    >
      {editing ? (
        <>
          <Field
            autoCapitalize="words"
            autoCorrect={false}
            autoFocus
            error={fieldError ?? undefined}
            label="Name"
            onChangeText={(value) => {
              setName(value);
              setFieldError(null);
            }}
            value={name}
          />
          <RoleSwitches roles={roles} code={material.code} onChange={setRoles} />
        </>
      ) : null}

      {error ? <Message tone="error">{error}</Message> : null}

      <View style={styles.actions}>
        {editing ? (
          <>
            <SecondaryButton label="Save" loading={busy === "save"} onPress={save} />
            <SecondaryButton label="Cancel" disabled={locked} onPress={() => setEditing(false)} />
          </>
        ) : (
          <>
            <SecondaryButton label="Edit" disabled={locked} onPress={startEditing} />
            <SecondaryButton
              label={material.isActive ? "Deactivate" : "Reactivate"}
              loading={busy === "status"}
              disabled={locked}
              onPress={changeStatus}
              tone={material.isActive ? "danger" : "default"}
            />
            {material.code === MIXED_CODE ? null : (
              <SecondaryButton label="Delete" tone="danger" loading={busy === "delete"} disabled={locked} onPress={remove} />
            )}
          </>
        )}
      </View>
    </ExpandableRow>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    move: { flexDirection: "row", gap: 6 },
    switches: { gap: 4 },
    switchRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", minHeight: 44, gap: 12 },
    switchLabel: { color: c.text, flexShrink: 1, fontSize: 15 },
    locked: { color: c.muted },
  });
