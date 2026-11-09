import type { PropsWithChildren } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { uiColors } from "@/components/Ui";

// Small building blocks shared by the site manager screens.

export function Card({ children, onPress, label }: PropsWithChildren<{ onPress?: () => void; label?: string }>) {
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

export function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

export function SectionHeading({ children, note }: PropsWithChildren<{ note?: string }>) {
  return (
    <View style={styles.heading}>
      <Text style={styles.headingText}>{children}</Text>
      {note ? <Text style={styles.note}>{note}</Text> : null}
    </View>
  );
}

export const reviewStyles = StyleSheet.create({
  title: { color: uiColors.text, fontSize: 16, fontWeight: "700" },
  meta: { color: uiColors.muted, fontSize: 13, lineHeight: 18 },
  section: { gap: 10 },
});

const styles = StyleSheet.create({
  card: {
    backgroundColor: uiColors.white,
    borderColor: uiColors.border,
    borderRadius: 12,
    borderWidth: 1,
    gap: 6,
    padding: 14,
  },
  pressed: { opacity: 0.85 },
  row: { flexDirection: "row", gap: 12, justifyContent: "space-between" },
  rowLabel: { color: uiColors.muted, flexShrink: 1, fontSize: 14 },
  rowValue: { color: uiColors.text, flexShrink: 1, fontSize: 14, fontWeight: "600", textAlign: "right" },
  heading: { gap: 2 },
  headingText: { color: uiColors.text, fontSize: 18, fontWeight: "700" },
  note: { color: uiColors.muted, fontSize: 13 },
});
