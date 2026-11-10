import { Pressable, StyleSheet, Text, View } from "react-native";

import { uiColors } from "@/components/Ui";

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
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    backgroundColor: uiColors.white,
    borderColor: uiColors.border,
    borderRadius: 18,
    borderWidth: 1.5,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  selected: { backgroundColor: uiColors.primary, borderColor: uiColors.primary },
  text: { color: uiColors.text, fontSize: 14, fontWeight: "600" },
  selectedText: { color: uiColors.white },
});
