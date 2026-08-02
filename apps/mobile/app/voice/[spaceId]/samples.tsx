import { VoiceSample } from "@forever/api-client";
import { useNavigation } from "@react-navigation/native";
import { useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
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
import { colors, fonts } from "@/lib/theme";

type Playback = { id: string; paused: boolean } | null;
type TabStage = "unprocessed" | "processed";

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
  const navigation = useNavigation();
  const initialTab: TabStage =
    stageParam === "processed" ? "processed" : "unprocessed";
  const [tab, setTab] = useState<TabStage>(initialTab);
  const [samples, setSamples] = useState<VoiceSample[]>([]);
  const [loading, setLoading] = useState(true);
  const [playback, setPlayback] = useState<Playback>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftNote, setDraftNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  useLayoutEffect(() => {
    navigation.setOptions({ title: "Mẫu giọng" });
  }, [navigation]);

  const load = useCallback(async () => {
    if (!spaceId) return;
    setLoading(true);
    try {
      const res = await api.listSpaceVoiceSamples(spaceId, voiceId || undefined, tab);
      setSamples(res.samples);
      setSelected(new Set());
    } catch (e) {
      Alert.alert("Lỗi", e instanceof Error ? e.message : "Không tải sample.");
    } finally {
      setLoading(false);
    }
  }, [api, spaceId, voiceId, tab]);

  useEffect(() => {
    load();
    return () => {
      void stopActivePlayback();
    };
  }, [load]);

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
              await load();
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
      `Ghép ${ids.length} đoạn thành 1 file mới. Các đoạn gốc vẫn giữ ở Chưa xử lý.`,
      [
        { text: "Huỷ", style: "cancel" },
        {
          text: "Ghép",
          onPress: async () => {
            setBulkBusy(true);
            try {
              const res = await api.combineVoiceSamples(targetVoiceId, ids);
              await load();
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

  const togglePlay = async (item: VoiceSample) => {
    const vid = item.voice_profile_id;
    if (!vid) return;

    if (playback?.id === item.id) {
      if (playback.paused) {
        if (resumeActivePlayback()) setPlayback({ id: item.id, paused: false });
        return;
      }
      if (pauseActivePlayback()) setPlayback({ id: item.id, paused: true });
      return;
    }

    try {
      const url = api.voiceSampleMediaUrl(vid, item.id);
      const uri = await fetchAuthedMediaUri(url, `voice-sample-${item.id}`, item.media_mime);
      setPlayback({ id: item.id, paused: false });
      await playLocalAudio(uri, () => setPlayback(null));
    } catch (e) {
      setPlayback(null);
      Alert.alert("Lỗi", e instanceof Error ? e.message : "Không phát được.");
    }
  };

  const saveNote = async (item: VoiceSample) => {
    const vid = item.voice_profile_id;
    if (!vid || saving) return;
    setSaving(true);
    try {
      const updated = await api.updateVoiceSampleNote(vid, item.id, draftNote);
      setSamples((prev) => prev.map((s) => (s.id === item.id ? { ...s, ...updated } : s)));
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
            await load();
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

  if (loading) {
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
            : ""}{" "}
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
          <Pressable style={styles.playBtn} onPress={() => togglePlay(item)}>
            <Text style={styles.playText}>
              {!isActive ? "Nghe" : isPaused ? "Tiếp tục" : "Tạm dừng"}
            </Text>
          </Pressable>
          {isActive && !isPaused ? (
            <Pressable
              style={styles.pauseBtn}
              onPress={() => {
                if (pauseActivePlayback()) setPlayback({ id: item.id, paused: true });
              }}
            >
              <Text style={styles.pauseText}>Pause</Text>
            </Pressable>
          ) : null}
          {tab === "unprocessed" ? (
            <Pressable
              onPress={async () => {
                const vid = item.voice_profile_id;
                if (!vid) return;
                try {
                  await api.updateVoiceSampleStage(vid, item.id, "processed");
                  await load();
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
              ? "Chọn 2+ đoạn → Ghép thành file dài hơn, hoặc Duyệt từng mẫu sạch."
              : "Chỉ mẫu đã duyệt mới được dùng khi Clone (tối đa 3 file, ~1–2 phút)."}
          </Text>
          <View style={styles.tabs}>
            <Pressable
              style={[styles.tab, tab === "unprocessed" && styles.tabActive]}
              onPress={() => setTab("unprocessed")}
            >
              <Text style={[styles.tabText, tab === "unprocessed" && styles.tabTextActive]}>
                Chưa xử lý
              </Text>
            </Pressable>
            <Pressable
              style={[styles.tab, tab === "processed" && styles.tabActive]}
              onPress={() => setTab("processed")}
            >
              <Text style={[styles.tabText, tab === "processed" && styles.tabTextActive]}>
                Sẵn sàng clone
              </Text>
            </Pressable>
          </View>
          <Text style={styles.count}>
            {samples.length} mẫu · {formatDurationMs(totalDuration)} tổng
            {voiceId ? " · lọc theo Voice DNA" : ""}
          </Text>
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
  },
  playText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  pauseBtn: {
    borderWidth: 1,
    borderColor: colors.brand,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  pauseText: { color: colors.brand, fontWeight: "700", fontSize: 13 },
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
