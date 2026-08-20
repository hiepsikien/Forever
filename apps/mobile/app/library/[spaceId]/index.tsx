import { IdentityProfile, MemoryCandidate, MemoryItem } from "@forever/api-client";
import { router, useLocalSearchParams, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";

import { LibrarySearchBar } from "@/components/library/LibrarySearchBar";
import { PersonHubRowView } from "@/components/library/PersonHubRow";
import { useAuth } from "@/lib/auth";
import {
  buildPersonHubRows,
  calendarDateLabel,
  groupFamilyCalendar,
  livingLibraryPeople,
  matchesSearch,
  PersonHubRow,
  rememberedLibraryPeople,
  SHELF_LABELS,
  UNTAGGED_PERSON_ID,
} from "@/lib/libraryShelves";
import { displayMemoryTitle } from "@/lib/memoryDisplay";
import { useSpaceScreenOptions } from "@/lib/spaceHeader";
import { colors, fonts, createThemedStyles } from "@/lib/theme";

const CALENDAR_PREVIEW = 5;

export default function LibraryHubScreen() {
  const { spaceId } = useLocalSearchParams<{ spaceId: string }>();
  const { api, user } = useAuth();
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [identities, setIdentities] = useState<IdentityProfile[]>([]);
  const [candidates, setCandidates] = useState<MemoryCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [calendarExpanded, setCalendarExpanded] = useState(false);

  useSpaceScreenOptions({
    spaceId,
    title: "Thư viện ký ức",
    backTitle: "Nhà",
  });

  const load = useCallback(async () => {
    if (!spaceId) return;
    setError(null);
    try {
      const [memRes, idRes, candRes] = await Promise.all([
        api.listMemories(spaceId),
        api.listIdentities(spaceId),
        api.listMemoryCandidates(spaceId, "pending").catch(() => ({ candidates: [] })),
      ]);
      setMemories(memRes.memories);
      setIdentities(idRes.identities);
      setCandidates(candRes.candidates);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tải được thư viện.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [api, spaceId]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const remembered = useMemo(
    () => rememberedLibraryPeople(identities),
    [identities],
  );
  const living = useMemo(() => livingLibraryPeople(identities), [identities]);

  const allRows = useMemo(
    () => buildPersonHubRows(memories, identities, candidates, user?.id),
    [memories, identities, candidates, user?.id],
  );

  const rememberedRows = useMemo(
    () =>
      allRows.filter((row) =>
        remembered.some((p) => p.id === row.identityId),
      ),
    [allRows, remembered],
  );

  const livingRows = useMemo(() => {
    const byId = new Map(allRows.map((r) => [r.identityId, r]));
    return living.map((person) => {
      const existing = byId.get(person.id);
      if (existing) {
        return {
          ...existing,
          handle: existing.handle ?? person.handle ?? null,
        };
      }
      return {
        identityId: person.id,
        label:
          person.linked_user_id === user?.id
            ? "Tôi"
            : person.display_name,
        handle: person.handle ?? null,
        status: person.status,
        counts: { life: 0, poems: 0, artifacts: 0, heard: 0 },
        poemOwn: 0,
        poemGift: 0,
        total: 0,
      } satisfies PersonHubRow;
    });
  }, [allRows, living, user?.id]);

  const untaggedRow = useMemo(
    () => allRows.find((r) => r.identityId === UNTAGGED_PERSON_ID) ?? null,
    [allRows],
  );

  const familyMilestones = useMemo(
    () =>
      memories.filter(
        (m) =>
          m.kind === "milestone" &&
          m.visibility !== "private" &&
          matchesSearch(m, query),
      ),
    [memories, query],
  );

  const calendarSections = useMemo(
    () => groupFamilyCalendar(familyMilestones),
    [familyMilestones],
  );

  const calendarPreviewItems = useMemo(() => {
    const upcoming =
      calendarSections.find((s) => s.key === "upcoming")?.items ?? [];
    const past = calendarSections.find((s) => s.key === "past")?.items ?? [];
    const rest = calendarSections
      .filter((s) => s.key !== "upcoming" && s.key !== "past")
      .flatMap((s) => s.items);
    const ordered = [...upcoming, ...past, ...rest];
    if (calendarExpanded) return ordered;
    return ordered.slice(0, CALENDAR_PREVIEW);
  }, [calendarSections, calendarExpanded]);

  const calendarTotal = familyMilestones.length;

  const filterRows = useCallback(
    (rows: PersonHubRow[]) => {
      const q = query.trim().toLowerCase();
      if (!q) return rows;
      return rows.filter(
        (r) =>
          r.label.toLowerCase().includes(q) ||
          (r.handle && r.handle.toLowerCase().includes(q)),
      );
    },
    [query],
  );

  const openPerson = (row: PersonHubRow) => {
    if (!spaceId) return;
    if (row.identityId === UNTAGGED_PERSON_ID) {
      router.push(`/library/${spaceId}/person/${UNTAGGED_PERSON_ID}`);
      return;
    }
    const identity = identities.find((i) => i.id === row.identityId);
    if (identity?.status === "remembered") {
      router.push(`/library/${spaceId}/person/${row.identityId}`);
    } else {
      router.push(`/people/${spaceId}/${row.identityId}`);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }

  const shownRemembered = filterRows(rememberedRows);
  const shownLiving = filterRows(livingRows);

  return (
    <View style={styles.root}>
      <LibrarySearchBar value={query} onChange={setQuery} />
      <ScrollView
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load();
            }}
            tintColor={colors.brand}
          />
        }
      >
        <View style={styles.sectionBlock}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{SHELF_LABELS.life}</Text>
            {calendarTotal > 0 ? (
              <Text style={styles.sectionMeta}>{calendarTotal} ngày</Text>
            ) : null}
          </View>
          <Text style={styles.sectionHint}>
            Giỗ, cưới, sinh nhật — tầng chung của cả nhà.
          </Text>
          {calendarPreviewItems.length === 0 ? (
            <Text style={styles.emptyInline}>
              Chưa có ngày gia đình. Thêm từ không gian người được nhớ.
            </Text>
          ) : (
            <View style={styles.calendarList}>
              {calendarPreviewItems.map((item) => (
                <Pressable
                  key={item.id}
                  style={styles.calendarRow}
                  onPress={() => {
                    const ids = identities.filter((i) =>
                      (item.tags || "").includes(`heritage:${i.id}`),
                    );
                    const first = ids.find((i) => i.status === "remembered");
                    if (first && spaceId) {
                      router.push(`/library/${spaceId}/person/${first.id}?shelf=life`);
                    }
                  }}
                >
                  <Text style={styles.calendarDate}>
                    {calendarDateLabel(item.occurred_at, item.tags)}
                  </Text>
                  <Text style={styles.calendarTitle} numberOfLines={2}>
                    {displayMemoryTitle(item)}
                  </Text>
                </Pressable>
              ))}
              {calendarTotal > CALENDAR_PREVIEW ? (
                <Pressable
                  onPress={() => setCalendarExpanded((v) => !v)}
                  hitSlop={8}
                >
                  <Text style={styles.expandLink}>
                    {calendarExpanded
                      ? "Thu gọn"
                      : `Xem cả năm · ${calendarTotal} ngày`}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          )}
        </View>

        <View style={styles.sectionBlock}>
          <Text style={styles.sectionTitle}>Người được nhớ</Text>
          <Text style={styles.sectionHint}>
            Không gian thư viện riêng — thơ, hiện vật, mốc đời neo về họ.
          </Text>
          {shownRemembered.length === 0 ? (
            <Text style={styles.emptyInline}>
              Chưa có người được nhớ trong không gian này.
            </Text>
          ) : (
            shownRemembered.map((row) => (
              <PersonHubRowView
                key={row.identityId}
                row={row}
                lifeAsMilestones
                onPress={() => openPerson(row)}
              />
            ))
          )}
        </View>

        <View style={styles.sectionBlock}>
          <Text style={styles.sectionTitle}>Người nhà</Text>
          <Text style={styles.sectionHint}>
            Trang nhẹ — ký ức đã neo về từng người.
          </Text>
          {shownLiving.length === 0 ? (
            <Text style={styles.emptyInline}>Chưa có hồ sơ người sống.</Text>
          ) : (
            shownLiving.map((row) => (
              <PersonHubRowView
                key={row.identityId}
                row={row}
                lifeAsMilestones
                compact
                onPress={() => openPerson(row)}
              />
            ))
          )}
        </View>

        {untaggedRow && (!query.trim() || untaggedRow.total > 0) ? (
          <View style={styles.sectionBlock}>
            <PersonHubRowView
              row={untaggedRow}
              onPress={() => openPerson(untaggedRow)}
            />
          </View>
        ) : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>
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
  },
  list: { padding: 16, paddingTop: 4, paddingBottom: 40, gap: 8 },
  sectionBlock: { marginBottom: 16, gap: 6 },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 8,
  },
  sectionTitle: {
    fontFamily: fonts.display,
    fontSize: 22,
    color: colors.ink,
  },
  sectionMeta: { fontSize: 13, color: colors.inkSoft },
  sectionHint: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.inkSoft,
    marginBottom: 4,
  },
  emptyInline: { color: colors.inkSoft, lineHeight: 20, paddingVertical: 8 },
  calendarList: { gap: 6, marginTop: 4 },
  calendarRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  calendarDate: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.brand,
    minWidth: 44,
  },
  calendarTitle: { flex: 1, fontSize: 15, lineHeight: 20, color: colors.ink },
  expandLink: {
    color: colors.brand,
    fontWeight: "600",
    fontSize: 14,
    paddingVertical: 6,
  },
  error: { color: colors.danger, paddingTop: 8 },
}));
