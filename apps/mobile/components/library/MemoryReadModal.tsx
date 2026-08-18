import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Image,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MemoryItem } from "@forever/api-client";

import { PhotoLightbox } from "@/components/library/PhotoLightbox";
import { formatLocalDate } from "@/lib/datetime";
import {
  calendarDateLabel,
  isGiftPoem,
  meterFromTags,
  meterLabel,
  THEME_LABELS,
  themeFromTags,
} from "@/lib/libraryShelves";
import {
  displayMemoryTitle,
  isGenericMemoryTitle,
  kindLabel,
} from "@/lib/memoryDisplay";
import { colors, fonts, createThemedStyles } from "@/lib/theme";

type Props = {
  item: MemoryItem | null;
  visible: boolean;
  onClose: () => void;
  photoUri?: string;
  onOpenSource?: () => void;
  onEdit?: () => void;
  canEdit?: boolean;
  canRecite?: boolean;
  reciteLabel?: string;
  reciting?: boolean;
  playingRecite?: boolean;
  onRecite?: () => void;
};

function stanzasFromBody(body: string): string[][] {
  return body
    .trim()
    .split(/\n\s*\n/)
    .map((block) =>
      block
        .split(/\n/)
        .map((line) => line.trim())
        .filter(Boolean),
    )
    .filter((stanza) => stanza.length > 0);
}

function PoemReader({
  item,
  onLongPress,
  recite,
}: {
  item: MemoryItem;
  onLongPress?: () => void;
  recite?: {
    label: string;
    busy: boolean;
    playing: boolean;
    onPress: () => void;
  };
}) {
  const title = displayMemoryTitle(item.kind, item.title);
  const untitled = isGenericMemoryTitle(item.kind, item.title);
  const gift = isGiftPoem(item.tags);
  const meter = meterLabel(meterFromTags(item.tags));
  const themes = themeFromTags(item.tags).filter((t) => t !== "tho");
  const stanzas = stanzasFromBody(item.body);
  const kicker = [gift ? "Thơ tặng" : "Thơ", meter].filter(Boolean).join("  ·  ");
  const dated = item.occurred_at || item.created_at;

  return (
    <View style={styles.poemPage}>
      <Text style={styles.poemKicker} onLongPress={onLongPress} delayLongPress={450}>
        {kicker}
      </Text>
      {untitled ? null : (
        <Text
          style={styles.poemTitle}
          onLongPress={onLongPress}
          delayLongPress={450}
        >
          {title}
        </Text>
      )}
      <View style={styles.ornament} />
      <View style={styles.verse}>
        {stanzas.length ? (
          stanzas.map((stanza, i) => (
            <View key={i} style={styles.stanza}>
              {stanza.map((line, j) => (
                <Text key={j} style={styles.verseLine}>
                  {line}
                </Text>
              ))}
            </View>
          ))
        ) : (
          <Text style={styles.verseLine}>—</Text>
        )}
      </View>
      {themes.length ? (
        <Text style={styles.poemThemes}>
          {themes.map((t) => THEME_LABELS[t] ?? t).join(" · ")}
        </Text>
      ) : null}
      <Text style={styles.colophon}>
        {[item.creator_name, dated ? formatLocalDate(dated) : null]
          .filter(Boolean)
          .join("  ·  ")}
      </Text>
      {recite ? (
        <Pressable
          onPress={recite.onPress}
          disabled={recite.busy}
          style={[styles.reciteBtn, recite.busy && styles.reciteBtnBusy]}
        >
          <Text style={styles.reciteBtnText}>
            {recite.playing
              ? "⏸ Đang đọc…"
              : recite.busy
                ? "Đang chuẩn bị giọng…"
                : recite.label}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function MemoryReadModal({
  item,
  visible,
  onClose,
  photoUri,
  onOpenSource,
  onEdit,
  canEdit,
  canRecite,
  reciteLabel,
  reciting,
  playingRecite,
  onRecite,
}: Props) {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const translateY = useRef(new Animated.Value(0)).current;
  const closingRef = useRef(false);
  const openGen = useRef(0);
  const [backdropArmed, setBackdropArmed] = useState(false);
  const [photoOpen, setPhotoOpen] = useState(false);

  useEffect(() => {
    if (!visible || !item) {
      setBackdropArmed(false);
      setPhotoOpen(false);
      return;
    }
    const gen = ++openGen.current;
    closingRef.current = false;
    translateY.stopAnimation();
    translateY.setValue(0);
    setBackdropArmed(false);
    const arm = setTimeout(() => {
      if (openGen.current === gen) setBackdropArmed(true);
    }, 400);
    return () => clearTimeout(arm);
  }, [visible, item?.id, translateY, item]);

  const dismiss = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    setBackdropArmed(false);
    const gen = openGen.current;
    Animated.timing(translateY, {
      toValue: windowHeight,
      duration: 220,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (!finished || openGen.current !== gen) return;
      onClose();
    });
  }, [onClose, translateY, windowHeight]);

  const snapBack = useCallback(() => {
    Animated.spring(translateY, {
      toValue: 0,
      useNativeDriver: true,
      bounciness: 0,
    }).start();
  }, [translateY]);

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderMove: (_, g) => {
          translateY.setValue(Math.max(0, g.dy));
        },
        onPanResponderRelease: (_, g) => {
          if (g.dy > 48 || g.vy > 0.45) dismiss();
          else snapBack();
        },
        onPanResponderTerminate: snapBack,
      }),
    [dismiss, snapBack, translateY],
  );

  if (!item) {
    return (
      <Modal visible={false} transparent animationType="none" onRequestClose={onClose} />
    );
  }
  const isPoem = item.kind === "poem";
  const title = displayMemoryTitle(item.kind, item.title);
  const untitled = isGenericMemoryTitle(item.kind, item.title);
  const themes = themeFromTags(item.tags);
  const meter = meterFromTags(item.tags);
  const showTitle =
    item.kind !== "knowledge" ||
    (title.trim() && title.trim() !== item.body.trim());
  const editLongPress = canEdit && onEdit ? onEdit : undefined;

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={dismiss}>
      <View style={styles.backdrop}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={backdropArmed ? dismiss : undefined}
        />
        <Animated.View
          style={[
            styles.sheet,
            isPoem && styles.poemSheet,
            {
              height: Math.round(windowHeight * 0.92),
              paddingBottom: Math.max(insets.bottom, 20),
              transform: [{ translateY }],
            },
          ]}
        >
          <View style={styles.handleWrap} {...pan.panHandlers}>
            <View style={styles.handle} />
          </View>
          {!isPoem ? (
            <Text style={styles.kindInPage}>{kindLabel(item.kind)}</Text>
          ) : null}
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={[
              styles.scrollContent,
              isPoem && styles.poemScrollContent,
            ]}
            showsVerticalScrollIndicator={false}
            bounces
            alwaysBounceVertical
            keyboardShouldPersistTaps="handled"
            scrollEventThrottle={16}
            onScrollEndDrag={(e) => {
              if (e.nativeEvent.contentOffset.y < -50) dismiss();
            }}
          >
            {isPoem ? (
              <PoemReader
                item={item}
                onLongPress={editLongPress}
                recite={
                  canRecite && onRecite
                    ? {
                        label: reciteLabel || "Nghe đọc",
                        busy: Boolean(reciting),
                        playing: Boolean(playingRecite),
                        onPress: onRecite,
                      }
                    : undefined
                }
              />
            ) : (
                <>
                  {item.kind === "milestone" ? (
                    <Text style={styles.year}>
                      {calendarDateLabel(item.occurred_at, item.tags)}
                    </Text>
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
                          <Text style={styles.chipText}>
                            {meterLabel(meter) ?? meter}
                          </Text>
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
                    <Pressable onPress={() => setPhotoOpen(true)}>
                      <Image
                        source={{ uri: photoUri }}
                        style={styles.photo}
                        resizeMode="contain"
                      />
                      <Text style={styles.photoHint}>Chạm để xem đủ · tải về</Text>
                    </Pressable>
                  ) : null}
                  <Text style={styles.body}>{item.body.trim() || "—"}</Text>
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
                      {item.source_message_id &&
                      item.source_thread_id &&
                      onOpenSource ? (
                        <Pressable onPress={onOpenSource} hitSlop={8}>
                          <Text style={styles.sourceLink}>
                            Xem câu gốc trong trò chuyện →
                          </Text>
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
                </>
              )}
          </ScrollView>
        </Animated.View>
      </View>
      <PhotoLightbox
        uri={photoUri}
        visible={photoOpen}
        onClose={() => setPhotoOpen(false)}
      />
    </Modal>
  );
}

