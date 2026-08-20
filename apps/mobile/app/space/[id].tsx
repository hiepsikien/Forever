import { FamilySpace, Keepsake, ThreadSummary } from "@forever/api-client";
import { useFocusEffect } from "@react-navigation/native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  Text,
  View,
} from "react-native";

import { useAuth } from "@/lib/auth";
import { markEnteredASpace } from "@/lib/homeSpace";
import {
  homePrivateRows,
  HomeThreadRow,
  isDirectThread,
  pickBaNoiFamilyRoom,
  pickFatherFamilyRoom,
} from "@/lib/homeThreads";
import { fetchAuthedMediaUri } from "@/lib/media";
import { reciteListenLabel, usePoemRecite } from "@/lib/poemRecite";
import { useSpaceScreenOptions } from "@/lib/spaceHeader";
import { colors, fonts, createThemedStyles } from "@/lib/theme";
import { PhotoLightbox } from "@/components/library/PhotoLightbox";

function threadPreview(item: ThreadSummary): string {
  const last = item.last_message;
  if (!last) return "Chưa có tin nhắn";
  if (last.kind === "voice") {
    const caption = (last.body || "").trim();
    return caption || "Tin nhắn thoại";
  }
  return last.body || "Chưa có tin nhắn";
}

function threadKindLabel(item: ThreadSummary): string | null {
  if (item.kind !== "heritage") return null;
  return isDirectThread(item) ? "Riêng" : "Cả nhà";
}

function threadRowMeta(item: ThreadSummary): { preview: string; cta: string; callReady?: boolean } {
  if (item.kind === "heritage" && item.heritage) {
    const h = item.heritage;
    if (h.chat_ready) {
      if (item.last_message) {
        return {
          preview: threadPreview(item),
          cta: "Gọi bằng giọng →",
          callReady: true,
        };
      }
      if (isDirectThread(item)) {
        return {
          preview: "Chỉ bạn đọc được — không ai khác trong nhà thấy",
          cta: "Nói riêng bằng giọng →",
          callReady: true,
        };
      }
      return {
        preview: "Sẵn sàng trò chuyện — bấm để gọi bằng giọng",
        cta: "Gọi bằng giọng →",
        callReady: true,
      };
    }
    return {
      preview: `Giọng ${h.voice_ready ? "✓" : "…"} · Neo ${h.knowledge_count}/${h.knowledge_target}${h.profile_ready ? " · Bản sắc ✓" : " · Bản sắc …"} — chưa thể chat`,
      cta:
        h.entity_status === "dormant"
          ? "Bắt đầu thổi hồn →"
          : h.entity_status === "paused"
            ? "Đã tạm dừng — mở Thổi hồn →"
            : "Tiếp tục thổi hồn →",
    };
  }
  if (!item.last_message) {
    return {
      preview: "Chưa có tin nhắn — gửi lời chào",
      cta: "Bắt đầu chat →",
    };
  }
  return { preview: threadPreview(item), cta: "Vào trò chuyện →" };
}

