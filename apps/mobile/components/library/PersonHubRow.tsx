import { Pressable, Text, View } from "react-native";

import { formatShelfSummary, PersonHubRow } from "@/lib/libraryShelves";
import { colors, fonts, createThemedStyles } from "@/lib/theme";

type Props = {
  row: PersonHubRow;
  onPress: () => void;
};

export function PersonHubRowView({ row, onPress }: Props) {
  return (
    <Pressable style={styles.row} onPress={onPress}>
      <View style={styles.textCol}>
        <Text style={styles.label}>{row.label}</Text>
        <Text style={styles.summary}>
          {formatShelfSummary(row.counts, {
            poemOwn: row.poemOwn,
            poemGift: row.poemGift,
          })}
        </Text>
      </View>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

const styles = createThemedStyles((colors) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 8,
    gap: 12,
  },
  textCol: { flex: 1, gap: 4 },
  label: {
    fontFamily: fonts.display,
    fontSize: 20,
    color: colors.ink,
  },
  summary: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.inkSoft,
  },
  chevron: {
    fontSize: 28,
    color: colors.brandSoft,
    lineHeight: 28,
  },
}));
