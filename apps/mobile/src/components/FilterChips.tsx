import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { uiStylesOf } from "@/components/Ui";
import type { Palette } from "@/theme/tokens";
import { useFontSize } from "@/theme/useFontSize";
import { useThemedStyles } from "@/theme/useTheme";

// The selected chip shows a check mark as well as its colour, so selection
// does not rely on colour alone. scrollable: one row that scrolls sideways
// instead of wrapping (for long lists such as sites).
export function FilterChips<T extends string>({
  options,
  value,
  onChange,
  scrollable = false,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  scrollable?: boolean;
}) {
  const styles = useThemedStyles(makeStyles);
  const fs = useFontSize();
  const chips = options.map((option) => {
    const selected = option.value === value;
    return (
      <Pressable
        key={option.value}
        accessibilityLabel={option.label}
        accessibilityRole="tab"
        accessibilityState={{ selected }}
        onPress={() => onChange(option.value)}
        style={[styles.chip, selected ? styles.selected : null]}
      >
        <Text style={[styles.text, { fontSize: fs(14) }, selected ? styles.selectedText : null]}>
          {selected ? `✓ ${option.label}` : option.label}
        </Text>
      </Pressable>
    );
  });

  if (scrollable) {
    return (
      <ScrollView
        accessibilityRole="tablist"
        contentContainerStyle={styles.scrollRow}
        horizontal
        keyboardShouldPersistTaps="handled"
        showsHorizontalScrollIndicator={false}
      >
        {chips}
      </ScrollView>
    );
  }

  return (
    <View accessibilityRole="tablist" style={styles.row}>
      {chips}
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    row: uiStylesOf(c).chipRow,
    scrollRow: { ...uiStylesOf(c).chipRow, flexWrap: "nowrap" },
    chip: uiStylesOf(c).chip,
    selected: uiStylesOf(c).chipSelected,
    text: uiStylesOf(c).chipText,
    selectedText: uiStylesOf(c).chipTextSelected,
  });
