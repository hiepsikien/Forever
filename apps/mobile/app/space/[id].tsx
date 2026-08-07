import { FamilySpace, HeritageReadiness, ThreadSummary } from "@forever/api-client";
import { useFocusEffect } from "@react-navigation/native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
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
import { useSpaceScreenOptions } from "@/lib/spaceHeader";
import { colors, fonts } from "@/lib/theme";

function threadPreview(item: ThreadSummary): string {
  const last = item.last_message;
  if (!last) return "Chưa có tin nhắn";
  if (last.kind === "voice") {
    const caption = (last.body || "").trim();
    return caption || "Tin nhắn thoại";
  }
  return last.body || "Chưa có tin nhắn";
}

/** One remembered person and the two rooms that belong to them. */
type PersonRow = {
  row: "person";
  key: string;
  person: HeritageReadiness;
  shared: ThreadSummary | null;
  direct: ThreadSummary | null;
};

/** Anything that is neither Phòng khách nor a room of a remembered person. */
type OtherRow = { row: "thread"; key: string; thread: ThreadSummary };

type HomeRow = PersonRow | OtherRow;

function isDirect(item: ThreadSummary): boolean {
  return (item.audience_scope ?? "family") === "direct";
}

function personTitle(person: HeritageReadiness): string {
  const rel = person.relation_label?.trim();
  return rel ? `${person.display_name} · ${rel}` : person.display_name;
}

/** What is still missing before this person can talk, said in plain words. */
function awakeningStatus(p: HeritageReadiness): string {
  if (p.entity_status === "paused") {
    return "Đang tạm dừng — mở lại khi cả nhà muốn nói chuyện tiếp.";
  }
  const who = p.relation_label?.trim() || p.display_name;
  const missing: string[] = [];
  const anchors = Math.max(0, p.knowledge_target - p.knowledge_count);
  if (anchors > 0) missing.push(`${anchors} điều nữa bạn kể về ${who}`);
  if (!p.voice_ready) missing.push("một đoạn ghi âm giọng");
  if (p.profile_ready === false) missing.push("bản sắc để bạn xem lại");
  if (!missing.length) return "Đã đủ để thổi hồn.";
  return `Chưa trò chuyện được — còn cần ${missing.join(", ")}.`;
}

function personPreview(item: PersonRow): string {
  const p = item.person;
  if (!p.chat_ready) return awakeningStatus(p);
  if (item.shared?.last_message) return threadPreview(item.shared);
  return `Phòng riêng của ${p.relation_label || p.display_name} — nhắn gì ${p.relation_label || "họ"} cũng trả lời`;
}

function awakeningCta(person: HeritageReadiness): string {
  if (person.entity_status === "dormant") return "Bắt đầu thổi hồn →";
  if (person.entity_status === "paused") return "Đã tạm dừng — mở Thổi hồn →";
  return "Tiếp tục thổi hồn →";
}

/** Who is sitting in Phòng khách, e.g. «bố (@bo) · bà Thông (@bathong)». */
function livingRoomLine(members: HeritageReadiness[]): string | null {
  const seated = members
    .filter((m) => m.chat_ready)
    .map((m) => {
      const name = m.relation_label?.trim() || m.display_name;
      return m.handle ? `${name} (@${m.handle})` : name;
    });
  if (!seated.length) return null;
  return `${seated.join(" · ")} cũng ngồi đây — gọi tên khi muốn hỏi`;
}

