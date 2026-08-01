import { FamilySpace, ThreadSummary } from "@forever/api-client";
import { useNavigation } from "@react-navigation/native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useLayoutEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { useAuth } from "@/lib/auth";
import { colors, fonts } from "@/lib/theme";

function threadPreview(item: ThreadSummary): string {
  const last = item.last_message;
  if (!last) return "Chưa có tin nhắn";
  if (last.kind === "voice") return "Tin nhắn thoại";
  return last.body || "Chưa có tin nhắn";
}

function threadKindLabel(kind: string): string | null {
  if (kind === "heritage") return "Ký ức";
  return null;
}

export default function SpaceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api } = useAuth();
  const router = useRouter();
  const navigation = useNavigation();
  const [space, setSpace] = useState<FamilySpace | null>(null);
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      } catch (e) {
        setError(e instanceof Error ? e.message : "Không tải được.");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [api, id],
  );

  useLayoutEffect(() => {
    load();
  }, [load]);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: space?.name ?? "Gia đình",
      headerRight: () => (
        <Pressable
          onPress={() => id && router.push(`/settings/${id}`)}
          hitSlop={8}
          style={styles.headerBtn}
        >
          <Text style={styles.headerBtnText}>Cài đặt</Text>
        </Pressable>
      ),
    });
  }, [navigation, space?.name, id, router]);

  const familyThread = useMemo(
    () => threads.find((t) => t.kind === "family") ?? null,
    [threads],
  );

  const otherThreads = useMemo(
    () =>
      familyThread
        ? threads.filter((t) => t.id !== familyThread.id)
        : threads,
    [threads, familyThread],
  );

  const openThread = (threadId: string) => {
    router.push(`/chat/${threadId}`);
  };

  const renderHeader = () => (
    <View style={styles.headerBlock}>
      <Text style={styles.meta}>
        {space?.member_count ?? 0} thành viên
        {space?.role === "owner" ? " · Bạn quản trị" : ""}
      </Text>

      {familyThread ? (
        <Pressable
          style={styles.hero}
          onPress={() => openThread(familyThread.id)}
        >
          <Text style={styles.heroKicker}>Phòng khách</Text>
          <Text style={styles.heroPreview} numberOfLines={2}>
            {threadPreview(familyThread)}
          </Text>
          <Text style={styles.heroCta}>Vào trò chuyện →</Text>
        </Pressable>
      ) : (
        <View style={styles.heroMuted}>
          <Text style={styles.heroKickerMuted}>Phòng khách</Text>
          <Text style={styles.heroPreviewMuted}>Chưa có cuộc trò chuyện chung.</Text>
        </View>
      )}

      <Text style={styles.memoryLabel}>Ký ức & giọng</Text>
      <View style={styles.memoryRow}>
        <Pressable
          style={styles.memoryTile}
          onPress={() => id && router.push(`/library/${id}`)}
        >
          <Text style={styles.memoryTitle}>Thư viện</Text>
          <Text style={styles.memorySub}>Ảnh, ghi chú</Text>
        </Pressable>
        <Pressable
          style={styles.memoryTile}
          onPress={() => id && router.push(`/interview/${id}`)}
        >
          <Text style={styles.memoryTitle}>Time-Capsule</Text>
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
        {otherThreads.length ? "Cuộc trò chuyện khác" : "Cuộc trò chuyện"}
      </Text>
      {!otherThreads.length && familyThread ? (
        <Text style={styles.emptyHint}>
          Các phòng Ký ức (người thân) sẽ hiện ở đây khi được tạo.
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
    <FlatList
      style={styles.list}
      contentContainerStyle={styles.listContent}
      data={otherThreads}
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
        const badge = threadKindLabel(item.kind);
        return (
          <Pressable style={styles.thread} onPress={() => openThread(item.id)}>
            <View style={styles.threadTop}>
              <Text style={styles.threadTitle}>{item.title}</Text>
              {badge ? (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{badge}</Text>
                </View>
              ) : null}
            </View>
            <Text style={styles.threadPreview} numberOfLines={2}>
              {threadPreview(item)}
            </Text>
          </Pressable>
        );
      }}
      ListEmptyComponent={
        !familyThread ? (
          <Text style={styles.empty}>Chưa có cuộc trò chuyện nào.</Text>
        ) : null
      }
      ListFooterComponent={
        error ? <Text style={styles.error}>{error}</Text> : null
      }
    />
  );
}

const styles = StyleSheet.create({
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
  memoryLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.inkSoft,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginTop: 4,
  },
  memoryRow: { flexDirection: "row", gap: 8 },
  memoryTile: {
    flex: 1,
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
  empty: { color: colors.inkSoft, lineHeight: 22, marginTop: 4 },
  error: { color: colors.danger, marginTop: 12 },
});