const styles = createThemedStyles((colors) => ({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(28, 36, 31, 0.45)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 4,
    overflow: "hidden",
  },
  poemSheet: {
    backgroundColor: "#f7f1e6",
  },
  handleWrap: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
    paddingTop: 8,
    paddingBottom: 10,
  },
  handle: {
    width: 48,
    height: 5,
    borderRadius: 3,
    backgroundColor: "rgba(28, 36, 31, 0.28)",
  },
  kindInPage: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.brandSoft,
    paddingHorizontal: 20,
    marginBottom: 4,
  },
  scroll: { flex: 1, paddingHorizontal: 20 },
  scrollContent: { paddingBottom: 24, gap: 12 },
  poemScrollContent: {
    paddingBottom: 36,
    paddingHorizontal: 8,
    gap: 0,
  },
  poemPage: {
    alignItems: "center",
    paddingTop: 8,
    paddingBottom: 16,
  },
  poemKicker: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1.6,
    textTransform: "uppercase",
    color: colors.accent,
    marginBottom: 16,
  },
  poemTitle: {
    fontFamily: fonts.display,
    fontSize: 28,
    lineHeight: 36,
    color: colors.ink,
    textAlign: "center",
    paddingHorizontal: 8,
  },
  ornament: {
    width: 48,
    height: 1,
    backgroundColor: colors.accent,
    marginTop: 18,
    marginBottom: 28,
    opacity: 0.85,
  },
  verse: {
    width: "100%",
    gap: 28,
    paddingHorizontal: 4,
  },
  stanza: { gap: 8 },
  verseLine: {
    fontFamily: fonts.display,
    fontSize: 19,
    lineHeight: 32,
    color: colors.ink,
    textAlign: "center",
  },
  poemThemes: {
    marginTop: 32,
    fontSize: 13,
    letterSpacing: 0.4,
    color: colors.inkSoft,
    textAlign: "center",
  },
  colophon: {
    marginTop: 14,
    fontSize: 13,
    color: colors.inkSoft,
    textAlign: "center",
  },
  reciteBtn: {
    marginTop: 28,
    backgroundColor: colors.brand,
    borderRadius: 999,
    paddingHorizontal: 22,
    paddingVertical: 12,
  },
  reciteBtnBusy: { opacity: 0.65 },
  reciteBtnText: {
    color: "#f4efe6",
    fontWeight: "700",
    fontSize: 16,
  },
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
  photo: {
    width: "100%",
    minHeight: 280,
    maxHeight: 480,
    aspectRatio: 3 / 4,
    borderRadius: 12,
    backgroundColor: colors.bgDeep,
  },
  photoHint: {
    marginTop: 8,
    fontSize: 13,
    fontWeight: "600",
    color: colors.brand,
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
}));