function otherRowMeta(item: ThreadSummary): { preview: string; cta: string } {
  if (!item.last_message) {
    return { preview: "Chưa có tin nhắn — gửi lời chào", cta: "Bắt đầu chat →" };
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
  const [error, setError] = useState<string | null>(null);
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

  useSpaceScreenOptions({
    spaceId: id,
    title: space?.name ?? "Gia đình",
    backTitle: "Forever",
    showSettings: true,
  });

  // Hero = Phòng khách (kind=family): the living members, with the remembered
  // ones sitting among them. Each remembered person keeps their own rooms below.
  const familyThread = useMemo(
    () => threads.find((t) => t.kind === "family") ?? null,
    [threads],
  );

  const livingRoomMembers = useMemo<HeritageReadiness[]>(() => {
    if (!familyThread) return [];
    if (familyThread.living_room_members?.length) {
      return familyThread.living_room_members;
    }
    return familyThread.living_room ? [familyThread.living_room] : [];
  }, [familyThread]);

  /** Below the hero: one card per remembered person, then anything left over. */
  const rows = useMemo<HomeRow[]>(() => {
    const people = new Map<string, PersonRow>();
    const leftovers: ThreadSummary[] = [];

    for (const thread of threads) {
      if (thread.id === familyThread?.id) continue;
      const person = thread.heritage;
      if (thread.kind !== "heritage" || !person) {
        leftovers.push(thread);
        continue;
      }
      const entry = people.get(person.identity_id) ?? {
        row: "person" as const,
        key: `person:${person.identity_id}`,
        person,
        shared: null,
        direct: null,
      };
      if (isDirect(thread)) entry.direct = thread;
      else entry.shared = thread;
      entry.person = person;
      people.set(person.identity_id, entry);
    }

    const activityAt = (item: PersonRow): string =>
      [item.shared, item.direct]
        .map((t) => t?.last_message?.created_at ?? t?.created_at ?? "")
        .sort()
        .pop() ?? "";

    const personRows = [...people.values()].sort((a, b) => {
      const readyDiff = Number(b.person.chat_ready) - Number(a.person.chat_ready);
      if (readyDiff !== 0) return readyDiff;
      const aAt = activityAt(a);
      const bAt = activityAt(b);
      return aAt < bAt ? 1 : aAt > bAt ? -1 : 0;
    });

    return [
      ...personRows,
      ...leftovers.map<OtherRow>((thread) => ({
        row: "thread",
        key: `thread:${thread.id}`,
        thread,
      })),
    ];
  }, [threads, familyThread]);

  const personRowCount = rows.filter((r) => r.row === "person").length;

  // Collecting and cloning a voice is steward/owner work; hearing one happens
  // inside the rooms. The API gate is what counts — this only hides the tile.
  const canManageVoice =
    space?.role === "owner" ||
    (Boolean(user?.id) && space?.steward_user_id === user?.id);

  const openSharedRoom = (item: PersonRow) => {
    if (!item.person.chat_ready) {
      if (id) {
        router.push(
          `/awakening/${id}?identityId=${item.person.identity_id}` as never,
        );
      }
      return;
    }
    if (item.shared) router.push(`/chat/${item.shared.id}`);
  };

  const openDirectRoom = async (item: PersonRow) => {
    if (item.direct) {
      router.push(`/chat/${item.direct.id}`);
      return;
    }
    if (!id) return;
    try {
      const thread = await api.openDirectHeritageThread(
        id,
        item.person.identity_id,
      );
      router.push(`/chat/${thread.id}`);
      load({ silent: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không mở được phòng riêng.");
    }
  };

  /** Tools live under the rooms: they are for tending memory, not for talking. */
  const renderFooter = () => (
    <View style={styles.footerBlock}>
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
          onPress={() => id && router.push(`/review/${id}`)}
        >
          <Text style={styles.memoryTitle}>Điều nghe được</Text>
          <Text style={styles.memorySub}>Từ trò chuyện</Text>
        </Pressable>
        {canManageVoice ? (
          <Pressable
            style={styles.memoryTile}
            onPress={() => id && router.push(`/voice/${id}`)}
          >
            <Text style={styles.memoryTitle}>Voice DNA</Text>
            <Text style={styles.memorySub}>Giọng & TTS</Text>
          </Pressable>
        ) : null}
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );

  const renderHeader = () => (
    <View style={styles.headerBlock}>
      <Text style={styles.meta}>
        {space?.member_count ?? 0} thành viên
        {space?.role === "owner" ? " · Bạn quản trị" : ""}
      </Text>

      {familyThread ? (
        <Pressable
          style={styles.hero}
          onPress={() => router.push(`/chat/${familyThread.id}`)}
        >
          <Text style={styles.heroKicker}>Phòng khách</Text>
          <Text style={styles.heroPreview} numberOfLines={2}>
            {familyThread.last_message
              ? threadPreview(familyThread)
              : "Cả nhà nói chuyện với nhau"}
          </Text>
          {livingRoomLine(livingRoomMembers) ? (
            <Text style={styles.heroSeated} numberOfLines={2}>
              {livingRoomLine(livingRoomMembers)}
            </Text>
          ) : null}
          <Text style={styles.heroCta}>Vào trò chuyện →</Text>
        </Pressable>
      ) : (
        <View style={styles.heroMuted}>
          <Text style={styles.heroKickerMuted}>Phòng khách</Text>
          <Text style={styles.heroPreviewMuted}>Chưa có cuộc trò chuyện chung.</Text>
        </View>
      )}

      <Text style={styles.section}>
        {personRowCount ? "Người trong nhà" : "Cuộc trò chuyện"}
      </Text>
      {personRowCount ? (
        <Text style={styles.emptyHint}>
          Mỗi người có phòng chung cả nhà và phòng riêng của bạn — ở đó họ trả
          lời mọi lời nhắn.
        </Text>
      ) : familyThread ? (
        <Text style={styles.emptyHint}>
          Người thân được nhớ sẽ hiện ở đây khi được thổi hồn.
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
      data={rows}
      keyExtractor={(item) => item.key}
      ListHeaderComponent={renderHeader}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => load({ silent: true })}
          tintColor={colors.brand}
        />
      }
      renderItem={({ item, index }) => {
        if (item.row === "thread") {
          const meta = otherRowMeta(item.thread);
          return (
            <>
              {index === personRowCount && personRowCount ? (
                <Text style={styles.sectionSmall}>Cuộc trò chuyện khác</Text>
              ) : null}
              <Pressable
                style={styles.thread}
                onPress={() => router.push(`/chat/${item.thread.id}`)}
              >
                <View style={styles.threadTop}>
                  <Text style={styles.threadTitle}>{item.thread.title}</Text>
                </View>
                <Text style={styles.threadPreview} numberOfLines={2}>
                  {meta.preview}
                </Text>
                <View style={styles.threadActions}>
                  <Text style={styles.threadCta}>{meta.cta}</Text>
                </View>
              </Pressable>
            </>
          );
        }

        const ready = item.person.chat_ready;
        return (
          <Pressable style={styles.thread} onPress={() => openSharedRoom(item)}>
            <View style={styles.threadTop}>
              <Text style={styles.threadTitle}>{personTitle(item.person)}</Text>
              {ready && item.person.handle ? (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>@{item.person.handle}</Text>
                </View>
              ) : null}
            </View>
            <Text style={styles.threadPreview} numberOfLines={2}>
              {personPreview(item)}
            </Text>
            <View style={styles.personActions}>
              {ready ? (
                <>
                  <Text style={styles.threadCta}>Vào phòng chung →</Text>
                  <View style={styles.subActions}>
                    <Pressable
                      onPress={(e) => {
                        e.stopPropagation?.();
                        void openDirectRoom(item);
                      }}
                      hitSlop={8}
                    >
                      <Text style={styles.subCta}>Nói riêng</Text>
                    </Pressable>
                    {item.shared ? (
                      <>
                        <Text style={styles.subDivider}>·</Text>
                        <Pressable
                          onPress={(e) => {
                            e.stopPropagation?.();
                            router.push(`/call/${item.shared!.id}`);
                          }}
                          hitSlop={8}
                        >
                          <Text style={styles.subCta}>Gọi bằng giọng</Text>
                        </Pressable>
                      </>
                    ) : null}
                  </View>
                </>
              ) : (
                <Text style={styles.threadCta}>{awakeningCta(item.person)}</Text>
              )}
            </View>
          </Pressable>
        );
      }}
      ListEmptyComponent={
        !familyThread ? (
          <Text style={styles.empty}>Chưa có cuộc trò chuyện nào.</Text>
        ) : null
      }
      ListFooterComponent={renderFooter()}
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
  footerBlock: { gap: 10, marginTop: 18 },
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
  heroSeated: {
    fontSize: 13,
    lineHeight: 19,
    color: "rgba(244, 239, 230, 0.8)",
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
  memoryLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.inkSoft,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginTop: 4,
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
  sectionSmall: {
    fontFamily: fonts.display,
    fontSize: 18,
    color: colors.ink,
    marginTop: 6,
    marginBottom: 8,
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
  personActions: { marginTop: 10, gap: 8 },
  subActions: { flexDirection: "row", alignItems: "center", gap: 10 },
  subCta: { fontSize: 13, fontWeight: "600", color: colors.brandSoft },
  subDivider: { fontSize: 13, color: colors.inkSoft },
  empty: { color: colors.inkSoft, lineHeight: 22, marginTop: 4 },
  error: { color: colors.danger, marginTop: 12 },
});
