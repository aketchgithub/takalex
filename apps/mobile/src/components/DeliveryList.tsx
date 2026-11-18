// A white card holding rows separated by thin lines, and the delivery row
// used in it: title and detail on the left, a status pill on the right, and
// optional content (a message, buttons) underneath. With onPress the row
// opens something (a chevron shows it). Collector and manager lists use it.

import { Children, Fragment, type PropsWithChildren, type ReactNode } from "react";
import Feather from "@expo/vector-icons/Feather";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { StatusBadge, type StatusTone } from "@/components/StatusBadge";
import { uiColors, uiStyles } from "@/components/Ui";
import { type } from "@/theme/tokens";
import { useFontSize } from "@/theme/useFontSize";

export function ListCard({ children }: PropsWithChildren) {
  const rows = Children.toArray(children).filter(Boolean);
  return (
    <View style={styles.card}>
      {rows.map((row, index) => (
        <Fragment key={index}>
          {index > 0 ? <View style={styles.divider} /> : null}
          {row}
        </Fragment>
      ))}
    </View>
  );
}

export function DeliveryRow({
  title,
  detail,
  badge,
  children,
  onPress,
  accessibilityHint,
}: {
  title: string;
  // One or more lines under the title.
  detail: string | string[];
  badge: { label: string; tone: StatusTone };
  children?: ReactNode;
  onPress?: () => void;
  accessibilityHint?: string;
}) {
  const fs = useFontSize();
  const lines = Array.isArray(detail) ? detail : [detail];
  const label = `${title}. ${lines.join(". ")}. ${badge.label}`;
  const top = (
    <>
      <View style={styles.text}>
        <Text style={[styles.title, { fontSize: fs(type.body) }]}>{title}</Text>
        {lines.map((line, index) => (
          <Text key={index} style={[uiStyles.meta, { fontSize: fs(type.meta) }]}>
            {line}
          </Text>
        ))}
      </View>
      <StatusBadge label={badge.label} tone={badge.tone} />
      {onPress ? <Feather color={uiColors.muted} name="chevron-right" size={20} /> : null}
    </>
  );
  if (onPress) {
    // The whole row is the touch target.
    return (
      <Pressable
        accessibilityHint={accessibilityHint}
        accessibilityLabel={label}
        accessibilityRole="button"
        onPress={onPress}
        style={({ pressed }) => [styles.row, pressed ? styles.pressed : null]}
      >
        <View style={styles.top}>{top}</View>
        {children}
      </Pressable>
    );
  }
  return (
    <View style={styles.row}>
      <View accessible accessibilityLabel={label} style={styles.top}>
        {top}
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { ...uiStyles.card, gap: 0, overflow: "hidden", padding: 0 },
  divider: { backgroundColor: uiColors.divider, height: 1, marginHorizontal: 16 },
  row: { gap: 8, paddingHorizontal: 16, paddingVertical: 14 },
  top: { alignItems: "center", flexDirection: "row", gap: 12 },
  text: { flex: 1, gap: 2 },
  title: { color: uiColors.text, fontWeight: "700" },
  pressed: { backgroundColor: uiColors.background },
});
