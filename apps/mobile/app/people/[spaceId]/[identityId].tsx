import { IdentityProfile, MemoryItem, ThreadSummary } from "@forever/api-client";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  Text,
  View,
} from "react-native";

import { useAuth } from "@/lib/auth";
import { identityHandle } from "@/lib/handles";
import { identityChipLabel } from "@/lib/identityDisplay";
import { memoriesForPerson } from "@/lib/libraryShelves";
import { displayMemoryTitle } from "@/lib/memoryDisplay";
import { useSpaceScreenOptions } from "@/lib/spaceHeader";
import { fonts, createThemedStyles } from "@/lib/theme";

export default function LivingPersonProfileScreen() {
  const { spaceId, identityId } = useLocalSearchParams<{
    spaceId: string;
    identityId: string;
  }>();
  const { api, user } = useAuth();
  const router = useRouter();
  const [person, setPerson] = useState<IdentityProfile | null>(null);
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const title = person ? identityChipLabel(person, user?.id) : "Thành viên";
  const handle = person ? identityHandle(person) : null;

  useSpaceScreenOptions({
    spaceId,
    title,
    backTitle: "Thư viện",
  });

  const load = useCallback(async () => {
    if (!spaceId || !identityId) return;
    setError(null);
    try {
      const [idRes, thrRes, memRes] = await Promise.all([
        api.listIdentities(spaceId),
        api.listThreads(spaceId),
        api.listMemories(spaceId),
      ]);
      const found =
        idRes.identities.find((i) => i.id === identityId) ?? null;
      setPerson(found);
      setThreads(thrRes.threads ?? []);
      setMemories(memRes.memories ?? []);
      if (found?.status === "remembered") {
        router.replace(`/library/${spaceId}/person/${identityId}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tải được.");
    } finally {
      setLoading(false);
    }
  }, [api, identityId, router, spaceId]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  const tagged = useMemo(
    () => (identityId ? memoriesForPerson(memories, identityId) : []),
    [memories, identityId],
  );

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#8b6914" />
      </View>
    );
  }

  if (!person) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error ?? "Không tìm thấy người này."}</Text>
      </View>
    );
  }

  const heritageThread = threads.find(
    (t) =>
      t.kind === "heritage" &&
      t.heritage?.identity_id === person.id &&
      t.audience_scope === "family",
  );
  const directThread = threads.find(
    (t) =>
      t.kind === "heritage" &&
      t.heritage?.identity_id === person.id &&
      t.audience_scope === "direct",
  );

  return (
    <View style={styles.root}>
      <FlatList
        data={tagged}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View style={styles.headerBlock}>
            <View style={styles.hero}>
              <Text style={styles.kicker}>Đang sống</Text>
              <Text style={styles.name}>
                {identityChipLabel(person, user?.id)}
              </Text>
              {handle ? <Text style={styles.handle}>@{handle}</Text> : null}
              {person.relation_label &&
              person.relation_label.trim().toLowerCase() !== "tôi" ? (
                <Text style={styles.relation}>{person.relation_label}</Text>
              ) : null}
              <Text style={styles.blurb}>
                Trang nhẹ — ký ức cả nhà đã neo về người này. Thư viện đầy đủ
                nằm ở không gian chung và người được nhớ.
              </Text>
            </View>

            {heritageThread?.heritage?.chat_ready ? (
              <Pressable
                style={styles.action}
                onPress={() => router.push(`/call/${heritageThread.id}`)}
              >
                <Text style={styles.actionTitle}>Gọi / trò chuyện</Text>
                <Text style={styles.actionSub}>
                  Mở phòng với {person.display_name}
                </Text>
              </Pressable>
            ) : null}

            {directThread ? (
              <Pressable
                style={styles.action}
                onPress={() => router.push(`/chat/${directThread.id}`)}
              >
                <Text style={styles.actionTitle}>Phòng riêng</Text>
                <Text style={styles.actionSub}>
                  Trò chuyện riêng với người này
                </Text>
              </Pressable>
            ) : null}

            <Pressable
              style={styles.action}
              onPress={() => spaceId && router.push(`/library/${spaceId}`)}
            >
              <Text style={styles.actionTitle}>Thư viện chung</Text>
              <Text style={styles.actionSub}>Lịch gia đình và cả nhà</Text>
            </Pressable>

            <Text style={styles.sectionTitle}>
              Ký ức đã neo · {tagged.length}
            </Text>
          </View>
        }
        ListEmptyComponent={
          <Text style={styles.empty}>
            Chưa có món nào neo về người này. Thêm từ Thư viện và chọn tag.
          </Text>
        }
        renderItem={({ item }) => (
          <Pressable
            style={styles.memoryRow}
            onPress={() => {
              if (!spaceId) return;
              // Open family hub — light page has no full reader; memorial path N/A.
              router.push(`/library/${spaceId}`);
            }}
          >
            <Text style={styles.memoryKind}>{item.kind}</Text>
            <Text style={styles.memoryTitle} numberOfLines={2}>
              {displayMemoryTitle(item.kind, item.title ?? "")}
            </Text>
          </Pressable>
        )}
        ListFooterComponent={
          error ? <Text style={styles.error}>{error}</Text> : null
        }
      />
    </View>
  );
}

const styles = createThemedStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.bg },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bg,
    padding: 20,
  },
  list: { padding: 20, paddingBottom: 40, gap: 8 },
  headerBlock: { gap: 12, marginBottom: 8 },
  hero: {
    backgroundColor: colors.bgDeep,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 20,
    gap: 6,
  },
  kicker: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.brandSoft,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  name: {
    fontFamily: fonts.display,
    fontSize: 28,
    color: colors.ink,
  },
  handle: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.brand,
  },
  relation: { fontSize: 15, color: colors.inkSoft },
  blurb: { fontSize: 14, lineHeight: 21, color: colors.inkSoft, marginTop: 4 },
  action: {
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 16,
    gap: 4,
  },
  actionTitle: { fontSize: 16, fontWeight: "700", color: colors.ink },
  actionSub: { fontSize: 13, color: colors.inkSoft },
  sectionTitle: {
    fontFamily: fonts.display,
    fontSize: 20,
    color: colors.ink,
    marginTop: 8,
  },
  empty: { color: colors.inkSoft, lineHeight: 20, paddingVertical: 12 },
  memoryRow: {
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 12,
    marginBottom: 8,
    gap: 4,
  },
  memoryKind: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.brandSoft,
    textTransform: "uppercase",
  },
  memoryTitle: { fontSize: 15, lineHeight: 20, color: colors.ink },
  error: { color: "#b3261e", fontSize: 14, marginTop: 8 },
}));
