import { Pressable, ScrollView, Text, View } from "react-native";

import { SHELF_LABELS, ShelfCounts, ShelfFilter } from "@/lib/libraryShelves";
import { colors, createThemedStyles } from "@/lib/theme";

const ORDER: ShelfFilter[] = ["all", "life", "poems", "artifacts", "heard"];

type Props = {
  value: ShelfFilter;
  onChange: (next: ShelfFilter) => void;
  counts?: ShelfCounts;
  /** Override the poems chip label, e.g. "Thơ · 41+72". */
  poemsLabel?: string;
  /** Person memorial: «Mốc đời» instead of family calendar label. */
  lifeLabel?: string;
};

export function KindFilterChips({
  value,
  onChange,
  counts,
  poemsLabel,
  lifeLabel,
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
          const baseLabel =
            id === "life" && lifeLabel ? lifeLabel : SHELF_LABELS[id];
          let label = baseLabel;
          if (id === "poems" && poemsLabel) {
            label = poemsLabel;
          } else if (counts) {
            const n =
              id === "all"
                ? counts.life + counts.poems + counts.artifacts + counts.heard
                : counts[id];
            if (n > 0) label = `${baseLabel} · ${n}`;
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
      </ScrollView>
    </View>
  );
}

const styles = createThemedStyles((colors) => ({
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
}));
