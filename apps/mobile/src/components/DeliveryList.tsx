// A white card holding rows separated by thin lines, and the delivery row
// used in it: title and detail on the left, a status pill on the right, and
// optional content (a message, buttons) underneath. Collector Home and
// History use it.

import { Children, Fragment, type PropsWithChildren, type ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";

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
}: {
  title: string;
  detail: string;
  badge: { label: string; tone: StatusTone };
  children?: ReactNode;
}) {
  const fs = useFontSize();
  return (
    <View style={styles.row}>
      <View accessible accessibilityLabel={`${title}. ${detail}. ${badge.label}`} style={styles.top}>
        <View style={styles.text}>
          <Text style={[styles.title, { fontSize: fs(type.body) }]}>{title}</Text>
          <Text style={[uiStyles.meta, { fontSize: fs(type.meta) }]}>{detail}</Text>
        </View>
        <StatusBadge label={badge.label} tone={badge.tone} />
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { ...uiStyles.card, gap: 0, padding: 0 },
  divider: { backgroundColor: uiColors.divider, height: 1, marginHorizontal: 16 },
  row: { gap: 8, paddingHorizontal: 16, paddingVertical: 14 },
  top: { alignItems: "center", flexDirection: "row", gap: 12 },
  text: { flex: 1, gap: 2 },
  title: { color: uiColors.text, fontWeight: "700" },
});
