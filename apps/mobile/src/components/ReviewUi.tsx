import type { PropsWithChildren } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { uiStylesOf } from "@/components/Ui";
import type { Palette } from "@/theme/tokens";
import { useThemedStyles } from "@/theme/useTheme";

// Small building blocks shared by the site manager screens.

export function Card({ children, onPress, label }: PropsWithChildren<{ onPress?: () => void; label?: string }>) {
  const styles = useThemedStyles(makeStyles);
  if (!onPress) return <View style={styles.card}>{children}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed ? styles.pressed : null]}
    >
      {children}
    </Pressable>
  );
}

// The label keeps its full width and never breaks inside a word; a long
// value wraps in the space that is left. stacked puts the value on its own
// lines under the label, for values that are long or have several lines.
export function Row({ label, value, stacked = false }: { label: string; value: string; stacked?: boolean }) {
  const styles = useThemedStyles(makeStyles);
  if (stacked) {
    return (
      <View style={styles.stacked}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.stackedValue}>{value}</Text>
      </View>
    );
  }
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

export function SectionHeading({ children, note }: PropsWithChildren<{ note?: string }>) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.heading}>
      <Text accessibilityRole="header" style={styles.headingText}>
        {children}
      </Text>
      {note ? <Text style={styles.note}>{note}</Text> : null}
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    card: uiStylesOf(c).card,
    pressed: { opacity: 0.85 },
    row: { flexDirection: "row", gap: 12, justifyContent: "space-between" },
    rowLabel: { color: c.muted, flexShrink: 0, fontSize: 14 },
    rowValue: { color: c.text, flex: 1, fontSize: 14, fontWeight: "600", textAlign: "right" },
    stacked: { gap: 2 },
    stackedValue: { color: c.text, fontSize: 14, fontWeight: "600", lineHeight: 20 },
    heading: { gap: 2 },
    headingText: uiStylesOf(c).sectionHeading,
    note: uiStylesOf(c).meta,
  });
