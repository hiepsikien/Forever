import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { IdentityProfile, MemoryItem } from "@forever/api-client";

import {
  meterFromTags,
  meterLabel,
  THEME_LABELS,
  themeFromTags,
  isGiftPoem,
  yearLabel,
} from "@/lib/libraryShelves";
import { formatLocalDate } from "@/lib/datetime";
import {
  displayMemoryNote,
  displayMemoryTitle,
  isGenericMemoryTitle,
  kindLabel,
  poemPreview,
} from "@/lib/memoryDisplay";
import { heritageLabelsForMemory } from "@/lib/memoryTags";
import { colors, fonts } from "@/lib/theme";

type Props = {
  item: MemoryItem;
  identities: IdentityProfile[];
  userId?: string | null;
  /** On a person hub — hide redundant heritage chips. */
  hideHeritageChips?: boolean;
  photoUri?: string;
  thumbUri?: string;
  thumbLoading?: boolean;
  thumbError?: boolean;
  playingVoice?: boolean;
  saving?: boolean;
  /** Steward / author: long-press the card for Sửa · Xoá. Hidden from consumers. */
  canEdit?: boolean;
  onPress?: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onToggleVisibility?: () => void;
  onPlayVoice?: () => void;
  onPlayVideo?: () => void;
  onRetryThumb?: () => void;
  onOpenSource?: () => void;
};

function isLongText(body: string, kind: string): boolean {
  const lines = body.split(/\n+/).filter((l) => l.trim());
  if (kind === "poem") return lines.length > 2 || body.trim().length > 120;
  return body.trim().length > 160 || lines.length > 4;
}

