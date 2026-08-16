import { IdentityProfile, MemoryCandidate, MemoryItem } from "@forever/api-client";
import { router, useLocalSearchParams, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { PersonHubRowView } from "@/components/library/PersonHubRow";
import { useAuth } from "@/lib/auth";
import {
  buildPersonHubRows,
  PersonHubRow,
  rememberedLibraryPeople,
  UNTAGGED_PERSON_ID,
} from "@/lib/libraryShelves";
import { useSpaceScreenOptions } from "@/lib/spaceHeader";
import { colors } from "@/lib/theme";

export default function LibraryHubScreen() {
  const { spaceId } = useLocalSearchParams<{ spaceId: string }>();
  const { api, user } = useAuth();
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [identities, setIdentities] = useState<IdentityProfile[]>([]);
  const [candidates, setCandidates] = useState<MemoryCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const skippedRef = useRef(false);

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
      skippedRef.current = false;
      void load();
    }, [load]),
  );

  const remembered = useMemo(
    () => rememberedLibraryPeople(identities),
    [identities],
  );

  useEffect(() => {
    if (loading || !spaceId || skippedRef.current) return;
    if (remembered.length !== 1) return;
    skippedRef.current = true;
    router.replace(`/library/${spaceId}/person/${remembered[0].id}`);
  }, [loading, remembered, spaceId]);

  const rows = useMemo(() => {
    const all = buildPersonHubRows(memories, identities, candidates, user?.id);
    return all.filter((row) => {
      if (row.identityId === UNTAGGED_PERSON_ID) return true;
      return remembered.some((p) => p.id === row.identityId);
    });
  }, [memories, identities, candidates, user?.id, remembered]);

  if (loading || (remembered.length === 1 && !error)) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <FlatList
        data={rows}
        keyExtractor={(row: PersonHubRow) => row.identityId}
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
        ListEmptyComponent={
          <Text style={styles.empty}>
            Chưa có người được nhớ trong không gian này.
          </Text>
        }
        renderItem={({ item }) => (
          <PersonHubRowView
            row={item}
            onPress={() =>
              spaceId && router.push(`/library/${spaceId}/person/${item.identityId}`)
            }
          />
        )}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bg,
  },
  list: { padding: 16, paddingTop: 12, paddingBottom: 40 },
  empty: { color: colors.inkSoft, lineHeight: 22, paddingTop: 24 },
  error: { color: colors.danger, padding: 16 },
});
