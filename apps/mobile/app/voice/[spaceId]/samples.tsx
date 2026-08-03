import { VoiceSample } from "@forever/api-client";
import { useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";

import {
  pauseActivePlayback,
  playLocalAudio,
  resumeActivePlayback,
  stopActivePlayback,
} from "@/lib/audio";
import { useAuth } from "@/lib/auth";
import { fetchAuthedMediaUri } from "@/lib/media";
import { useSpaceScreenOptions } from "@/lib/spaceHeader";
import { colors, fonts } from "@/lib/theme";

type Playback = { id: string; paused: boolean } | null;
type TabStage = "unprocessed" | "processed";
type SamplesByTab = Record<TabStage, VoiceSample[]>;

const EMPTY_SAMPLES: SamplesByTab = { unprocessed: [], processed: [] };

function sourceLabel(source: string): string {
  switch (source) {
    case "record":
      return "Ghi trực tiếp";
    case "upload":
      return "Tải file";
    case "memory":
      return "Thư viện";
    case "extract":
      return "Extract pool";
    case "combine":
      return "Ghép clip";
    case "process":
      return "Đã normalize";
    default:
      return source;
  }
}

function formatDurationMs(ms: number | null | undefined): string {
  if (ms == null || ms < 0) return "—:—";
  const totalSec = Math.round(ms / 1000);
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export default function VoiceSamplesScreen() {
  const { spaceId, voiceId, stage: stageParam } = useLocalSearchParams<{
    spaceId: string;
    voiceId?: string;
    stage?: string;
  }>();
  const { api } = useAuth();
  const initialTab: TabStage =
    stageParam === "processed" ? "processed" : "unprocessed";
  const [tab, setTab] = useState<TabStage>(initialTab);
  const [samplesByTab, setSamplesByTab] = useState<SamplesByTab>(EMPTY_SAMPLES);
  const [initialLoading, setInitialLoading] = useState(true);
  const [tabRefreshing, setTabRefreshing] = useState<TabStage | null>(null);
  const [playback, setPlayback] = useState<Playback>(null);
  const [playBusyId, setPlayBusyId] = useState<string | null>(null);
  const mediaCacheRef = useRef<Map<string, string>>(new Map());
  const playLockRef = useRef(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftNote, setDraftNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [normalizeEnabled, setNormalizeEnabled] = useState(true);

  const samples = samplesByTab[tab];

  useSpaceScreenOptions({ spaceId, title: "Mẫu giọng", backTitle: "Nhà" });

  const loadTab = useCallback(
    async (stage: TabStage, opts?: { silent?: boolean }) => {
      if (!spaceId) return;
      if (!opts?.silent) setTabRefreshing(stage);
      try {
        const res = await api.listSpaceVoiceSamples(
          spaceId,
          voiceId || undefined,
          stage,
        );
        setSamplesByTab((prev) => ({ ...prev, [stage]: res.samples }));
      } catch (e) {
        if (!opts?.silent) {
          Alert.alert("Lỗi", e instanceof Error ? e.message : "Không tải sample.");
        }
      } finally {
        setTabRefreshing(null);
        setInitialLoading(false);
      }
    },
    [api, spaceId, voiceId],
  );

  const refreshCurrentTab = useCallback(async () => {
    await loadTab(tab);
    setSelected(new Set());
  }, [loadTab, tab]);

  const refreshAllTabs = useCallback(async () => {
    await Promise.all([
      loadTab("unprocessed", { silent: true }),
      loadTab("processed", { silent: true }),
    ]);
    setSelected(new Set());
  }, [loadTab]);

  useEffect(() => {
    mediaCacheRef.current.clear();
    setSamplesByTab(EMPTY_SAMPLES);
    setInitialLoading(true);
    setSelected(new Set());
    void stopActivePlayback();
    setPlayback(null);
    void loadTab(tab);
    const other: TabStage = tab === "unprocessed" ? "processed" : "unprocessed";
    void loadTab(other, { silent: true });
  }, [spaceId, voiceId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    return () => {
      void stopActivePlayback();
    };
  }, []);

  const switchTab = (next: TabStage) => {
    if (next === tab) return;
    void stopActivePlayback();
    setPlayback(null);
    setPlayBusyId(null);
    setSelected(new Set());
    setTab(next);
    if (!samplesByTab[next].length) {
      void loadTab(next, { silent: true });
    }
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const resolveTargetVoiceId = (ids: string[]) =>
    voiceId || samples.find((s) => ids.includes(s.id))?.voice_profile_id;

  const bulkStage = async (pipelineStage: "processed" | "archived") => {
    const ids = [...selected];
    const targetVoiceId = resolveTargetVoiceId(ids);
    if (!targetVoiceId || !ids.length || bulkBusy) return;
    const label = pipelineStage === "processed" ? "duyệt sang Sẵn sàng clone" : "loại (archive)";
    Alert.alert(
      pipelineStage === "processed" ? "Duyệt mẫu?" : "Loại mẫu?",
      `${ids.length} mẫu sẽ được ${label}.`,
      [
        { text: "Huỷ", style: "cancel" },
        {
          text: pipelineStage === "processed" ? "Duyệt" : "Loại",
          style: pipelineStage === "archived" ? "destructive" : "default",
          onPress: async () => {
            setBulkBusy(true);
            try {
              await api.bulkStageVoiceSamples(targetVoiceId, ids, pipelineStage);
              await refreshAllTabs();
            } catch (e) {
              Alert.alert("Lỗi", e instanceof Error ? e.message : "Không cập nhật được.");
            } finally {
              setBulkBusy(false);
            }
          },
        },
      ],
    );
  };

  const selectAll = () => {
    if (selected.size === samples.length) {
      setSelected(new Set());
      return;
    }
    setSelected(new Set(samples.map((s) => s.id)));
  };

  const combineSelected = async () => {
    const ids = [...selected];
    const targetVoiceId = resolveTargetVoiceId(ids);
    if (!targetVoiceId || ids.length < 2 || bulkBusy) return;
    Alert.alert(
      "Ghép mẫu?",
      `Ghép ${ids.length} đoạn thành 1 file mới${normalizeEnabled ? " (có normalize)" : ""}. Các đoạn gốc vẫn giữ ở Chưa xử lý.`,
      [
        { text: "Huỷ", style: "cancel" },
        {
          text: "Ghép",
          onPress: async () => {
            setBulkBusy(true);
            try {
              const res = await api.combineVoiceSamples(targetVoiceId, ids, {
                normalize: normalizeEnabled,
              });
              await refreshCurrentTab();
              const combined = res.voice.samples?.find((s) => s.id === res.sample_id);
              Alert.alert(
                "Đã ghép",
                combined?.duration_label
                  ? `File mới ~${combined.duration_label}. Nghe lại rồi Duyệt nếu ổn.`
                  : "File mới đã tạo. Nghe lại rồi Duyệt nếu ổn.",
              );
            } catch (e) {
              Alert.alert("Lỗi", e instanceof Error ? e.message : "Không ghép được.");
            } finally {
              setBulkBusy(false);
            }
          },
        },
      ],
    );
  };

  const processSelected = async () => {
    const ids = [...selected];
    const targetVoiceId = resolveTargetVoiceId(ids);
    if (!targetVoiceId || !ids.length || bulkBusy || !normalizeEnabled) return;
    Alert.alert(
      "Normalize mẫu?",
      `Tạo ${ids.length} bản mới đã cân bằng âm lượng. File gốc giữ nguyên.`,
      [
        { text: "Huỷ", style: "cancel" },
        {
          text: "Xử lý",
          onPress: async () => {
            setBulkBusy(true);
            try {
              const res = await api.processVoiceSamples(targetVoiceId, ids, {
                normalize: true,
              });
              await refreshCurrentTab();
              Alert.alert(
                "Đã xử lý",
                `Tạo ${res.created_sample_ids.length} bản mới. Nghe lại rồi Duyệt nếu ổn.`,
              );
            } catch (e) {
              Alert.alert("Lỗi", e instanceof Error ? e.message : "Không xử lý được.");
            } finally {
              setBulkBusy(false);
            }
          },
        },
      ],
    );
  };

  const togglePlay = async (item: VoiceSample) => {
    const vid = item.voice_profile_id;
    if (!vid || playLockRef.current) return;

    if (playback?.id === item.id) {
      if (playback.paused) {
        if (resumeActivePlayback()) setPlayback({ id: item.id, paused: false });
        return;
      }
      if (pauseActivePlayback()) setPlayback({ id: item.id, paused: true });
      return;
    }

    playLockRef.current = true;
    setPlayBusyId(item.id);
    try {
      let uri = mediaCacheRef.current.get(item.id);
      if (!uri) {
        const url = api.voiceSampleMediaUrl(vid, item.id);
        uri = await fetchAuthedMediaUri(
          url,
          `voice-sample-${item.id}`,
          item.media_mime,
        );
        mediaCacheRef.current.set(item.id, uri);
      }
      await stopActivePlayback();
      setPlayback({ id: item.id, paused: false });
      setPlayBusyId(null);
      await playLocalAudio(uri, () => setPlayback(null));
    } catch (e) {
      setPlayback(null);
      Alert.alert("Lỗi", e instanceof Error ? e.message : "Không phát được.");
    } finally {
      playLockRef.current = false;
      setPlayBusyId(null);
    }
  };

  const saveNote = async (item: VoiceSample) => {
    const vid = item.voice_profile_id;
    if (!vid || saving) return;
    setSaving(true);
    try {
      const updated = await api.updateVoiceSampleNote(vid, item.id, draftNote);
      setSamplesByTab((prev) => ({
        ...prev,
        [tab]: prev[tab].map((s) => (s.id === item.id ? { ...s, ...updated } : s)),
      }));
      setEditingId(null);
    } catch (e) {
      Alert.alert("Lỗi", e instanceof Error ? e.message : "Không lưu ghi chú.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (item: VoiceSample) => {
    const vid = item.voice_profile_id;
    if (!vid) return;
    Alert.alert("Xóa sample?", "Sample sẽ bị xóa và cần Clone lại nếu voice đang ready.", [
      { text: "Huỷ", style: "cancel" },
      {
        text: "Xóa",
        style: "destructive",
        onPress: async () => {
          try {
            await api.deleteVoiceSample(vid, item.id);
            if (playback?.id === item.id) {
              await stopActivePlayback();
              setPlayback(null);
            }
            mediaCacheRef.current.delete(item.id);
            await refreshAllTabs();
          } catch (e) {
            Alert.alert("Lỗi", e instanceof Error ? e.message : "Không xóa được.");
          }
        },
      },
    ]);
  };

  const totalDuration = useMemo(
    () => samples.reduce((sum, s) => sum + (s.duration_ms ?? 0), 0),
    [samples],
  );

  if (initialLoading && !samples.length && !samplesByTab.unprocessed.length && !samplesByTab.processed.length) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }

  const renderItem = (item: VoiceSample, index: number) => {
    const scoreColor =
      (item.quality_score ?? 0) >= 75
        ? colors.brand
        : (item.quality_score ?? 0) >= 55
          ? colors.accent
          : colors.danger;
    const isLoading = playBusyId === item.id;
    const isActive = playback?.id === item.id;
    const isPaused = isActive && playback?.paused;
    const checked = selected.has(item.id);

    return (
      <View style={[styles.card, checked && styles.cardSelected]}>
        <Pressable style={styles.selectRow} onPress={() => toggleSelect(item.id)}>
          <View style={[styles.checkbox, checked && styles.checkboxOn]}>
            {checked ? <Text style={styles.checkMark}>✓</Text> : null}
          </View>
          <Text style={styles.title}>
            #{index + 1} · {item.voice_display_name ?? "Voice"} ·{" "}
            {item.duration_label ?? "—:—"}
          </Text>
        </Pressable>
        <Text style={styles.meta}>
          {item.voice_subject_kind === "heritage" ? "Ký ức" : "Giọng sống"} ·{" "}
          {sourceLabel(item.source)}
          {item.parent_sample_ids?.length
            ? ` · từ ${item.parent_sample_ids.length} đoạn`
            : ""}
          {item.processing_applied?.normalize ? " · normalize" : ""}{" "}
          · {item.created_at.slice(0, 16).replace("T", " ")}
        </Text>
        <Text style={[styles.score, { color: scoreColor }]}>
          {item.quality_score != null
            ? `${item.quality_score} · ${item.quality_label ?? ""}`
            : "Chưa chấm điểm"}
        </Text>
        {item.quality_tip ? <Text style={styles.tip}>{item.quality_tip}</Text> : null}

        <View style={styles.noteBox}>
          <Text style={styles.noteLabel}>Ghi chú / nội dung nói</Text>
          {editingId === item.id ? (
            <>
              <TextInput
                style={styles.noteInput}
                value={draftNote}
                onChangeText={setDraftNote}
                placeholder="Vd: đoạn kể về Tết 1998, giọng ấm..."
                placeholderTextColor={colors.inkSoft}
                multiline
              />
              <View style={styles.row}>
                <Pressable style={styles.btn} onPress={() => saveNote(item)} disabled={saving}>
                  <Text style={styles.btnText}>{saving ? "Đang lưu…" : "Lưu"}</Text>
                </Pressable>
                <Pressable style={styles.btnGhost} onPress={() => setEditingId(null)}>
                  <Text style={styles.btnGhostText}>Huỷ</Text>
                </Pressable>
              </View>
            </>
          ) : (
            <>
              <Text style={styles.noteBody}>
                {item.note?.trim() ? item.note : "Chưa có ghi chú text."}
              </Text>
              <Pressable
                onPress={() => {
                  setEditingId(item.id);
                  setDraftNote(item.note ?? "");
                }}
              >
                <Text style={styles.editLink}>Sửa ghi chú</Text>
              </Pressable>
            </>
          )}
        </View>

        <View style={styles.row}>
          <Pressable
            style={[styles.playBtn, (!!playBusyId || isLoading) && styles.playBtnBusy]}
            onPress={() => togglePlay(item)}
            disabled={!!playBusyId}
          >
            <Text style={styles.playText}>
              {isLoading
                ? "Tải…"
                : !isActive
                  ? "Nghe"
                  : isPaused
                    ? "Tiếp tục"
                    : "Tạm dừng"}
            </Text>
          </Pressable>
          {tab === "unprocessed" ? (
            <Pressable
              onPress={async () => {
                const vid = item.voice_profile_id;
                if (!vid) return;
                try {
                  await api.updateVoiceSampleStage(vid, item.id, "processed");
                  await refreshAllTabs();
                } catch (e) {
                  Alert.alert("Lỗi", e instanceof Error ? e.message : "Không duyệt được.");
                }
              }}
            >
              <Text style={styles.approve}>Duyệt</Text>
            </Pressable>
          ) : null}
          <Pressable onPress={() => remove(item)}>
            <Text style={styles.delete}>Xóa</Text>
          </Pressable>
        </View>
      </View>
    );
  };

  return (
    <FlatList
      style={styles.root}
      contentContainerStyle={styles.content}
      data={samples}
      keyExtractor={(s) => s.id}
      ListHeaderComponent={
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Mẫu giọng</Text>
          <Text style={styles.headerSub}>
            {tab === "unprocessed"
              ? "Chọn mẫu → Normalize hoặc Ghép (2+). File gốc luôn giữ nguyên."
              : "Chỉ mẫu đã duyệt mới được dùng khi Clone (tối đa 3 file, ~1–2 phút)."}
          </Text>
          <View style={styles.tabs}>
            <Pressable
              style={[styles.tab, tab === "unprocessed" && styles.tabActive]}
              onPress={() => switchTab("unprocessed")}
            >
              <Text style={[styles.tabText, tab === "unprocessed" && styles.tabTextActive]}>
                Chưa xử lý
              </Text>
            </Pressable>
            <Pressable
              style={[styles.tab, tab === "processed" && styles.tabActive]}
              onPress={() => switchTab("processed")}
            >
              <Text style={[styles.tabText, tab === "processed" && styles.tabTextActive]}>
                Sẵn sàng clone
              </Text>
            </Pressable>
          </View>
          <Text style={styles.count}>
            {samples.length} mẫu · {formatDurationMs(totalDuration)} tổng
            {voiceId ? " · lọc theo Voice DNA" : ""}
            {tabRefreshing === tab ? " · đang cập nhật…" : ""}
          </Text>
          {tab === "unprocessed" ? (
            <View style={styles.normalizeRow}>
              <View style={styles.normalizeCopy}>
                <Text style={styles.normalizeLabel}>Cân bằng âm lượng</Text>
                <Text style={styles.normalizeHint}>
                  Normalize trước khi Ghép hoặc Xử lý từng mẫu
                </Text>
              </View>
              <Switch
                value={normalizeEnabled}
                onValueChange={setNormalizeEnabled}
                trackColor={{ false: colors.line, true: colors.brandSoft }}
                thumbColor={normalizeEnabled ? colors.brand : "#f4f3f4"}
              />
            </View>
          ) : null}
          {tab === "unprocessed" && samples.length > 0 ? (
            <Pressable onPress={selectAll} hitSlop={6}>
              <Text style={styles.selectAll}>
                {selected.size === samples.length ? "Bỏ chọn tất cả" : "Chọn tất cả"}
              </Text>
            </Pressable>
          ) : null}
          {selected.size > 0 ? (
            <View style={styles.bulkRow}>
              <Text style={styles.bulkLabel}>{selected.size} đã chọn</Text>
              {tab === "unprocessed" && normalizeEnabled ? (
                <Pressable
                  style={[styles.btnSecondary, bulkBusy && styles.disabled]}
                  onPress={processSelected}
                  disabled={bulkBusy}
                >
                  <Text style={styles.btnSecondaryText}>
                    {bulkBusy ? "Đang xử lý…" : "Xử lý"}
                  </Text>
                </Pressable>
              ) : null}
              {tab === "unprocessed" && selected.size >= 2 ? (
                <Pressable
                  style={[styles.btnSecondary, bulkBusy && styles.disabled]}
                  onPress={combineSelected}
                  disabled={bulkBusy}
                >
                  <Text style={styles.btnSecondaryText}>
                    {bulkBusy ? "Đang ghép…" : "Ghép"}
                  </Text>
                </Pressable>
              ) : null}
              {tab === "unprocessed" ? (
                <Pressable
                  style={[styles.btn, bulkBusy && styles.disabled]}
                  onPress={() => bulkStage("processed")}
                  disabled={bulkBusy}
                >
                  <Text style={styles.btnText}>
                    {bulkBusy ? "Đang lưu…" : "Duyệt → Sẵn sàng clone"}
                  </Text>
                </Pressable>
              ) : null}
              <Pressable
                style={styles.btnGhost}
                onPress={() => bulkStage("archived")}
                disabled={bulkBusy}
              >
                <Text style={styles.btnGhostText}>Loại</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      }
      ListEmptyComponent={
        <Text style={styles.empty}>
          {tab === "unprocessed"
            ? "Không còn mẫu chưa xử lý. Import từ pool hoặc chuyển sang tab Sẵn sàng clone."
            : "Chưa có mẫu sẵn clone. Duyệt mẫu tốt từ tab Chưa xử lý."}
        </Text>
      }
      renderItem={({ item, index }) => renderItem(item, index + 1)}
    />
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 20, paddingBottom: 40, gap: 8 },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bg,
  },
  header: { gap: 6, marginBottom: 12 },
  headerTitle: { fontFamily: fonts.display, fontSize: 24, color: colors.ink },
  headerSub: { fontSize: 14, lineHeight: 20, color: colors.inkSoft },
  tabs: { flexDirection: "row", gap: 8, marginTop: 8 },
  tab: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.line,
    paddingVertical: 10,
    alignItems: "center",
    backgroundColor: colors.card,
  },
  tabActive: { borderColor: colors.brand, backgroundColor: colors.bgDeep },
  tabText: { fontSize: 13, fontWeight: "600", color: colors.inkSoft },
  tabTextActive: { color: colors.brand },
  count: { fontSize: 13, fontWeight: "600", color: colors.brand, marginTop: 4 },
  selectAll: { fontSize: 13, fontWeight: "700", color: colors.brand, marginTop: 4 },
  normalizeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginTop: 8,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
  },
  normalizeCopy: { flex: 1, gap: 2 },
  normalizeLabel: { fontSize: 14, fontWeight: "700", color: colors.ink },
  normalizeHint: { fontSize: 12, lineHeight: 16, color: colors.inkSoft },
  bulkRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8, marginTop: 8 },
  bulkLabel: { fontSize: 13, fontWeight: "700", color: colors.ink },
  empty: { fontSize: 14, color: colors.inkSoft, marginTop: 20 },
  card: {
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 14,
    gap: 8,
    marginBottom: 8,
  },
  cardSelected: { borderColor: colors.brand },
  selectRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.line,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxOn: { borderColor: colors.brand, backgroundColor: colors.brand },
  checkMark: { color: "#fff", fontWeight: "700", fontSize: 14 },
  title: { flex: 1, fontSize: 15, fontWeight: "700", color: colors.ink },
  meta: { fontSize: 12, color: colors.inkSoft },
  score: { fontSize: 13, fontWeight: "700" },
  tip: { fontSize: 12, lineHeight: 17, color: colors.inkSoft },
  noteBox: {
    backgroundColor: colors.bgDeep,
    borderRadius: 10,
    padding: 10,
    gap: 6,
  },
  noteLabel: { fontSize: 11, fontWeight: "700", color: colors.inkSoft },
  noteBody: { fontSize: 14, lineHeight: 20, color: colors.ink },
  noteInput: {
    minHeight: 72,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 8,
    padding: 10,
    backgroundColor: "#fff",
    color: colors.ink,
    fontSize: 14,
  },
  editLink: { fontSize: 13, fontWeight: "700", color: colors.brand },
  row: { flexDirection: "row", alignItems: "center", gap: 12, flexWrap: "wrap" },
  playBtn: {
    backgroundColor: colors.brand,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 14,
    minWidth: 88,
    alignItems: "center",
  },
  playBtnBusy: { opacity: 0.7 },
  playText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  approve: { color: colors.brand, fontWeight: "700", fontSize: 13 },
  delete: { color: colors.danger, fontWeight: "700", fontSize: 13 },
  btn: {
    backgroundColor: colors.brand,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  btnText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  btnSecondary: {
    borderWidth: 1,
    borderColor: colors.brand,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 14,
    backgroundColor: colors.bgDeep,
  },
  btnSecondaryText: { color: colors.brand, fontWeight: "700", fontSize: 13 },
  btnGhost: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  btnGhostText: { color: colors.inkSoft, fontWeight: "600", fontSize: 13 },
  disabled: { opacity: 0.5 },
});