export function MemoryKindCard({
  item,
  identities,
  userId,
  hideHeritageChips = false,
  photoUri,
  thumbUri,
  thumbLoading,
  thumbError,
  playingVoice,
  saving,
  canEdit = false,
  onPress,
  onEdit,
  onDelete,
  onToggleVisibility,
  onPlayVoice,
  onPlayVideo,
  onRetryThumb,
  onOpenSource,
}: Props) {
  const title = displayMemoryTitle(item.kind, item.title);
  const untitled = isGenericMemoryTitle(item.kind, item.title);
  const note = displayMemoryNote(item.body);
  const people = hideHeritageChips
    ? []
    : heritageLabelsForMemory(item.tags, identities, userId);
  const isPrivate = item.visibility === "private";
  const mine = item.created_by === userId;
  const themes = themeFromTags(item.tags);
  const meter = meterFromTags(item.tags);
  const meterText = meterLabel(meter);
  const gift = isGiftPoem(item.tags);
  const long = isLongText(item.body || "", item.kind);
  const isPoem = item.kind === "poem";
  const showSourceTitle =
    item.kind === "knowledge" &&
    Boolean(item.title?.trim()) &&
    item.title.trim() !== item.body.trim() &&
    !item.body.trim().startsWith(item.title.trim());

  const openActions = () => {
    const buttons: {
      text: string;
      style?: "cancel" | "destructive" | "default";
      onPress?: () => void;
    }[] = [];
    if (mine && onToggleVisibility) {
      buttons.push({
        text: isPrivate ? "Chia sẻ cả nhà" : "Giữ riêng",
        onPress: onToggleVisibility,
      });
    }
    buttons.push({ text: "Sửa", onPress: onEdit });
    buttons.push({
      text: "Xoá",
      style: "destructive",
      onPress: onDelete,
    });
    buttons.push({ text: "Huỷ", style: "cancel" });
    Alert.alert(title || kindLabel(item.kind), undefined, buttons);
  };

  const bodyBlock =
    item.kind === "milestone" ? (
      <View style={styles.milestoneRow}>
        <Text style={styles.year}>{yearLabel(item.occurred_at)}</Text>
        <View style={styles.milestoneBody}>
          <Text style={[styles.title, untitled && styles.titleUntitled]}>{title}</Text>
          {note ? (
            <Text style={styles.note} numberOfLines={long ? 4 : undefined}>
              {note}
            </Text>
          ) : null}
        </View>
      </View>
    ) : isPoem ? (
      <>
        <Text style={[styles.title, untitled && styles.titleUntitled]}>{title}</Text>
        {poemPreview(item.body) ? (
          <Text style={styles.poemLines}>{poemPreview(item.body)}</Text>
        ) : null}
        {meterText || themes.length ? (
          <View style={styles.peopleRow}>
            {meterText ? (
              <View style={styles.personChip}>
                <Text style={styles.personChipText}>{meterText}</Text>
              </View>
            ) : null}
            {themes.map((t) => (
              <View key={t} style={styles.personChip}>
                <Text style={styles.personChipText}>{THEME_LABELS[t] ?? t}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </>
    ) : item.kind === "knowledge" ? (
      <>
        <Text style={styles.knowledgeLine} numberOfLines={long ? 5 : undefined}>
          {item.body.trim() || title}
        </Text>
        {showSourceTitle ? (
          <Text style={styles.meta} numberOfLines={1}>
            Từ: {item.title}
          </Text>
        ) : null}
        {item.created_at ? (
          <Text style={styles.meta}>
            Thêm vào Thư viện: {formatLocalDate(item.created_at)}
            {item.occurred_at
              ? ` · Sự kiện: ${formatLocalDate(item.occurred_at)}`
              : ""}
          </Text>
        ) : null}
        {item.source_message_id && item.source_thread_id && onOpenSource ? (
          <Pressable
            onPress={(e) => {
              e.stopPropagation?.();
              onOpenSource();
            }}
            hitSlop={6}
          >
            <Text style={styles.sourceLink}>Xem câu gốc →</Text>
          </Pressable>
        ) : null}
      </>
    ) : (
      <>
        <Text style={[styles.title, untitled && styles.titleUntitled]}>{title}</Text>
        {note ? (
          <Text style={styles.note} numberOfLines={long ? 4 : undefined}>
            {note}
          </Text>
        ) : null}
      </>
    );

  return (
    <Pressable
      style={[styles.card, isPoem && styles.poemCard]}
      onPress={onPress}
      disabled={!onPress}
      onLongPress={canEdit && !saving ? openActions : undefined}
      delayLongPress={420}
    >
      <View style={styles.cardTop}>
        <Text style={styles.kind}>
          {isPoem ? (gift ? "Thơ tặng" : "Thơ") : kindLabel(item.kind)}
        </Text>
      </View>

      {bodyBlock}

      {people.length > 0 || isPrivate ? (
        <View style={styles.peopleRow}>
          {isPrivate ? (
            <View style={[styles.personChip, styles.privateChip]}>
              <Text style={[styles.personChipText, styles.privateChipText]}>
                Chỉ mình tôi
              </Text>
            </View>
          ) : null}
          {people.map((label) => (
            <View key={`${item.id}-${label}`} style={styles.personChip}>
              <Text style={styles.personChipText}>{label}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {(item.kind === "photo" || item.kind === "milestone") && photoUri ? (
        <Image
          source={{ uri: photoUri }}
          style={styles.mediaPreview}
          resizeMode="cover"
        />
      ) : null}

      {item.kind === "video" && item.has_media ? (
        <Pressable
          style={styles.videoThumbWrap}
          onPress={(e) => {
            e.stopPropagation?.();
            onPlayVideo?.();
          }}
        >
          {thumbUri ? (
            <Image
              source={{ uri: thumbUri }}
              style={styles.videoPreview}
              resizeMode="contain"
            />
          ) : thumbError ? (
            <View style={[styles.videoPreview, styles.videoPlaceholder]}>
              <Text style={styles.thumbErrorText}>Chưa có ảnh xem trước</Text>
              {onRetryThumb ? (
                <Pressable
                  style={styles.thumbRetryBtn}
                  onPress={(e) => {
                    e.stopPropagation?.();
                    onRetryThumb();
                  }}
                >
                  <Text style={styles.thumbRetryText}>Thử lại</Text>
                </Pressable>
              ) : null}
            </View>
          ) : (
            <View style={[styles.videoPreview, styles.videoPlaceholder]}>
              <ActivityIndicator color={colors.brand} />
              <Text style={styles.thumbLoadingHint}>
                {thumbLoading !== false ? "Đang chuẩn bị xem trước…" : "Đang tải…"}
              </Text>
            </View>
          )}
          <View style={styles.playBadge}>
            <Text style={styles.playBadgeText}>▶ Phát</Text>
          </View>
        </Pressable>
      ) : null}

      {item.kind === "voice" && item.has_media ? (
        <Pressable
          style={styles.voiceBtn}
          onPress={(e) => {
            e.stopPropagation?.();
            onPlayVoice?.();
          }}
        >
          <Text style={styles.voiceBtnText}>
            {playingVoice ? "⏸ Đang phát…" : "▶ Nghe lại"}
          </Text>
        </Pressable>
      ) : null}

      {item.kind !== "milestone" &&
      item.kind !== "poem" &&
      item.kind !== "knowledge" ? (
        <Text style={styles.meta}>
          {item.creator_name ?? "Thành viên"}
          {item.occurred_at
            ? ` · ${new Date(item.occurred_at).toLocaleDateString("vi-VN")}`
            : ""}
        </Text>
      ) : item.kind === "knowledge" ? (
        <Text style={styles.meta}>{item.creator_name ?? "Thành viên"}</Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.line,
    gap: 8,
  },
  poemCard: {
    gap: 10,
    paddingVertical: 14,
  },
  cardTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  kind: {
    fontSize: 12,
    color: colors.brandSoft,
    fontWeight: "600",
  },
  title: {
    fontFamily: fonts.display,
    fontSize: 22,
    color: colors.ink,
  },
  poemTitleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  poemTitleFlex: { flex: 1 },
  giftBadge: {
    marginTop: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: colors.bgDeep,
    borderWidth: 1,
    borderColor: colors.line,
  },
  giftBadgeText: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.inkSoft,
    textTransform: "uppercase",
  },
  titleUntitled: {
    color: colors.inkSoft,
    fontStyle: "italic",
  },
  note: {
    color: colors.ink,
    lineHeight: 22,
    fontSize: 15,
  },
  poemLines: {
    color: colors.ink,
    lineHeight: 24,
    fontSize: 16,
    fontStyle: "italic",
  },
  knowledgeLine: {
    color: colors.ink,
    lineHeight: 24,
    fontSize: 17,
  },
  milestoneRow: {
    flexDirection: "row",
    gap: 14,
    alignItems: "flex-start",
  },
  year: {
    fontFamily: fonts.display,
    fontSize: 28,
    color: colors.brand,
    minWidth: 64,
  },
  milestoneBody: { flex: 1, gap: 4 },
  peopleRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  personChip: {
    backgroundColor: colors.bgDeep,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  personChipText: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.brandSoft,
  },
  privateChip: {
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: "transparent",
  },
  privateChipText: {
    color: colors.inkSoft,
  },
  mediaPreview: {
    width: "100%",
    height: 200,
    borderRadius: 12,
    backgroundColor: colors.bgDeep,
  },
  // contain + taller box: hospital / portrait clips keep faces instead of
  // center-cropping them out of a short cover strip.
  videoPreview: {
    width: "100%",
    aspectRatio: 16 / 10,
    minHeight: 220,
    borderRadius: 12,
    backgroundColor: "#1a1a1a",
  },
  videoThumbWrap: { position: "relative", overflow: "hidden", borderRadius: 12 },
  videoPlaceholder: {
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  thumbLoadingHint: {
    fontSize: 13,
    color: colors.inkSoft,
    textAlign: "center",
    paddingHorizontal: 16,
  },
  thumbErrorText: {
    fontSize: 14,
    color: colors.inkSoft,
    textAlign: "center",
  },
  thumbRetryBtn: {
    backgroundColor: colors.bgDeep,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  thumbRetryText: {
    color: colors.brand,
    fontWeight: "600",
    fontSize: 13,
  },
  playBadge: {
    position: "absolute",
    left: 12,
    bottom: 12,
    backgroundColor: "rgba(0,0,0,0.55)",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  playBadgeText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  voiceBtn: {
    alignSelf: "flex-start",
    backgroundColor: colors.bgDeep,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  voiceBtnText: { color: colors.brand, fontWeight: "600" },
  meta: { color: colors.inkSoft, fontSize: 13, marginTop: 4 },
  sourceLink: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.brand,
    marginTop: 4,
  },
});
