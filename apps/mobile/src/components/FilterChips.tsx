import { Pressable, StyleSheet, Text, View } from "react-native";

import { uiStyles } from "@/components/Ui";

export function FilterChips<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <View accessibilityRole="tablist" style={styles.row}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onChange(option.value)}
            style={[styles.chip, selected ? styles.selected : null]}
          >
            <Text style={[styles.text, selected ? styles.selectedText : null]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: uiStyles.chipRow,
  chip: uiStyles.chip,
  selected: uiStyles.chipSelected,
  text: uiStyles.chipText,
  selectedText: uiStyles.chipTextSelected,
});
