// Left-hand menu for the admin website on wide screens (lib/sidebar.ts says
// when). Replaces the bottom tab bar there; phones and narrow windows keep
// the tab bar. Highlights the current page from the URL.

import { router, usePathname, type Href } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import Feather from "@/components/Feather";
import type { TabIconName } from "@/components/TabBar";
import { isCurrentTab } from "@/lib/sidebar";
import { radius, type, type Palette } from "@/theme/tokens";
import { useFontSize } from "@/theme/useFontSize";
import { useColors, useThemedStyles } from "@/theme/useTheme";

export type SidebarItem = { name: string; title: string; icon: TabIconName; href: Href };

export const SIDEBAR_WIDTH = 240;

export function Sidebar({ heading, items }: { heading: string; items: SidebarItem[] }) {
  const styles = useThemedStyles(makeStyles);
  const fs = useFontSize();
  const pathname = usePathname();

  return (
    <View accessibilityRole="menu" style={styles.sidebar}>
      <Text style={[styles.brand, { fontSize: fs(type.label) }]}>TAKALEX</Text>
      <Text style={[styles.heading, { fontSize: fs(type.cardTitle) }]}>{heading}</Text>
      <View style={styles.items}>
        {items.map((item) => (
          <SidebarRow key={item.name} item={item} current={isCurrentTab(pathname, item.name)} />
        ))}
      </View>
    </View>
  );
}

function SidebarRow({ item, current }: { item: SidebarItem; current: boolean }) {
  const c = useColors();
  const styles = useThemedStyles(makeStyles);
  const fs = useFontSize();
  const [hovered, setHovered] = useState(false);
  const color = current ? c.primary : c.muted;
  return (
    <Pressable
      accessibilityLabel={item.title}
      accessibilityRole="menuitem"
      accessibilityState={{ selected: current }}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      onPress={() => {
        if (!current) router.navigate(item.href);
      }}
      style={({ pressed }) => [
        styles.item,
        current ? styles.itemCurrent : null,
        !current && (hovered || pressed) ? styles.itemHover : null,
      ]}
    >
      <Feather color={color} name={item.icon} size={20} />
      <Text style={[styles.label, { color, fontSize: fs(type.body) }, current ? styles.labelCurrent : null]}>
        {item.title}
      </Text>
    </Pressable>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    sidebar: {
      backgroundColor: c.surface,
      borderRightColor: c.border,
      borderRightWidth: 1,
      paddingHorizontal: 12,
      paddingVertical: 24,
      width: SIDEBAR_WIDTH,
    },
    brand: { color: c.primary, fontWeight: "800", letterSpacing: 2, paddingHorizontal: 12 },
    heading: { color: c.text, fontWeight: "700", marginBottom: 20, marginTop: 2, paddingHorizontal: 12 },
    items: { gap: 4 },
    item: {
      alignItems: "center",
      borderRadius: radius.md,
      flexDirection: "row",
      gap: 12,
      minHeight: 44,
      paddingHorizontal: 12,
    },
    itemCurrent: { backgroundColor: c.primarySoft },
    itemHover: { backgroundColor: c.background },
    label: { fontWeight: "600" },
    labelCurrent: { fontWeight: "700" },
  });
