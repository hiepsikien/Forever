import { Pressable, Text, View } from "react-native";

import { formatHandleDisplay } from "@/lib/handles";
import { formatShelfSummary, PersonHubRow } from "@/lib/libraryShelves";
import { fonts, createThemedStyles } from "@/lib/theme";

type Props = {
  row: PersonHubRow;
  onPress: () => void;
  lifeAsMilestones?: boolean;
  /** Living members — quieter row. */
  compact?: boolean;
};

export function PersonHubRowView({
  row,
  onPress,
  lifeAsMilestones,
  compact,
}: Props) {
  const handle = row.handle?.trim();
  return (
    <Pressable
      style={[styles.row, compact && styles.rowCompact]}
      onPress={onPress}
    >
      <View style={styles.textCol}>
        <View style={styles.titleRow}>
          <Text style={[styles.label, compact && styles.labelCompact]}>
            {row.label}
          </Text>
          {handle ? (
            <Text style={styles.handle} numberOfLines={1}>
              {formatHandleDisplay(handle)}
            </Text>
          ) : null}
        </View>
        <Text style={styles.summary}>
          {formatShelfSummary(row.counts, {
            poemOwn: row.poemOwn,
            poemGift: row.poemGift,
            lifeAsMilestones,
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
  rowCompact: {
    paddingVertical: 10,
  },
  textCol: { flex: 1, gap: 4 },
  titleRow: {
    flexDirection: "row",
    alignItems: "baseline",
    flexWrap: "wrap",
    gap: 8,
  },
  label: {
    fontFamily: fonts.display,
    fontSize: 20,
    color: colors.ink,
  },
  labelCompact: {
    fontSize: 17,
  },
  handle: {
    flexShrink: 1,
    fontSize: 13,
    lineHeight: 18,
    color: colors.brandSoft,
    fontWeight: "600",
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