export default function SpaceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api, user } = useAuth();
  const router = useRouter();
  const [space, setSpace] = useState<FamilySpace | null>(null);
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [keepsake, setKeepsake] = useState<Keepsake | null>(null);
  const [keepsakeUri, setKeepsakeUri] = useState<string | null>(null);
  const [keepsakeBusy, setKeepsakeBusy] = useState(false);
  const [keepsakeOpen, setKeepsakeOpen] = useState(false);
  const [keepsakePhotoOpen, setKeepsakePhotoOpen] = useState(false);
  const [heardByIdentity, setHeardByIdentity] = useState<Record<string, number>>(
    {},
  );
  const [error, setError] = useState<string | null>(null);
  const recite = usePoemRecite();
  const spaceRef = useRef<FamilySpace | null>(null);
  spaceRef.current = space;

  const load = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!id) return;
      const silent = opts?.silent === true;
      if (silent) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const [spaceRes, threadRes] = await Promise.all([
          api.getSpace(id),
          api.listThreads(id),
        ]);
        setSpace(spaceRes);
        setThreads(threadRes.threads);
        // A quiet extra: an empty review queue must not break the home screen.
        try {
          const pending = await api.listMemoryCandidates(id, "pending");
          setPendingCount(pending.candidates.length);
        } catch {
          setPendingCount(0);
        }
        try {
          const today = await api.keepsakeToday(id);
          setKeepsake(today.keepsake);
        } catch {
          setKeepsake(null);
        }
        try {
          const mem = await api.listMemories(id);
          const counts: Record<string, number> = {};
          for (const m of mem.memories) {
            if (m.kind !== "knowledge" || m.visibility === "private") continue;
            const tags = m.tags || "";
            const seen = new Set<string>();
            for (const match of tags.matchAll(/heritage:([0-9a-f-]{36})/gi)) {
              const hid = match[1];
              if (seen.has(hid)) continue;
              seen.add(hid);
              counts[hid] = (counts[hid] || 0) + 1;
            }
          }
          setHeardByIdentity(counts);
        } catch {
          setHeardByIdentity({});
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Không tải được.");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [api, id],
  );

  useFocusEffect(
    useCallback(() => {
      // Returning from "Điều nghe được" must refresh the badge — the queue
      // changed while this screen stayed mounted under the review screen.
      void load({ silent: Boolean(spaceRef.current) });
    }, [load]),
  );

  useEffect(() => {
    if (user?.id) void markEnteredASpace(user.id);
  }, [user?.id]);

  useSpaceScreenOptions({
    spaceId: id,
    title: space?.name ?? "Gia đình",
    backTitle: "Forever",
    showSettings: true,
  });

  const openLibrary = useCallback(() => {
    if (!id) return;
    router.push(`/library/${id}`);
  }, [id, router]);

  const fatherFamily = useMemo(
    () => pickFatherFamilyRoom(threads),
    [threads],
  );
  const baNoiFamily = useMemo(
    () => pickBaNoiFamilyRoom(threads),
    [threads],
  );
  const fatherId = fatherFamily?.heritage?.identity_id ?? null;
  const baNoiId = baNoiFamily?.heritage?.identity_id ?? null;
  const fatherHeard = fatherId ? heardByIdentity[fatherId] || 0 : 0;
  const baNoiHeard = baNoiId ? heardByIdentity[baNoiId] || 0 : 0;
  const showHeardSection = fatherHeard > 0 || baNoiHeard > 0;

  const privateThreads = useMemo(
    () => homePrivateRows(threads),
    [threads],
  );

  useEffect(() => {
    if (!keepsake?.has_media || !keepsake.memory_item_id) {
      setKeepsakeUri(null);
      return;
    }
    let live = true;
    fetchAuthedMediaUri(
      api.memoryMediaUrl(keepsake.memory_item_id),
      `keepsake-${keepsake.id}`,
      keepsake.media_mime,
    )
      .then((uri) => {
        if (live) setKeepsakeUri(uri);
      })
      .catch(() => {
        if (live) setKeepsakeUri(null);
      });
    return () => {
      live = false;
    };
  }, [api, keepsake]);

  const talkKeepsake = async () => {
    if (!keepsake || keepsake.kind !== "photo") return;
    setKeepsakeBusy(true);
    setError(null);
    try {
      const threadId = keepsake.thread_id;
      if (threadId) {
        router.push(`/call/${threadId}` as never);
        void api.openKeepsake(keepsake.id).catch(() => undefined);
      } else {
        const opened = await api.openKeepsake(keepsake.id);
        router.push(`/call/${opened.thread_id}` as never);
      }
      void load({ silent: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không mở được hiện vật.");
    } finally {
      setKeepsakeBusy(false);
    }
  };

  const skipKeepsake = async () => {
    if (!keepsake?.can_skip) return;
    setKeepsakeBusy(true);
    setError(null);
    try {
      const res = await api.skipKeepsake(keepsake.id);
      setKeepsake(res.next);
      setKeepsakeUri(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không bỏ được tấm này.");
    } finally {
      setKeepsakeBusy(false);
    }
  };

  const openThread = async (item: HomeThreadRow) => {
    if (
      item.kind === "heritage" &&
      item.heritage &&
      !item.heritage.chat_ready &&
      id
    ) {
      router.push(
        `/awakening/${id}?identityId=${item.heritage.identity_id}` as never,
      );
      return;
    }
    if (item.pendingDirectFor && id) {
      try {
        const thread = await api.openDirectHeritageThread(
          id,
          item.pendingDirectFor,
        );
        // Mẹ vào nói chuyện trước — chat chữ vẫn mở được từ màn gọi.
        router.push(`/call/${thread.id}`);
        load({ silent: true });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Không mở được phòng riêng.");
      }
      return;
    }
    if (item.kind === "heritage" && item.heritage?.chat_ready) {
      router.push(`/call/${item.id}`);
      return;
    }
    router.push(`/chat/${item.id}`);
  };

  const renderHeader = () => (
    <View style={styles.headerBlock}>
      <Text style={styles.meta}>
        {space?.member_count ?? 0} thành viên
        {space?.role === "owner" ? " · Bạn quản trị" : ""}
      </Text>

      {keepsake ? (
        <View style={styles.keepsake}>
          <Text style={styles.keepsakeKicker}>
            {keepsake.kind === "poem"
              ? "Nhắc lại kỷ niệm · Thơ"
              : keepsake.heard
                ? "Nhắc lại kỷ niệm · Đã kể hôm nay"
                : "Nhắc lại kỷ niệm"}
          </Text>
          {keepsake.kind === "photo" && keepsake.heard ? (
            <Pressable
              onPress={() => setKeepsakeOpen((v) => !v)}
              accessibilityRole="button"
              accessibilityLabel={
                keepsakeOpen ? "Thu gọn ảnh đã kể" : "Xem ảnh đã kể hôm nay"
              }
            >
              {keepsakeOpen ? (
                <>
                  {keepsakeUri ? (
                    <Pressable
                      onPress={(e) => {
                        e.stopPropagation?.();
                        setKeepsakePhotoOpen(true);
                      }}
                    >
                      <Image
                        source={{ uri: keepsakeUri }}
                        style={styles.keepsakePhoto}
                        resizeMode="contain"
                      />
                      <Text style={styles.keepsakePhotoHint}>Chạm để xem đủ · tải về</Text>
                    </Pressable>
                  ) : null}
                  <Text style={styles.keepsakeTitle}>
                    {keepsake.title || keepsake.body || "Hiện vật"}
                  </Text>
                  <View style={styles.keepsakeActions}>
                    <Pressable
                      style={[styles.keepsakeTalk, keepsakeBusy && styles.keepsakeDisabled]}
                      onPress={() => void talkKeepsake()}
                      disabled={keepsakeBusy}
                    >
                      <Text style={styles.keepsakeTalkText}>Nói thêm →</Text>
                    </Pressable>
                    <Text style={styles.keepsakeSkip}>Thu gọn</Text>
                  </View>
                </>
              ) : (
                <View style={styles.keepsakeSettledRow}>
                  {keepsakeUri ? (
                    <Image source={{ uri: keepsakeUri }} style={styles.keepsakeThumb} />
                  ) : null}
                  <View style={styles.keepsakeSettledCopy}>
                    <Text style={styles.keepsakeSettledHint}>Chạm để xem ảnh</Text>
                    <View style={styles.keepsakeActions}>
                      <Pressable
                        style={[styles.keepsakeTalk, keepsakeBusy && styles.keepsakeDisabled]}
                        onPress={() => void talkKeepsake()}
                        disabled={keepsakeBusy}
                      >
                        <Text style={styles.keepsakeTalkText}>Nói thêm →</Text>
                      </Pressable>
                      {keepsake.can_skip ? (
                        <Pressable
                          onPress={() => void skipKeepsake()}
                          disabled={keepsakeBusy}
                          hitSlop={8}
                        >
                          <Text style={styles.keepsakeSkip}>Skip</Text>
                        </Pressable>
                      ) : null}
                    </View>
                  </View>
                </View>
              )}
            </Pressable>
          ) : null}
          {keepsake.kind === "photo" && !keepsake.heard ? (
            <>
              {keepsakeUri ? (
                <Pressable onPress={() => setKeepsakePhotoOpen(true)}>
                  <Image
                    source={{ uri: keepsakeUri }}
                    style={styles.keepsakePhoto}
                    resizeMode="contain"
                  />
                  <Text style={styles.keepsakePhotoHint}>Chạm để xem đủ · tải về</Text>
                </Pressable>
              ) : null}
              <Text style={styles.keepsakeTitle} numberOfLines={3}>
                {keepsake.title || keepsake.body || "Hiện vật"}
              </Text>
              <View style={styles.keepsakeActions}>
                <Pressable
                  style={[styles.keepsakeTalk, keepsakeBusy && styles.keepsakeDisabled]}
                  onPress={() => void talkKeepsake()}
                  disabled={keepsakeBusy}
                >
                  <Text style={styles.keepsakeTalkText}>Nói chuyện →</Text>
                </Pressable>
                {keepsake.can_skip ? (
                  <Pressable
                    onPress={() => void skipKeepsake()}
                    disabled={keepsakeBusy}
                    hitSlop={8}
                  >
                    <Text style={styles.keepsakeSkip}>Skip</Text>
                  </Pressable>
                ) : null}
              </View>
            </>
          ) : null}
          {keepsake.kind === "poem" ? (
            <>
              {keepsake.body ? (
                <Text style={styles.keepsakeBody} numberOfLines={4}>
                  {keepsake.body}
                </Text>
              ) : null}
              <View style={styles.keepsakeActions}>
                <Pressable
                  style={[
                    styles.keepsakeTalk,
                    (keepsakeBusy ||
                      recite.busyId === keepsake.memory_item_id) &&
                      styles.keepsakeDisabled,
                  ]}
                  onPress={() =>
                    void recite.play(
                      keepsake.memory_item_id,
                      keepsake.identity_id,
                    )
                  }
                  disabled={
                    keepsakeBusy || recite.busyId === keepsake.memory_item_id
                  }
                >
                  <Text style={styles.keepsakeTalkText}>
                    {recite.playingId === keepsake.memory_item_id
                      ? "⏸ Đang đọc…"
                      : recite.busyId === keepsake.memory_item_id
                        ? "Đang chuẩn bị…"
                        : reciteListenLabel(keepsake.identity_relation)}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() =>
                    id &&
                    router.push(
                      `/library/${id}/person/${keepsake.identity_id}` as never,
                    )
                  }
                >
                  <Text style={styles.keepsakeTalkTextAlt}>
                    Đọc trong Thư viện →
                  </Text>
                </Pressable>
              </View>
            </>
          ) : null}
        </View>
      ) : null}

      {fatherFamily ? (
        <Pressable
          style={
            fatherFamily.heritage?.chat_ready ? styles.hero : styles.heroMuted
          }
          onPress={() => openThread(fatherFamily)}
        >
          <Text
            style={
              fatherFamily.heritage?.chat_ready
                ? styles.heroKicker
                : styles.heroKickerMuted
            }
          >
            Bố (Cả nhà)
          </Text>
          <Text
            style={
              fatherFamily.heritage?.chat_ready
                ? styles.heroPreview
                : styles.heroPreviewMuted
            }
            numberOfLines={2}
          >
            {threadRowMeta(fatherFamily).preview}
          </Text>
          <Text
            style={
              fatherFamily.heritage?.chat_ready
                ? styles.heroCta
                : styles.threadCta
            }
          >
            {threadRowMeta(fatherFamily).cta}
          </Text>
        </Pressable>
      ) : (
        <View style={styles.heroMuted}>
          <Text style={styles.heroKickerMuted}>Bố (Cả nhà)</Text>
          <Text style={styles.heroPreviewMuted}>
            Chưa có phòng trò chuyện với bố.
          </Text>
        </View>
      )}

      {baNoiFamily?.heritage?.chat_ready ? (
        <Pressable
          style={styles.familyCard}
          onPress={() => openThread(baNoiFamily)}
        >
          <Text style={styles.familyCardKicker}>Bà Nội (Cả nhà)</Text>
          <Text style={styles.threadPreview} numberOfLines={2}>
            {threadRowMeta(baNoiFamily).preview}
          </Text>
          <Text style={styles.threadCta}>{threadRowMeta(baNoiFamily).cta}</Text>
        </Pressable>
      ) : null}

      <Pressable style={styles.libraryGate} onPress={() => void openLibrary()}>
        <Text style={styles.libraryKicker}>Két sắt ký ức</Text>
        <Text style={styles.libraryTitle}>Thư viện</Text>
        <Text style={styles.librarySub}>
          Thơ, hiện vật và những điều nghe được — giữ lại cho cả nhà.
        </Text>
        <Text style={styles.libraryCta}>Vào Thư viện →</Text>
      </Pressable>

      {pendingCount > 0 ? (
        <Pressable
          style={styles.reviewBanner}
          onPress={() => id && router.push(`/review/${id}`)}
        >
          <Text style={styles.reviewTitle}>
            {pendingCount} điều nghe được, chờ bạn duyệt
          </Text>
          <Text style={styles.reviewSub}>
            Trò chuyện đề xuất — bạn giữ lại thì mới vào Thư viện →
          </Text>
        </Pressable>
      ) : null}

      {showHeardSection ? (
        <>
          <Text style={styles.memoryLabel}>Điều nghe được</Text>
          <View style={styles.memoryCol}>
            {fatherHeard > 0 && fatherId ? (
              <Pressable
                style={styles.heardRow}
                onPress={() =>
                  id &&
                  router.push(
                    `/library/${id}/person/${fatherId}?shelf=heard` as never,
                  )
                }
              >
                <Text style={styles.heardTitle}>Điều nghe được về bố</Text>
                <Text style={styles.heardSub}>{fatherHeard} món →</Text>
              </Pressable>
            ) : null}
            {baNoiHeard > 0 && baNoiId ? (
              <Pressable
                style={styles.heardRow}
                onPress={() =>
                  id &&
                  router.push(
                    `/library/${id}/person/${baNoiId}?shelf=heard` as never,
                  )
                }
              >
                <Text style={styles.heardTitle}>Điều nghe được về bà Nội</Text>
                <Text style={styles.heardSub}>{baNoiHeard} món →</Text>
              </Pressable>
            ) : null}
          </View>
        </>
      ) : null}

      <Text style={styles.memoryLabel}>Lịch & giọng & đọc</Text>
      <View style={styles.memoryRow}>
        <Pressable
          style={styles.memoryTile}
          onPress={() => id && router.push(`/library/${id}/calendar` as never)}
        >
          <Text style={styles.memoryTitle}>Lịch gia đình</Text>
          <Text style={styles.memorySub}>Ngày · giỗ · mốc</Text>
        </Pressable>
        {fatherId ? (
          <Pressable
            style={styles.memoryTile}
            onPress={() =>
              id &&
              router.push(
                `/library/${id}/person/${fatherId}?shelf=poems` as never,
              )
            }
          >
            <Text style={styles.memoryTitle}>Nghe bố đọc thơ</Text>
            <Text style={styles.memorySub}>Thơ trong Thư viện</Text>
          </Pressable>
        ) : null}
        {baNoiId ? (
          <Pressable
            style={styles.memoryTile}
            onPress={() =>
              id && router.push(`/stories/${id}/${baNoiId}` as never)
            }
          >
            <Text style={styles.memoryTitle}>Nghe bà kể chuyện</Text>
            <Text style={styles.memorySub}>Truyện · kinh</Text>
          </Pressable>
        ) : null}
        <Pressable
          style={styles.memoryTile}
          onPress={() => id && router.push(`/interview/${id}`)}
        >
          <Text style={styles.memoryTitle}>Time Capsule</Text>
          <Text style={styles.memorySub}>Câu hỏi cội nguồn</Text>
        </Pressable>
        <Pressable
          style={styles.memoryTile}
          onPress={() => id && router.push(`/voice/${id}`)}
        >
          <Text style={styles.memoryTitle}>Voice DNA</Text>
          <Text style={styles.memorySub}>Giọng & TTS</Text>
        </Pressable>
      </View>

      <Text style={styles.section}>
        {privateThreads.length
          ? "Các cuộc trò chuyện khác"
          : "Cuộc trò chuyện riêng"}
      </Text>
      {!privateThreads.length ? (
        <Text style={styles.emptyHint}>
          Phòng riêng với bố và bà Nội hiện khi mỗi người đã sẵn sàng trò chuyện.
        </Text>
      ) : null}
    </View>
  );

  if (loading && !space) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }

  return (
    <>
    <FlatList
      style={styles.list}
      contentContainerStyle={styles.listContent}
      data={privateThreads}
      keyExtractor={(item) => item.id}
      ListHeaderComponent={renderHeader}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => load({ silent: true })}
          tintColor={colors.brand}
        />
      }
      renderItem={({ item }) => {
        const badge = threadKindLabel(item);
        const meta = threadRowMeta(item);
        return (
          <Pressable style={styles.thread} onPress={() => openThread(item)}>
            <View style={styles.threadTop}>
              <Text style={styles.threadTitle}>{item.title}</Text>
              {badge ? (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{badge}</Text>
                </View>
              ) : null}
            </View>
            <Text style={styles.threadPreview} numberOfLines={2}>
              {meta.preview}
            </Text>
            <View style={styles.threadActions}>
              <Text style={styles.threadCta}>{meta.cta}</Text>
              {meta.callReady && !item.pendingDirectFor ? (
                <Pressable
                  onPress={(e) => {
                    e.stopPropagation?.();
                    router.push(`/chat/${item.id}`);
                  }}
                  hitSlop={8}
                >
                  <Text style={styles.callCta}>Xem chữ →</Text>
                </Pressable>
              ) : null}
            </View>
          </Pressable>
        );
      }}
      ListEmptyComponent={null}
      ListFooterComponent={
        error ? <Text style={styles.error}>{error}</Text> : null
      }
    />
    <PhotoLightbox
      uri={keepsakeUri}
      visible={keepsakePhotoOpen}
      onClose={() => setKeepsakePhotoOpen(false)}
    />
    </>
  );
}

