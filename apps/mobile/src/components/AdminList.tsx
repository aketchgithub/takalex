// Pieces for the admin screens: a card header (title, detail and a status
// pill on one line), a row that opens to show its actions, and a button that
// opens an "add" form. They keep Sites, Materials, Access and Invitations
// looking the same.

import type { ComponentProps, PropsWithChildren, ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import Feather from "@/components/Feather";
import { StatusBadge, type StatusTone } from "@/components/StatusBadge";
import { uiStylesOf, useUiStyles } from "@/components/Ui";
import { radius, touch, type, type Palette } from "@/theme/tokens";
import { useFontSize } from "@/theme/useFontSize";
import { useColors, useThemedStyles } from "@/theme/useTheme";

type IconName = ComponentProps<typeof Feather>["name"];
type Badge = { label: string; tone: StatusTone };

// Title (and detail lines) on the left, the status pill on the right.
export function CardHeader({ title, detail, badge }: { title: string; detail?: string[]; badge?: Badge }) {
  const ui = useUiStyles();
  const styles = useThemedStyles(makeStyles);
  const fs = useFontSize();
  return (
    <View style={styles.header}>
      <View style={styles.headerText}>
        <Text style={[styles.title, { fontSize: fs(type.cardTitle) }]}>{title}</Text>
        {(detail ?? []).map((line, index) => (
          <Text key={index} style={[ui.meta, { fontSize: fs(type.meta) }]}>
            {line}
          </Text>
        ))}
      </View>
      {badge ? <StatusBadge label={badge.label} tone={badge.tone} /> : null}
    </View>
  );
}

// A row in a list card. Tapping it opens or closes its actions (children).
// `trailing` sits before the chevron, e.g. move buttons.
export function ExpandableRow({
  icon,
  title,
  detail,
  badge,
  expanded,
  onToggle,
  trailing,
  dimmed = false,
  children,
}: PropsWithChildren<{
  icon?: IconName;
  title: string;
  detail?: string;
  badge?: Badge;
  expanded: boolean;
  onToggle: () => void;
  trailing?: ReactNode;
  dimmed?: boolean;
}>) {
  const c = useColors();
  const ui = useUiStyles();
  const styles = useThemedStyles(makeStyles);
  const fs = useFontSize();
  return (
    <View style={[styles.row, expanded ? styles.rowExpanded : null]}>
      <View style={styles.rowTop}>
        <Pressable
          accessibilityHint={expanded ? "Hides the actions" : "Shows the actions"}
          accessibilityLabel={[title, detail, badge?.label].filter(Boolean).join(". ")}
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          onPress={onToggle}
          style={({ pressed }) => [styles.rowMain, pressed ? styles.pressed : null]}
        >
          {icon ? <Feather color={dimmed ? c.muted : c.primary} name={icon} size={20} /> : null}
          <View style={styles.headerText}>
            <Text style={[styles.title, dimmed ? styles.dimmed : null, { fontSize: fs(type.body) }]}>{title}</Text>
            {detail ? <Text style={[ui.meta, { fontSize: fs(type.meta) }]}>{detail}</Text> : null}
          </View>
          {badge ? <StatusBadge label={badge.label} tone={badge.tone} /> : null}
        </Pressable>
        {trailing}
        <Pressable accessibilityElementsHidden hitSlop={8} importantForAccessibility="no" onPress={onToggle}>
          <Feather color={c.muted} name={expanded ? "chevron-up" : "chevron-down"} size={20} />
        </Pressable>
      </View>
      {expanded ? <View style={styles.rowBody}>{children}</View> : null}
    </View>
  );
}

// A small square icon button, e.g. move up / move down.
export function IconButton({
  icon,
  label,
  disabled = false,
  onPress,
}: {
  icon: IconName;
  label: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.iconButton, pressed ? styles.pressed : null, disabled ? styles.iconDisabled : null]}
    >
      <Feather color={c.primary} name={icon} size={18} />
    </Pressable>
  );
}

// "+ Add a site": shows the form below it when pressed; "Close" hides it.
export function AddToggle({
  label,
  open,
  onToggle,
  children,
}: PropsWithChildren<{ label: string; open: boolean; onToggle: () => void }>) {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  const fs = useFontSize();
  return (
    <View style={open ? styles.addCard : null}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={onToggle}
        style={({ pressed }) => [styles.addButton, open ? styles.addButtonOpen : null, pressed ? styles.pressed : null]}
      >
        <Feather color={c.primary} name={open ? "x" : "plus"} size={20} />
        <Text style={[styles.addLabel, { fontSize: fs(type.body) }]}>{open ? "Close" : label}</Text>
      </Pressable>
      {open ? <View style={styles.addBody}>{children}</View> : null}
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    header: { alignItems: "flex-start", flexDirection: "row", gap: 12 },
    headerText: { flex: 1, gap: 2 },
    title: { color: c.text, fontWeight: "700" },
    dimmed: { color: c.muted },
    pressed: { opacity: 0.6 },
    row: { paddingHorizontal: 16, paddingVertical: 12 },
    rowExpanded: { backgroundColor: c.background },
    rowTop: { alignItems: "center", flexDirection: "row", gap: 8 },
    rowMain: { alignItems: "center", flex: 1, flexDirection: "row", gap: 12, minHeight: touch.min },
    rowBody: { gap: 12, paddingTop: 12 },
    iconButton: {
      alignItems: "center",
      borderColor: c.inputBorder,
      borderRadius: radius.md,
      borderWidth: 1,
      height: touch.min,
      justifyContent: "center",
      width: touch.min,
    },
    iconDisabled: { opacity: 0.35 },
    addCard: { ...uiStylesOf(c).card, gap: 0, padding: 0 },
    addButton: {
      alignItems: "center",
      backgroundColor: c.surface,
      borderColor: c.inputBorder,
      borderRadius: radius.lg,
      borderStyle: "dashed",
      borderWidth: 1.5,
      flexDirection: "row",
      gap: 8,
      justifyContent: "center",
      minHeight: touch.button,
      paddingHorizontal: 16,
    },
    addButtonOpen: { borderWidth: 0, justifyContent: "flex-start" },
    addLabel: { color: c.primary, fontWeight: "700" },
    addBody: { gap: 12, paddingBottom: 16, paddingHorizontal: 16 },
  });
