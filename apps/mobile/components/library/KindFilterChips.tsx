import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { SHELF_LABELS, ShelfCounts, ShelfFilter } from "@/lib/libraryShelves";
import { colors } from "@/lib/theme";

const ORDER: ShelfFilter[] = ["all", "life", "poems", "artifacts", "heard"];

type Props = {
  value: ShelfFilter;
  onChange: (next: ShelfFilter) => void;
  counts?: ShelfCounts;
  /** Override the poems chip label, e.g. "Thơ · 41+72". */
  poemsLabel?: string;
  privateOnly?: boolean;
  onTogglePrivate?: () => void;
};

export function KindFilterChips({
  value,
  onChange,
  counts,
  poemsLabel,
  privateOnly,
  onTogglePrivate,
}: Props) {
  return (
    // Fixed-height wrap stops a horizontal ScrollView from eating the column
    // and stretching chips into tall capsules (flex stretch).
    <View style={styles.wrap}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.scroll}
        contentContainerStyle={styles.row}
      >
        {ORDER.map((id) => {
          const selected = value === id;
          let label = SHELF_LABELS[id];
          if (id === "poems" && poemsLabel) {
            label = poemsLabel;
          } else if (counts) {
            const n =
              id === "all"
                ? counts.life + counts.poems + counts.artifacts + counts.heard
                : counts[id];
            if (n > 0) label = `${SHELF_LABELS[id]} · ${n}`;
          }
          return (
            <Pressable
              key={id}
              style={[styles.chip, selected && styles.chipOn]}
              onPress={() => onChange(id)}
            >
              <Text
                style={[styles.chipText, selected && styles.chipTextOn]}
                numberOfLines={1}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
        {onTogglePrivate ? (
          <Pressable
            style={[styles.chip, privateOnly && styles.chipOn]}
            onPress={onTogglePrivate}
          >
            <Text
              style={[styles.chipText, privateOnly && styles.chipTextOn]}
              numberOfLines={1}
            >
              Chỉ mình tôi
            </Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    height: 44,
    marginBottom: 4,
  },
  scroll: {
    flexGrow: 0,
  },
  row: {
    paddingHorizontal: 16,
    alignItems: "center",
    flexDirection: "row",
    columnGap: 8,
  },
  chip: {
    flexShrink: 0,
    alignSelf: "center",
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: colors.bgDeep,
    borderWidth: 1,
    borderColor: colors.line,
  },
  chipOn: {
    backgroundColor: colors.brand,
    borderColor: colors.brand,
  },
  chipText: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.brandSoft,
  },
  chipTextOn: { color: "#f4efe6" },
});
