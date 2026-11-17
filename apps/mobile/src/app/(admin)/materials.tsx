import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Alert, StyleSheet, Switch, Text, View } from "react-native";

import { Card, reviewStyles } from "@/components/ReviewUi";
import { Field, InlineLink, Message, PrimaryButton, Screen, SecondaryButton, uiColors, uiStyles } from "@/components/Ui";
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
import { createMaterial, deleteMaterial, listAllMaterials, moveMaterial, updateMaterial } from "@/lib/admin/materials";

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
      subtitle="The materials collectors report, managers sort into and recyclers see. A material used in deliveries cannot be deleted: deactivate it instead."
      refreshing={refreshing}
      onRefresh={() => {
        setRefreshing(true);
        reload();
      }}
    >
      {list.status === "ready" ? <AddMaterialForm materials={materials} onAdded={reload} /> : null}

      {list.status === "loading" ? <Message>Loading materials…</Message> : null}
      {list.status === "error" ? (
        <>
          <Message tone="error">{list.message}</Message>
          <InlineLink label="Try again" onPress={reload} />
        </>
      ) : null}

      {materials.map((material, index) => (
        <MaterialCard
          key={material.code}
          material={material}
          materials={materials}
          isFirst={index === 0}
          isLast={index === materials.length - 1}
          onChanged={reload}
        />
      ))}
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
            thumbColor={uiColors.white}
            trackColor={{ false: uiColors.border, true: uiColors.primary }}
            value={roles[row.key]}
          />
        </View>
      ))}
      {mixed ? <Text style={reviewStyles.meta}>Mixed is only for unsorted deliveries reported by collectors.</Text> : null}
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
    <View style={styles.card}>
      <Text style={reviewStyles.title}>Add a material</Text>
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
    </View>
  );
}

function MaterialCard({
  material,
  materials,
  isFirst,
  isLast,
  onChanged,
}: {
  material: AdminMaterial;
  materials: AdminMaterial[];
  isFirst: boolean;
  isLast: boolean;
  onChanged: () => void;
}) {
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
    Alert.alert(
      next ? `Reactivate ${material.displayName}?` : `Deactivate ${material.displayName}?`,
      next ? reactivateMaterialConfirmation(material.displayName) : deactivateMaterialConfirmation(material.displayName),
      [
        { text: "Cancel", style: "cancel" },
        {
          text: next ? "Reactivate" : "Deactivate",
          style: next ? "default" : "destructive",
          onPress: () => void run("status", () => updateMaterial(material.code, material.displayName, current, next)),
        },
      ],
    );
  };

  const remove = () => {
    Alert.alert(`Delete ${material.displayName}?`, deleteMaterialConfirmation(material.displayName), [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => void run("delete", () => deleteMaterial(material.code)) },
    ]);
  };

  const locked = busy !== null;

  return (
    <Card>
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
      ) : (
        <>
          <View style={styles.titleRow}>
            <Text style={[reviewStyles.title, styles.name, material.isActive ? null : styles.inactiveName]}>
              {material.displayName}
            </Text>
            {material.isActive ? null : <Text style={styles.badge}>Inactive</Text>}
          </View>
          <Text style={reviewStyles.meta}>
            {rolesSummary(current)} · code {material.code}
          </Text>
        </>
      )}

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
              label="Move up"
              disabled={locked || isFirst}
              loading={busy === "up"}
              onPress={() => void run("up", () => moveMaterial(material.code, "up"))}
            />
            <SecondaryButton
              label="Move down"
              disabled={locked || isLast}
              loading={busy === "down"}
              onPress={() => void run("down", () => moveMaterial(material.code, "down"))}
            />
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
    </Card>
  );
}

const styles = StyleSheet.create({
  card: uiStyles.card,
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
  switches: { gap: 4 },
  switchRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", minHeight: 44, gap: 12 },
  switchLabel: { color: uiColors.text, flexShrink: 1, fontSize: 15 },
  locked: { color: uiColors.muted },
});
