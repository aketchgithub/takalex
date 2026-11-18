// Bottom tab bar for every role: a Feather icon above a short label. The
// active tab has a 3px primary bar on top and primary icon and text. Labels
// follow the user's text size, within limits so four tabs still fit.

import Feather from "@expo/vector-icons/Feather";
import type { BottomTabBarProps } from "expo-router/js-tabs";
import type { ComponentProps } from "react";
import { Pressable, StyleSheet, Text, View, type ColorValue } from "react-native";

import { uiColors } from "@/components/Ui";
import { type } from "@/theme/tokens";
import { useFontSize } from "@/theme/useFontSize";

const TAB_HEIGHT = 60;
const ICON_SIZE = 22;

export type TabIconName = ComponentProps<typeof Feather>["name"];

// For a Tabs.Screen: options={{ title: "Home", tabBarIcon: tabIcon("home") }}
export function tabIcon(name: TabIconName) {
  // The tab options type the colour as ColorValue (string, number, null or
  // a native colour); TabBar always passes a string.
  function TabIcon({ color, size }: { color: ColorValue; size: number }) {
    return <Feather color={typeof color === "string" ? color : undefined} name={name} size={size} />;
  }
  return TabIcon;
}

export function TabBar({ state, descriptors, emitter, navigateToTab, insets }: BottomTabBarProps) {
  const fs = useFontSize();
  return (
    <View accessibilityRole="tablist" style={[styles.bar, { paddingBottom: insets.bottom }]}>
      {state.routes.map((route, index) => {
        const focused = index === state.index;
        const { options } = descriptors[route.key];
        const label =
          typeof options.tabBarLabel === "string" ? options.tabBarLabel : (options.title ?? route.name);
        const color = focused ? uiColors.primary : uiColors.muted;

        // Same events the default tab bar sends.
        const onPress = () => {
          const event = emitter.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) navigateToTab(route.key);
        };
        const onLongPress = () => {
          emitter.emit({ type: "tabLongPress", target: route.key });
        };

        return (
          <Pressable
            key={route.key}
            accessibilityLabel={options.tabBarAccessibilityLabel ?? label}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            onLongPress={onLongPress}
            onPress={onPress}
            style={styles.tab}
            testID={options.tabBarButtonTestID}
          >
            <View style={[styles.indicator, focused ? styles.indicatorActive : null]} />
            <View style={styles.content}>
              {options.tabBarIcon ? options.tabBarIcon({ focused, color, size: ICON_SIZE }) : null}
              <Text
                adjustsFontSizeToFit
                maxFontSizeMultiplier={1.3}
                minimumFontScale={0.85}
                numberOfLines={1}
                style={[styles.label, { color, fontSize: Math.min(fs(type.caption), 14) }]}
              >
                {label}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

export function renderTabBar(props: BottomTabBarProps) {
  return <TabBar {...props} />;
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: uiColors.white,
    borderTopColor: uiColors.border,
    borderTopWidth: 1,
    flexDirection: "row",
  },
  tab: {
    flex: 1,
    height: TAB_HEIGHT,
  },
  indicator: {
    backgroundColor: "transparent",
    height: 3,
  },
  indicatorActive: {
    backgroundColor: uiColors.primary,
  },
  content: {
    alignItems: "center",
    flex: 1,
    gap: 2,
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  label: {
    fontWeight: "600",
  },
});
