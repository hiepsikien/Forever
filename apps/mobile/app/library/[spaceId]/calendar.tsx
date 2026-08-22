import { IdentityProfile, MemoryItem } from "@forever/api-client";
import { router, useLocalSearchParams, useFocusEffect } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";

import { useAuth } from "@/lib/auth";
import { GenealogyTabs } from "@/components/genealogy/GenealogyTabs";
import {
  calendarDateLines,
  displayCalendarMilestoneTitle,
  groupFamilyCalendar,
} from "@/lib/libraryShelves";
import { shortHeritageLabelsForMemory } from "@/lib/memoryTags";
import { ensureMourningRites } from "@/lib/mourningRites";
import { useSpaceScreenOptions } from "@/lib/spaceHeader";
import { colors, fonts, createThemedStyles } from "@/lib/theme";

export default function FamilyCalendarScreen() {
  const { spaceId } = useLocalSearchParams<{ spaceId: string }>();
  const { api, user } = useAuth();
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [identities, setIdentities] = useState<IdentityProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ensureLock = useRef<Promise<void> | null>(null);

  useSpaceScreenOptions({
    spaceId,
    title: "Lịch & gia phả",
    backTitle: "Nhà",
  });

  const load = useCallback(async () => {
    if (!spaceId) return;
    setError(null);
    try {
      const [memRes, idRes] = await Promise.all([
        api.listMemories(spaceId),
        api.listIdentities(spaceId),
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
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tải được lịch.");
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

  const familyMilestones = useMemo(
    () =>
      memories.filter(
        (m) => m.kind === "milestone" && m.visibility !== "private",
      ),
    [memories],
  );

  const calendarSections = useMemo(
    () =>
      groupFamilyCalendar(familyMilestones).filter((s) => s.items.length > 0),
    [familyMilestones],
  );

  const calendarTotal = useMemo(
    () => calendarSections.reduce((n, s) => n + s.items.length, 0),
    [calendarSections],
  );

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.root}
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
      <GenealogyTabs spaceId={spaceId ?? ""} />
      <Text style={styles.hint}>
        Sắp tới · đã xảy ra tách riêng. Ngày dương trên, âm dưới khi cần.
      </Text>
      {calendarTotal === 0 ? (
        <Text style={styles.empty}>
          Chưa có ngày gia đình. Thêm từ không gian người được nhớ.
        </Text>
      ) : (
        <View style={styles.calendarList}>
          {calendarSections.map((section) => (
            <View key={section.key} style={styles.calendarBucket}>
              <Text style={styles.calendarBucketLabel}>{section.label}</Text>
              {section.items.map((item) => {
                const who = shortHeritageLabelsForMemory(
                  item.tags || "",
                  identities,
                  user?.id,
                );
                const dateLines = calendarDateLines(
                  item.occurred_at,
                  item.tags,
                  new Date(),
                  item,
                );
                return (
                  <Pressable
                    key={item.id}
                    style={styles.calendarRow}
                    onPress={() => {
                      const ids = identities.filter((i) =>
                        (item.tags || "").includes(`heritage:${i.id}`),
                      );
                      const first = ids.find((i) => i.status === "remembered");
                      if (first && spaceId) {
                        router.push(
                          `/library/${spaceId}/person/${first.id}?shelf=life`,
                        );
                      }
                    }}
                  >
                    <View style={styles.calendarDateCol}>
                      <Text style={styles.calendarDate} numberOfLines={1}>
                        {dateLines.primary}
                      </Text>
                      <Text
                        style={[
                          styles.calendarDateSub,
                          !dateLines.secondary &&
                            styles.calendarDateSubPlaceholder,
                        ]}
                        numberOfLines={1}
                      >
                        {dateLines.secondary ?? " "}
                      </Text>
                    </View>
                    <View style={styles.calendarBody}>
                      {who.length ? (
                        <Text style={styles.calendarWho} numberOfLines={1}>
                          {who.join(" · ")}
                        </Text>
                      ) : (
                        <Text style={styles.calendarWhoPlaceholder}> </Text>
                      )}
                      <Text style={styles.calendarTitle} numberOfLines={2}>
                        {displayCalendarMilestoneTitle(item, {
                          milestones: familyMilestones,
                        })}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          ))}
        </View>
      )}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </ScrollView>
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
  list: { padding: 16, paddingBottom: 40, gap: 8 },
  hint: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.inkSoft,
    marginBottom: 4,
  },
  empty: { color: colors.inkSoft, lineHeight: 20, paddingVertical: 8 },
  calendarList: { gap: 10, marginTop: 4 },
  calendarBucket: { gap: 6 },
  calendarBucketLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.inkSoft,
    marginTop: 4,
    letterSpacing: 0.2,
  },
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
    minHeight: 56,
  },
  calendarDateCol: {
    width: 92,
    gap: 2,
  },
  calendarDate: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.brand,
    lineHeight: 18,
    fontVariant: ["tabular-nums"],
  },
  calendarDateSub: {
    fontSize: 12,
    lineHeight: 16,
    color: colors.inkSoft,
    fontVariant: ["tabular-nums"],
  },
  calendarDateSubPlaceholder: {
    opacity: 0,
  },
  calendarBody: { flex: 1, gap: 2, minWidth: 0 },
  calendarWho: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "600",
    color: colors.brandSoft,
  },
  calendarWhoPlaceholder: {
    fontSize: 12,
    lineHeight: 16,
    opacity: 0,
  },
  calendarTitle: {
    fontSize: 15,
    lineHeight: 20,
    color: colors.ink,
  },
  error: { color: colors.danger, paddingTop: 8 },
}));