const styles = createThemedStyles((colors) => ({
  list: { flex: 1, backgroundColor: colors.bg },
  listContent: { padding: 20, paddingBottom: 40 },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bg,
  },
  headerBtn: { marginRight: 4, paddingVertical: 4, paddingHorizontal: 2 },
  headerBtnText: { color: colors.brand, fontWeight: "600", fontSize: 16 },
  headerBlock: { gap: 12, marginBottom: 4 },
  meta: { color: colors.inkSoft, fontSize: 14 },
  hero: {
    backgroundColor: colors.brand,
    borderRadius: 16,
    padding: 18,
    gap: 6,
  },
  keepsake: {
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 16,
    gap: 8,
    borderWidth: 1,
    borderColor: colors.line,
  },
  keepsakeKicker: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.inkSoft,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  keepsakePhoto: {
    width: "100%",
    minHeight: 240,
    aspectRatio: 3 / 4,
    borderRadius: 12,
    backgroundColor: colors.line,
  },
  keepsakePhotoHint: {
    marginTop: 8,
    fontSize: 13,
    fontWeight: "600",
    color: colors.brand,
  },
  keepsakeSettledRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  keepsakeThumb: {
    width: 56,
    height: 56,
    borderRadius: 8,
    backgroundColor: colors.line,
  },
  keepsakeSettledCopy: {
    flex: 1,
    minWidth: 0,
    gap: 8,
  },
  keepsakeSettledHint: {
    fontSize: 14,
    color: colors.inkSoft,
  },
  keepsakeTitle: {
    fontFamily: fonts.display,
    fontSize: 20,
    lineHeight: 26,
    color: colors.ink,
  },
  keepsakeBody: {
    fontSize: 15,
    lineHeight: 22,
    color: colors.inkSoft,
  },
  keepsakeActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    marginTop: 4,
  },
  keepsakeTalk: {
    backgroundColor: colors.brand,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  keepsakeTalkText: { color: "#f4efe6", fontWeight: "700", fontSize: 16 },
  keepsakeTalkTextAlt: { color: colors.brand, fontWeight: "700", fontSize: 16 },
  keepsakeSkip: { color: colors.inkSoft, fontSize: 16, fontWeight: "600" },
  keepsakeDisabled: { opacity: 0.5 },
  heroMuted: {
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 18,
    gap: 6,
    borderWidth: 1,
    borderColor: colors.line,
  },
  heroKicker: {
    fontSize: 12,
    fontWeight: "700",
    color: "rgba(244, 239, 230, 0.85)",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  heroKickerMuted: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.inkSoft,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  heroPreview: {
    fontFamily: fonts.display,
    fontSize: 20,
    lineHeight: 28,
    color: "#f4efe6",
  },
  heroPreviewMuted: {
    fontFamily: fonts.display,
    fontSize: 18,
    lineHeight: 26,
    color: colors.inkSoft,
  },
  heroCta: {
    marginTop: 4,
    fontSize: 15,
    fontWeight: "700",
    color: "#f4efe6",
  },
  reviewBanner: {
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.brand,
    padding: 14,
    gap: 4,
    marginTop: 4,
  },
  reviewTitle: { fontSize: 15, fontWeight: "700", color: colors.ink },
  reviewSub: { fontSize: 13, lineHeight: 19, color: colors.inkSoft },
  libraryGate: {
    backgroundColor: colors.bgDeep,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    paddingVertical: 18,
    paddingHorizontal: 16,
    gap: 6,
    marginTop: 4,
  },
  libraryKicker: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.brandSoft,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  libraryTitle: {
    fontFamily: fonts.display,
    fontSize: 26,
    color: colors.ink,
  },
  librarySub: {
    fontSize: 14,
    lineHeight: 21,
    color: colors.inkSoft,
  },
  libraryCta: {
    marginTop: 4,
    fontSize: 15,
    fontWeight: "700",
    color: colors.brand,
  },
  familyCard: {
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 16,
    gap: 6,
    borderWidth: 1,
    borderColor: colors.line,
  },
  familyCardKicker: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.inkSoft,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  memoryLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.inkSoft,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginTop: 4,
  },
  memoryCol: { gap: 8 },
  heardRow: {
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    paddingVertical: 14,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  heardTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: "600",
    color: colors.ink,
  },
  heardSub: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.brand,
  },
  memoryRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  memoryTile: {
    flexBasis: "47%",
    flexGrow: 1,
    backgroundColor: colors.card,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: "center",
    gap: 4,
  },
  memoryTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.ink,
    textAlign: "center",
  },
  memorySub: {
    fontSize: 11,
    color: colors.inkSoft,
    textAlign: "center",
    lineHeight: 14,
  },
  section: {
    fontFamily: fonts.display,
    fontSize: 22,
    color: colors.ink,
    marginTop: 8,
  },
  emptyHint: {
    fontSize: 13,
    color: colors.inkSoft,
    lineHeight: 18,
    marginBottom: 4,
  },
  thread: {
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.line,
  },
  threadTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  threadTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: "600",
    color: colors.ink,
  },
  badge: {
    backgroundColor: "#f7f1e6",
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: "rgba(196, 165, 116, 0.45)",
  },
  badgeText: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.accent,
  },
  threadPreview: { marginTop: 6, color: colors.inkSoft, lineHeight: 20 },
  threadCta: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.brand,
  },
  threadActions: {
    marginTop: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    flexWrap: "wrap",
  },
  callCta: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.brandSoft,
  },
  empty: { color: colors.inkSoft, lineHeight: 22, marginTop: 4 },
  error: { color: colors.danger, marginTop: 12 },
}));
