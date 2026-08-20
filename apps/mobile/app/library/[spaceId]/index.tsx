import { IdentityProfile, MemoryCandidate, MemoryItem } from "@forever/api-client";
import { router, useLocalSearchParams, useFocusEffect } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
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
  livingLibraryPeople,
  PersonHubRow,
  rememberedLibraryPeople,
  UNTAGGED_PERSON_ID,
} from "@/lib/libraryShelves";
import { ensureMourningRites } from "@/lib/mourningRites";
import { useSpaceScreenOptions } from "@/lib/spaceHeader";
import { colors, fonts, createThemedStyles } from "@/lib/theme";

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
  const ensureLock = useRef<Promise<void> | null>(null);

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
      let nextMemories = memRes.memories;
      const runEnsure = async () => {
        try {
          const changed = await ensureMourningRites(nextMemories, {
            create: (payload) => api.createNoteMemory(spaceId, payload),
            update: (id, payload) => api.updateMemory(id, payload),
            remove: async (id) => {
              await api.deleteMemory(id);
            },
          });
          if (changed > 0) {
            nextMemories = (await api.listMemories(spaceId)).memories;
          }
        } catch {
          // Rite backfill is best-effort — calendar still shows ngày mất.
        }
      };
      if (ensureLock.current) {
        await ensureLock.current;
        nextMemories = (await api.listMemories(spaceId)).memories;
      } else {
        const pending = runEnsure().finally(() => {
          ensureLock.current = null;
        });
        ensureLock.current = pending;
        await pending;
      }
      setMemories(nextMemories);
      setIdentities(idRes.identities);
      setCandidates(candRes.candidates);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tải được thư viện.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [api, spaceId]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
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
  sectionTitle: {
    fontFamily: fonts.display,
    fontSize: 22,
    color: colors.ink,
  },
  sectionHint: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.inkSoft,
    marginBottom: 4,
  },
  emptyInline: { color: colors.inkSoft, lineHeight: 20, paddingVertical: 8 },
  error: { color: colors.danger, paddingTop: 8 },
}));
