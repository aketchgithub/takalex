// Text-only bottom tab bar for the collector, manager and admin tabs. No
// icons: the active tab has a 3px primary bar on top and primary text.

import type { BottomTabBarProps } from "expo-router/js-tabs";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { uiColors } from "@/components/Ui";

const TAB_HEIGHT = 56;

export function TextTabBar({ state, descriptors, emitter, navigateToTab, insets }: BottomTabBarProps) {
  return (
    <View accessibilityRole="tablist" style={[styles.bar, { paddingBottom: insets.bottom }]}>
      {state.routes.map((route, index) => {
        const focused = index === state.index;
        const { options } = descriptors[route.key];
        const label =
          typeof options.tabBarLabel === "string" ? options.tabBarLabel : (options.title ?? route.name);

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
            <View style={styles.labelBox}>
              <Text
                adjustsFontSizeToFit
                minimumFontScale={0.85}
                numberOfLines={1}
                style={[styles.label, focused ? styles.labelActive : null]}
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

export function renderTextTabBar(props: BottomTabBarProps) {
  return <TextTabBar {...props} />;
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
  labelBox: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  label: {
    color: uiColors.muted,
    fontSize: 13,
    fontWeight: "600",
  },
  labelActive: {
    color: uiColors.primary,
  },
});
