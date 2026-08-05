import { MemoryCandidate, MemoryVisibility } from "@forever/api-client";
import { useLocalSearchParams } from "expo-router";
import { useCallback, useLayoutEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { useAuth } from "@/lib/auth";
import { useSpaceScreenOptions } from "@/lib/spaceHeader";
import { colors, fonts } from "@/lib/theme";

const KIND_LABELS: Record<string, string> = {
  life_state: "Hiện tại",
  event: "Việc đã xảy ra",
  preference: "Thói quen",
  relationship: "Quan hệ",
};

function isPrivate(item: MemoryCandidate): boolean {
  return item.audience_scope === "direct";
}

export default function ReviewScreen() {
  const { spaceId } = useLocalSearchParams<{ spaceId: string }>();
  const { api } = useAuth();
  const [items, setItems] = useState<MemoryCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useSpaceScreenOptions({
    spaceId: spaceId ?? undefined,
    title: "Điều nghe được",
    backTitle: "Nhà",
  });

  const load = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!spaceId) return;
      if (opts?.silent) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const res = await api.listMemoryCandidates(spaceId, "pending");
        setItems(res.candidates);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Không tải được.");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [api, spaceId],
  );

  useLayoutEffect(() => {
    load();
  }, [load]);

  const settle = useCallback(
    async (
      item: MemoryCandidate,
      keep: boolean,
      visibility: MemoryVisibility = "family",
    ) => {
      setBusyId(item.id);
      setError(null);
      try {
        if (keep) await api.approveMemoryCandidate(item.id, visibility);
        else await api.dismissMemoryCandidate(item.id);
        setItems((prev) => prev.filter((row) => row.id !== item.id));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Không lưu được.");
      } finally {
        setBusyId(null);
      }
    },
    [api],
  );

  const keep = useCallback(
    (item: MemoryCandidate) => {
      if (!isPrivate(item)) {
        settle(item, true);
        return;
      }
      // Said in a private room: keeping it and telling the family are two
      // different decisions, so the sentence must not make them one.
      Alert.alert(
        "Điều này nói riêng",
        "Bạn muốn giữ riêng cho mình, hay chia sẻ để cả nhà cùng đọc?",
        [
          { text: "Thôi", style: "cancel" },
          { text: "Giữ riêng", onPress: () => settle(item, true, "private") },
          {
            text: "Chia sẻ cả nhà",
            onPress: () => settle(item, true, "family"),
          },
        ],
      );
    },
    [settle],
  );

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }

  return (
    <FlatList
      style={styles.root}
      contentContainerStyle={styles.content}
      data={items}
      keyExtractor={(item) => item.id}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => load({ silent: true })}
          tintColor={colors.brand}
        />
      }
      ListHeaderComponent={
        <View style={styles.header}>
          <Text style={styles.title}>Điều nghe được từ trò chuyện</Text>
          <Text style={styles.sub}>
            Trò chuyện chỉ được đề xuất, không tự thêm vào tiểu sử. Bạn giữ lại
            thì điều đó vào Thư viện, và lần sau người ấy nhớ được.
          </Text>
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </View>
      }
      ListEmptyComponent={
        <Text style={styles.empty}>
          Chưa có gì chờ bạn duyệt. Cứ trò chuyện, những điều nhà mình kể sẽ hiện
          ở đây.
        </Text>
      }
      renderItem={({ item }) => {
        const itemBusy = busyId === item.id;
        return (
          <View style={styles.card}>
            <View style={styles.cardTop}>
              <Text style={styles.who}>{item.identity_name}</Text>
              <View style={styles.tag}>
                <Text style={styles.tagText}>
                  {KIND_LABELS[item.fact_kind] ?? "Ghi nhận"}
                </Text>
              </View>
            </View>

            <Text style={styles.statement}>{item.statement}</Text>
            {item.occurred_at ? (
              <Text style={styles.when}>Ngày: {item.occurred_at}</Text>
            ) : null}
            {item.source_body ? (
              <Text style={styles.source} numberOfLines={3}>
                “{item.source_body}”
              </Text>
            ) : null}
            {isPrivate(item) ? (
              <Text style={styles.privateNote}>
                Nói riêng — bạn chọn giữ riêng hay chia sẻ cả nhà.
              </Text>
            ) : null}

            <View style={styles.actions}>
              <Pressable
                style={[styles.keep, itemBusy && styles.disabled]}
                onPress={() => keep(item)}
                disabled={itemBusy}
              >
                <Text style={styles.keepText}>Giữ vào Thư viện</Text>
              </Pressable>
              <Pressable
                style={[styles.drop, itemBusy && styles.disabled]}
                onPress={() => settle(item, false)}
                disabled={itemBusy}
                hitSlop={6}
              >
                <Text style={styles.dropText}>Bỏ</Text>
              </Pressable>
            </View>
          </View>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 20, paddingBottom: 40 },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bg,
  },
  header: { gap: 6, marginBottom: 14 },
  title: { fontFamily: fonts.display, fontSize: 24, color: colors.ink },
  sub: { fontSize: 14, lineHeight: 20, color: colors.inkSoft },
  error: { fontSize: 13, color: "#b3261e", marginTop: 6 },
  empty: { fontSize: 14, lineHeight: 20, color: colors.inkSoft },
  card: {
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 14,
    gap: 8,
    marginBottom: 10,
  },
  cardTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  who: {
    flexShrink: 1,
    fontSize: 12,
    fontWeight: "700",
    color: colors.brand,
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  tag: {
    flexShrink: 0,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.bgDeep,
  },
  tagText: { fontSize: 11, fontWeight: "700", color: colors.ink },
  statement: {
    fontFamily: fonts.display,
    fontSize: 17,
    lineHeight: 25,
    color: colors.ink,
  },
  when: { fontSize: 13, color: colors.inkSoft },
  source: {
    fontSize: 13,
    lineHeight: 19,
    color: colors.inkSoft,
    fontStyle: "italic",
  },
  privateNote: { fontSize: 13, lineHeight: 19, color: "#8a5a00" },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginTop: 2,
  },
  keep: {
    flex: 1,
    backgroundColor: colors.brand,
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: "center",
  },
  keepText: { fontSize: 14, fontWeight: "700", color: "#fff" },
  drop: { paddingHorizontal: 10, paddingVertical: 11 },
  dropText: { fontSize: 14, fontWeight: "600", color: colors.inkSoft },
  disabled: { opacity: 0.5 },
});
