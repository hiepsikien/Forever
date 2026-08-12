import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { MemoryItem } from "@forever/api-client";

import { formatLocalDate } from "@/lib/datetime";
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
  photoUri?: string;
  onOpenSource?: () => void;
  onEdit?: () => void;
  canEdit?: boolean;
};

export function MemoryReadModal({
  item,
  visible,
  onClose,
  photoUri,
  onOpenSource,
  onEdit,
  canEdit,
}: Props) {
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
            <View style={styles.headActions}>
              {canEdit && onEdit ? (
                <Pressable onPress={onEdit} hitSlop={12}>
                  <Text style={styles.edit}>Sửa</Text>
                </Pressable>
              ) : null}
              <Pressable onPress={onClose} hitSlop={12}>
                <Text style={styles.close}>Đóng</Text>
              </Pressable>
            </View>
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
            {(item.kind === "milestone" || item.kind === "photo") &&
            item.has_media &&
            photoUri ? (
              <Image
                source={{ uri: photoUri }}
                style={styles.photo}
                resizeMode="cover"
              />
            ) : null}
            <Text style={item.kind === "poem" ? styles.poem : styles.body}>
              {item.body.trim() || "—"}
            </Text>
            {item.kind === "knowledge" ? (
              <View style={styles.knowledgeMeta}>
                {item.created_at ? (
                  <Text style={styles.meta}>
                    Thêm vào Thư viện: {formatLocalDate(item.created_at)}
                  </Text>
                ) : null}
                {item.occurred_at ? (
                  <Text style={styles.meta}>
                    Ngày sự kiện: {formatLocalDate(item.occurred_at)}
                  </Text>
                ) : null}
                {item.source_message_id && item.source_thread_id && onOpenSource ? (
                  <Pressable onPress={onOpenSource} hitSlop={8}>
                    <Text style={styles.sourceLink}>Xem câu gốc trong trò chuyện →</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : (
              <Text style={styles.meta}>
                {item.creator_name ?? "Thành viên"}
                {item.occurred_at
                  ? ` · ${formatLocalDate(item.occurred_at)}`
                  : item.created_at
                    ? ` · ${formatLocalDate(item.created_at)}`
                    : ""}
              </Text>
            )}
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
  headActions: { flexDirection: "row", alignItems: "center", gap: 16 },
  kind: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.brandSoft,
  },
  edit: {
    fontSize: 16,
    fontWeight: "600",
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
  photo: {
    width: "100%",
    height: 220,
    borderRadius: 12,
    backgroundColor: colors.bgDeep,
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
  knowledgeMeta: { gap: 6, marginTop: 4 },
  meta: { color: colors.inkSoft, fontSize: 13, marginTop: 8 },
  sourceLink: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.brand,
    marginTop: 4,
  },
});
