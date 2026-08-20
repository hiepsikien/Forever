import { StoryWorkSummary } from "@forever/api-client";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { useAuth } from "@/lib/auth";
import { useSpaceScreenOptions } from "@/lib/spaceHeader";
import { colors, fonts, createThemedStyles } from "@/lib/theme";

const SECTIONS: { id: "classic" | "sutra"; title: string }[] = [
  { id: "classic", title: "Truyện thơ" },
  { id: "sutra", title: "Kinh Phật" },
];

export default function StoryShelfScreen() {
  const { spaceId, identityId } = useLocalSearchParams<{
    spaceId: string;
    identityId: string;
  }>();
  const { api } = useAuth();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [works, setWorks] = useState<StoryWorkSummary[]>([]);
  const [recordedTotal, setRecordedTotal] = useState(0);
  const [canManage, setCanManage] = useState(false);
  const [busySlug, setBusySlug] = useState<string | null>(null);

  useSpaceScreenOptions({
    spaceId,
    title: "Nghe đọc",
    backTitle: "Ký ức",
  });

  const load = useCallback(async () => {
    if (!spaceId || !identityId) return;
    setLoading(true);
    try {
      const [shelf, spaceRes, stewardRes] = await Promise.all([
        api.listStoryShelf(spaceId, identityId),
        api.getSpace(spaceId),
        api.getStewardship(spaceId).catch(() => null),
      ]);
      setName(shelf.display_name);
      setWorks(shelf.works);
      setRecordedTotal(shelf.recorded_total);
      setCanManage(
        spaceRes.role === "owner" ||
          spaceRes.role === "moderator" ||
          Boolean(stewardRes?.is_steward),
      );
    } catch (e) {
      Alert.alert("Lỗi", e instanceof Error ? e.message : "Không tải kệ.");
    } finally {
      setLoading(false);
    }
  }, [api, identityId, spaceId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const bySection = useMemo(() => {
    const map: Record<string, StoryWorkSummary[]> = {
      classic: [],
      sutra: [],
    };
    for (const w of works) {
      const cat = w.category === "sutra" ? "sutra" : "classic";
      map[cat].push(w);
    }
    // Enabled shelf first — mother should see what she can hear without scrolling.
    for (const key of Object.keys(map)) {
      map[key].sort((a, b) => {
        if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
        return (a.title || "").localeCompare(b.title || "", "vi");
      });
    }
    return map;
  }, [works]);

  const toggleWork = async (work: StoryWorkSummary) => {
    if (!spaceId || !identityId || !canManage || busySlug) return;
    setBusySlug(work.slug);
    try {
      if (work.enabled) {
        await api.disableStoryWork(spaceId, identityId, work.slug);
      } else {
        await api.enableStoryWork(spaceId, identityId, work.slug);
      }
      await load();
    } catch (e) {
      Alert.alert("Lỗi", e instanceof Error ? e.message : "Không đổi được.");
    } finally {
      setBusySlug(null);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }

  const enabled = works.filter((w) => w.enabled);
  const who = name || "Người được nhớ";
  const canListen = enabled.some((w) => w.chunk_count > 0);

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.lead}>
        Nghe {who} đọc truyện và kinh bằng giọng Voice DNA. Đoạn đã đọc được
        giữ lại — lần sau phát lại, không đọc mới.
      </Text>
      <Text style={styles.meta}>
        Đã có {recordedTotal} đoạn trong kho nghe
        {enabled.length ? ` · ${enabled.length} tập đang mở` : ""}
      </Text>

      <View style={styles.actions}>
        <Pressable
          style={[styles.primaryBtn, !canListen && styles.btnDisabled]}
          disabled={!canListen}
          onPress={() =>
            router.push(`/stories/${spaceId}/${identityId}/listen`)
          }
        >
          <Text style={styles.primaryBtnText}>Nghe ngẫu nhiên</Text>
        </Pressable>
      </View>

      {SECTIONS.map((section) => {
        const list = bySection[section.id] || [];
        if (!list.length) return null;
        const openCount = list.filter((w) => w.enabled).length;
        return (
          <View key={section.id} style={styles.sectionBlock}>
            <View style={styles.sectionHeader}>
              <Text style={styles.section}>{section.title}</Text>
              {openCount > 0 ? (
                <Text style={styles.sectionMeta}>{openCount} đang mở</Text>
              ) : null}
            </View>
            {list.map((work) => (
              <View
                key={work.id}
                style={[styles.card, work.enabled && styles.cardOn]}
              >
                <Pressable
                  onPress={() =>
                    router.push(
                      `/stories/${spaceId}/${identityId}/${work.slug}`,
                    )
                  }
                >
                  <View style={styles.titleRow}>
                    <Text
                      style={[
                        styles.cardTitle,
                        !work.enabled && styles.cardTitleOff,
                      ]}
                    >
                      {work.title}
                    </Text>
                    {work.enabled ? (
                      <Text style={styles.badgeOn}>Đang mở</Text>
                    ) : (
                      <Text style={styles.badgeOff}>Chưa mở</Text>
                    )}
                  </View>
                  <Text style={styles.cardAuthor}>{work.author}</Text>
                  <Text style={styles.cardMeta}>
                    {work.chunk_count === 0
                      ? "Chưa có chữ — steward nhập từ sách / kinh nhà"
                      : work.enabled
                        ? `${work.recorded_count}/${work.chunk_count} đoạn đã đọc`
                        : `${work.chunk_count} đoạn · bật kệ để nghe`}
                  </Text>
                </Pressable>
                {canManage ? (
                  <Pressable
                    style={[
                      styles.enableBtn,
                      work.enabled && styles.enableBtnOn,
                    ]}
                    disabled={busySlug === work.slug}
                    onPress={() => toggleWork(work)}
                  >
                    <Text
                      style={[
                        styles.enableBtnText,
                        work.enabled && styles.enableBtnTextOn,
                      ]}
                    >
                      {work.enabled ? "Tắt kệ" : "Bật kệ"}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            ))}
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = createThemedStyles(() => ({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 20, paddingBottom: 40, gap: 12 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  lead: {
    fontFamily: fonts.serif,
    fontSize: 22,
    lineHeight: 30,
    color: colors.ink,
  },
  meta: {
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.muted,
    marginBottom: 8,
  },
  actions: { gap: 10, marginBottom: 8 },
  primaryBtn: {
    backgroundColor: colors.brand,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  primaryBtnText: {
    fontFamily: fonts.sansSemi,
    color: "#fff",
    fontSize: 16,
  },
  btnDisabled: { opacity: 0.4 },
  sectionBlock: { gap: 0, marginTop: 8 },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    marginBottom: 4,
    gap: 8,
  },
  section: {
    fontFamily: fonts.sansSemi,
    fontSize: 13,
    color: colors.muted,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  sectionMeta: {
    fontFamily: fonts.sans,
    fontSize: 12,
    color: colors.brand,
    fontWeight: "600",
  },
  card: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
    paddingVertical: 14,
    gap: 10,
  },
  cardOn: {
    backgroundColor: colors.brandSoft,
    marginHorizontal: -12,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderTopWidth: 0,
    marginBottom: 6,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  cardTitle: {
    flex: 1,
    fontFamily: fonts.serif,
    fontSize: 20,
    color: colors.ink,
  },
  cardTitleOff: {
    color: colors.muted,
  },
  badgeOn: {
    fontFamily: fonts.sansSemi,
    fontSize: 11,
    color: colors.brand,
    backgroundColor: "#fff",
    overflow: "hidden",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  badgeOff: {
    fontFamily: fonts.sans,
    fontSize: 11,
    color: colors.muted,
  },
  cardAuthor: {
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.muted,
    marginTop: 2,
  },
  cardMeta: {
    fontFamily: fonts.sans,
    fontSize: 13,
    color: colors.muted,
    marginTop: 6,
  },
  enableBtn: {
    alignSelf: "flex-start",
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: colors.brandSoft,
  },
  enableBtnOn: {
    backgroundColor: "#fff",
  },
  enableBtnText: {
    fontFamily: fonts.sansSemi,
    fontSize: 13,
    color: colors.brand,
  },
  enableBtnTextOn: {
    color: colors.ink,
  },
}));
