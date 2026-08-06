import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { MemoryItem } from "@forever/api-client";

import {
  meterFromTags,
  THEME_LABELS,
  themeFromTags,
  yearLabel,
} from "@/lib/libraryShelves";
import {
  displayMemoryTitle,
  isGenericMemoryTitle,
  kindLabel,
} from "@/lib/memoryDisplay";
import { colors, fonts } from "@/lib/theme";

type Props = {
  item: MemoryItem | null;
  visible: boolean;
  onClose: () => void;
};

export function MemoryReadModal({ item, visible, onClose }: Props) {
  if (!item) return null;
  const title = displayMemoryTitle(item.kind, item.title);
  const untitled = isGenericMemoryTitle(item.kind, item.title);
  const themes = themeFromTags(item.tags);
  const meter = meterFromTags(item.tags);
  const showTitle =
    item.kind !== "knowledge" ||
    (title.trim() && title.trim() !== item.body.trim());

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.head}>
            <Text style={styles.kind}>{kindLabel(item.kind)}</Text>
            <Pressable onPress={onClose} hitSlop={12}>
              <Text style={styles.close}>Đóng</Text>
            </Pressable>
          </View>
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator
          >
            {item.kind === "milestone" ? (
              <Text style={styles.year}>{yearLabel(item.occurred_at)}</Text>
            ) : null}
            {showTitle ? (
              <Text style={[styles.title, untitled && styles.titleUntitled]}>
                {title}
              </Text>
            ) : null}
            {meter || themes.length ? (
              <View style={styles.chips}>
                {meter ? (
                  <View style={styles.chip}>
                    <Text style={styles.chipText}>{meter}</Text>
                  </View>
                ) : null}
                {themes.map((t) => (
                  <View key={t} style={styles.chip}>
                    <Text style={styles.chipText}>{THEME_LABELS[t] ?? t}</Text>
                  </View>
                ))}
              </View>
            ) : null}
            <Text style={item.kind === "poem" ? styles.poem : styles.body}>
              {item.body.trim() || "—"}
            </Text>
            <Text style={styles.meta}>
              {item.creator_name ?? "Thành viên"}
              {item.occurred_at
                ? ` · ${new Date(item.occurred_at).toLocaleDateString("vi-VN")}`
                : ""}
            </Text>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: "88%",
    paddingTop: 16,
    paddingBottom: 28,
  },
  head: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    marginBottom: 8,
  },
  kind: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.brandSoft,
  },
  close: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.brand,
  },
  scroll: { paddingHorizontal: 20 },
  scrollContent: { paddingBottom: 24, gap: 12 },
  year: {
    fontFamily: fonts.display,
    fontSize: 36,
    color: colors.brand,
  },
  title: {
    fontFamily: fonts.display,
    fontSize: 26,
    color: colors.ink,
  },
  titleUntitled: {
    color: colors.inkSoft,
    fontStyle: "italic",
  },
  body: {
    fontSize: 17,
    lineHeight: 26,
    color: colors.ink,
  },
  poem: {
    fontSize: 18,
    lineHeight: 30,
    color: colors.ink,
    fontStyle: "italic",
  },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: {
    backgroundColor: colors.bgDeep,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  chipText: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.brandSoft,
  },
  meta: { color: colors.inkSoft, fontSize: 13, marginTop: 8 },
});
