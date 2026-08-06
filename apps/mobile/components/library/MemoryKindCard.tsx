import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { IdentityProfile, MemoryItem } from "@forever/api-client";

import {
  meterFromTags,
  THEME_LABELS,
  themeFromTags,
  yearLabel,
} from "@/lib/libraryShelves";
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
  photoUri?: string;
  thumbUri?: string;
  thumbLoading?: boolean;
  thumbError?: boolean;
  playingVoice?: boolean;
  saving?: boolean;
  onPress?: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onToggleVisibility?: () => void;
  onPlayVoice?: () => void;
  onPlayVideo?: () => void;
  onRetryThumb?: () => void;
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
  photoUri,
  thumbUri,
  thumbLoading,
  thumbError,
  playingVoice,
  saving,
  onPress,
  onEdit,
  onDelete,
  onToggleVisibility,
  onPlayVoice,
  onPlayVideo,
  onRetryThumb,
}: Props) {
  const title = displayMemoryTitle(item.kind, item.title);
  const untitled = isGenericMemoryTitle(item.kind, item.title);
  const note = displayMemoryNote(item.body);
  const people = heritageLabelsForMemory(item.tags, identities, userId);
  const isPrivate = item.visibility === "private";
  const mine = item.created_by === userId;
  const themes = themeFromTags(item.tags);
  const meter = meterFromTags(item.tags);
  const long = isLongText(item.body || "", item.kind);
  const showSourceTitle =
    item.kind === "knowledge" &&
    Boolean(item.title?.trim()) &&
    item.title.trim() !== item.body.trim() &&
    !item.body.trim().startsWith(item.title.trim());

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
    ) : item.kind === "poem" ? (
      <>
        <Text style={[styles.title, untitled && styles.titleUntitled]}>{title}</Text>
        {poemPreview(item.body) ? (
          <Text style={styles.poemLines}>{poemPreview(item.body)}</Text>
        ) : null}
        {meter || themes.length ? (
          <View style={styles.peopleRow}>
            {meter ? (
              <View style={styles.personChip}>
                <Text style={styles.personChipText}>{meter}</Text>
              </View>
            ) : null}
            {themes.map((t) => (
              <View key={t} style={styles.personChip}>
                <Text style={styles.personChipText}>{THEME_LABELS[t] ?? t}</Text>
              </View>
            ))}
          </View>
        ) : null}
        {long ? <Text style={styles.readMore}>Chạm để đọc cả bài →</Text> : null}
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
        {long ? <Text style={styles.readMore}>Chạm để đọc đủ →</Text> : null}
      </>
    ) : (
      <>
        <Text style={[styles.title, untitled && styles.titleUntitled]}>{title}</Text>
        {note ? (
          <Text style={styles.note} numberOfLines={long ? 4 : undefined}>
            {note}
          </Text>
        ) : null}
        {long ? <Text style={styles.readMore}>Chạm để đọc đủ →</Text> : null}
      </>
    );

  return (
    <Pressable
      style={styles.card}
      onPress={onPress}
      disabled={!onPress}
    >
      <View style={styles.cardTop}>
        <Text style={styles.kind}>{kindLabel(item.kind)}</Text>
        <View style={styles.cardActions}>
          {mine && onToggleVisibility ? (
            <Pressable
              onPress={(e) => {
                e.stopPropagation?.();
                onToggleVisibility();
              }}
              hitSlop={8}
              disabled={saving}
            >
              <Text style={styles.editLink}>
                {isPrivate ? "Chia sẻ cả nhà" : "Giữ riêng"}
              </Text>
            </Pressable>
          ) : null}
          <Pressable
            onPress={(e) => {
              e.stopPropagation?.();
              onEdit();
            }}
            hitSlop={8}
          >
            <Text style={styles.editLink}>Sửa</Text>
          </Pressable>
          <Pressable
            onPress={(e) => {
              e.stopPropagation?.();
              onDelete();
            }}
            hitSlop={8}
            disabled={saving}
          >
            <Text style={styles.deleteLink}>Xoá</Text>
          </Pressable>
        </View>
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

      {item.kind === "photo" && photoUri ? (
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

      {item.kind !== "milestone" && item.kind !== "poem" && item.kind !== "knowledge" ? (
        <Text style={styles.meta}>
          {item.creator_name ?? "Thành viên"}
          {item.occurred_at
            ? ` · ${new Date(item.occurred_at).toLocaleDateString("vi-VN")}`
            : ""}
        </Text>
      ) : (
        <Text style={styles.meta}>{item.creator_name ?? "Thành viên"}</Text>
      )}
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
  cardTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  cardActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  kind: {
    fontSize: 12,
    color: colors.brandSoft,
    fontWeight: "600",
  },
  editLink: {
    fontSize: 13,
    color: colors.brand,
    fontWeight: "600",
  },
  deleteLink: {
    fontSize: 13,
    color: colors.danger,
    fontWeight: "600",
  },
  title: {
    fontFamily: fonts.display,
    fontSize: 22,
    color: colors.ink,
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
  readMore: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.brand,
    marginTop: 2,
  },
});
