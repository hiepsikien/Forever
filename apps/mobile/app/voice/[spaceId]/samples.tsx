import { VoiceSample } from "@forever/api-client";
import { useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  pauseActivePlayback,
  playLocalAudio,
  resumeActivePlayback,
  stopActivePlayback,
} from "@/lib/audio";
import { useAuth } from "@/lib/auth";
import { formatLocalDateTime } from "@/lib/datetime";
import { fetchAuthedMediaUri } from "@/lib/media";
import { useSpaceScreenOptions } from "@/lib/spaceHeader";
import { colors, fonts } from "@/lib/theme";

type Playback = { id: string; paused: boolean } | null;
type TabStage = "unprocessed" | "processed" | "archived";
type SamplesByTab = Record<TabStage, VoiceSample[]>;

const EMPTY_SAMPLES: SamplesByTab = {
  unprocessed: [],
  processed: [],
  archived: [],
};

const TAB_META: Record<
  TabStage,
  { label: string; sub: string; empty: string }
> = {
  unprocessed: {
    label: "Chưa xử lý",
    sub: "Chọn mẫu → Cân bằng âm lượng, Ghép / Ghép êm (2+), hoặc Chia đôi (1 file dài). File gốc luôn giữ nguyên.",
    empty:
      "Không còn mẫu chưa xử lý. Import từ pool hoặc chuyển sang tab Sẵn sàng clone.",
  },
  processed: {
    label: "Sẵn sàng clone",
    sub: "Chỉ mẫu đã duyệt mới được dùng khi Clone (tối đa 3 file, ~1–2 phút). File quá dài/lớn: chọn 1 → Chia đôi.",
    empty: "Chưa có mẫu sẵn clone. Duyệt mẫu tốt từ tab Chưa xử lý.",
  },
  archived: {
    label: "Đã loại",
    sub: "Mẫu đã loại khỏi clone. Khôi phục về Chưa xử lý hoặc Sẵn sàng clone khi cần.",
    empty: "Chưa có mẫu đã loại.",
  },
};

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
    case "smart_combine":
      return "Ghép êm";
    case "process":
      return "Đã normalize";
    case "split":
      return "Chia đôi";
    default:
      return source;
  }
}

function formatDurationMs(ms: number | null | undefined): string {
  if (ms == null || ms < 0) return "—:—";
  const totalSec = Math.round(ms / 1000);
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds
      .toString()
      .padStart(2, "0")}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export default function VoiceSamplesScreen() {
  const { spaceId, voiceId, stage: stageParam } = useLocalSearchParams<{
    spaceId: string;
    voiceId?: string;
    stage?: string;
  }>();
  const { api } = useAuth();
  const insets = useSafeAreaInsets();
  const initialTab: TabStage =
    stageParam === "processed"
      ? "processed"
      : stageParam === "archived"
        ? "archived"
        : "unprocessed";
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

  const samples = samplesByTab[tab];

  const selectedDuration = useMemo(
    () =>
      samples
        .filter((s) => selected.has(s.id))
        .reduce((sum, s) => sum + (s.duration_ms ?? 0), 0),
    [samples, selected],
  );

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
      loadTab("archived", { silent: true }),
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
    (["unprocessed", "processed", "archived"] as TabStage[])
      .filter((s) => s !== tab)
      .forEach((s) => {
        void loadTab(s, { silent: true });
      });
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

  const bulkStage = async (
    pipelineStage: "unprocessed" | "processed" | "archived",
  ) => {
    const ids = [...selected];
    const targetVoiceId = resolveTargetVoiceId(ids);
    if (!targetVoiceId || !ids.length || bulkBusy) return;
    const labels: Record<typeof pipelineStage, string> = {
      unprocessed: "khôi phục về Chưa xử lý",
      processed: "duyệt sang Sẵn sàng clone",
      archived: "loại khỏi danh sách đang dùng",
    };
    const titles: Record<typeof pipelineStage, string> = {
      unprocessed: "Khôi phục mẫu?",
      processed: "Duyệt mẫu?",
      archived: "Loại mẫu?",
    };
    const confirmLabels: Record<typeof pipelineStage, string> = {
      unprocessed: "Khôi phục",
      processed: "Duyệt",
      archived: "Loại",
    };
    const dur = formatDurationMs(
      samples
        .filter((s) => ids.includes(s.id))
        .reduce((sum, s) => sum + (s.duration_ms ?? 0), 0),
    );
    Alert.alert(
      titles[pipelineStage],
      `${ids.length} mẫu (${dur}) sẽ được ${labels[pipelineStage]}.`,
      [
        { text: "Huỷ", style: "cancel" },
        {
          text: confirmLabels[pipelineStage],
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

  const clearSelection = () => {
    if (!selected.size) return;
    Alert.alert(
      "Trở về?",
      `Bỏ chọn ${selected.size} mẫu đang chọn.`,
      [
        { text: "Huỷ", style: "cancel" },
        {
          text: "Trở về",
          onPress: () => setSelected(new Set()),
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
    const dur = formatDurationMs(selectedDuration);
    Alert.alert(
      "Ghép mẫu?",
      `Ghép ${ids.length} đoạn (tổng ${dur}) thành 1 file mới. Các đoạn gốc vẫn giữ ở Chưa xử lý.`,
      [
        { text: "Huỷ", style: "cancel" },
        {
          text: "Ghép",
          onPress: async () => {
            setBulkBusy(true);
            try {
              const res = await api.combineVoiceSamples(targetVoiceId, ids, {
                normalize: false,
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

  const smartCombineSelected = async () => {
    const ids = [...selected];
    const targetVoiceId = resolveTargetVoiceId(ids);
    if (!targetVoiceId || ids.length < 2 || bulkBusy) return;
    const dur = formatDurationMs(selectedDuration);
    Alert.alert(
      "Ghép êm?",
      `Ghép ${ids.length} đoạn (tổng ${dur}) với cân âm lượng, fade nhẹ và khoảng lặng ngắn giữa đoạn — giảm ngắt hơi / nhảy nền. Thứ tự theo thời gian trên băng gốc nếu có.`,
      [
        { text: "Huỷ", style: "cancel" },
        {
          text: "Ghép êm",
          onPress: async () => {
            setBulkBusy(true);
            try {
              const res = await api.smartCombineVoiceSamples(targetVoiceId, ids);
              await refreshCurrentTab();
              const combined = res.voice.samples?.find((s) => s.id === res.sample_id);
              Alert.alert(
                "Đã ghép êm",
                combined?.duration_label
                  ? `File mới ~${combined.duration_label}. Nghe lại rồi Duyệt nếu ổn.`
                  : "File mới đã tạo. Nghe lại rồi Duyệt nếu ổn.",
              );
            } catch (e) {
              Alert.alert(
                "Lỗi",
                e instanceof Error ? e.message : "Không ghép êm được.",
              );
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
    if (!targetVoiceId || !ids.length || bulkBusy) return;
    const dur = formatDurationMs(selectedDuration);
    Alert.alert(
      "Cân bằng âm lượng?",
      `Tạo ${ids.length} bản mới (${dur}) đã cân bằng âm lượng. File gốc giữ nguyên.`,
      [
        { text: "Huỷ", style: "cancel" },
        {
          text: "Cân bằng",
          onPress: async () => {
            setBulkBusy(true);
            try {
              const res = await api.processVoiceSamples(targetVoiceId, ids, {
                normalize: true,
              });
              await refreshCurrentTab();
              Alert.alert(
                "Đã cân bằng",
                `Tạo ${res.created_sample_ids.length} bản mới. Nghe lại rồi Duyệt nếu ổn.`,
              );
            } catch (e) {
              Alert.alert("Lỗi", e instanceof Error ? e.message : "Không cân bằng được.");
            } finally {
              setBulkBusy(false);
            }
          },
        },
      ],
    );
  };

  const splitSelected = async () => {
    const ids = [...selected];
    const targetVoiceId = resolveTargetVoiceId(ids);
    if (!targetVoiceId || ids.length !== 1 || bulkBusy) return;
    const sample = samples.find((s) => s.id === ids[0]);
    const durLabel = sample?.duration_label ?? "—:—";
    const fromProcessed = tab === "processed";
    Alert.alert(
      "Chia đôi mẫu?",
      fromProcessed
        ? `Tách “${durLabel}” thành 2 nửa (~1/2 thời lượng mỗi file). File gốc sẽ bị Loại khỏi Sẵn sàng clone để tránh clone trùng.`
        : `Tách “${durLabel}” thành 2 nửa (~1/2 thời lượng). File gốc vẫn giữ ở Chưa xử lý.`,
      [
        { text: "Huỷ", style: "cancel" },
        {
          text: "Chia đôi",
          onPress: async () => {
            setBulkBusy(true);
            try {
              const res = await api.splitVoiceSample(targetVoiceId, ids[0]);
              await refreshAllTabs();
              const halves = (res.voice.samples ?? []).filter((s) =>
                res.sample_ids.includes(s.id),
              );
              const labels = halves
                .map((s) => s.duration_label)
                .filter(Boolean)
                .join(" + ");
              Alert.alert(
                "Đã chia đôi",
                labels
                  ? `Hai nửa: ${labels}.${
                      res.archived_original
                        ? " File gốc đã loại khỏi Sẵn sàng clone."
                        : " Nghe lại rồi Duyệt nếu ổn."
                    }`
                  : res.archived_original
                    ? "Hai nửa đã sẵn sàng clone. File gốc đã loại."
                    : "Hai nửa đã tạo. Nghe lại rồi Duyệt nếu ổn.",
              );
            } catch (e) {
              Alert.alert("Lỗi", e instanceof Error ? e.message : "Không chia được.");
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

  if (
    initialLoading &&
    !samples.length &&
    !samplesByTab.unprocessed.length &&
    !samplesByTab.processed.length &&
    !samplesByTab.archived.length
  ) {
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
          {item.processing_applied?.normalize ? " · normalize" : ""}
          {item.processing_applied?.from_video ? " · từ video" : ""}{" "}
          · {formatLocalDateTime(item.created_at)}
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
          {tab === "archived" ? (
            <>
              <Pressable
                onPress={async () => {
                  const vid = item.voice_profile_id;
                  if (!vid) return;
                  try {
                    await api.updateVoiceSampleStage(vid, item.id, "unprocessed");
                    await refreshAllTabs();
                  } catch (e) {
                    Alert.alert(
                      "Lỗi",
                      e instanceof Error ? e.message : "Không khôi phục được.",
                    );
                  }
                }}
              >
                <Text style={styles.approve}>Khôi phục</Text>
              </Pressable>
              <Pressable
                onPress={async () => {
                  const vid = item.voice_profile_id;
                  if (!vid) return;
                  try {
                    await api.updateVoiceSampleStage(vid, item.id, "processed");
                    await refreshAllTabs();
                  } catch (e) {
                    Alert.alert(
                      "Lỗi",
                      e instanceof Error ? e.message : "Không khôi phục được.",
                    );
                  }
                }}
              >
                <Text style={styles.approve}>→ Sẵn sàng clone</Text>
              </Pressable>
            </>
          ) : null}
          <Pressable onPress={() => remove(item)}>
            <Text style={styles.delete}>Xóa</Text>
          </Pressable>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.root}>
      <FlatList
        style={styles.list}
        contentContainerStyle={[
          styles.content,
          selected.size > 0 ? styles.contentWithBar : null,
        ]}
        data={samples}
        keyExtractor={(s) => s.id}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Mẫu giọng</Text>
            <Text style={styles.headerSub}>{TAB_META[tab].sub}</Text>
            <View style={styles.tabs}>
              {(["unprocessed", "processed", "archived"] as TabStage[]).map((stage) => (
                <Pressable
                  key={stage}
                  style={[styles.tab, tab === stage && styles.tabActive]}
                  onPress={() => switchTab(stage)}
                >
                  <Text style={[styles.tabText, tab === stage && styles.tabTextActive]}>
                    {TAB_META[stage].label}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.count}>
              {samples.length} mẫu · {formatDurationMs(totalDuration)} tổng
              {voiceId ? " · lọc theo Voice DNA" : ""}
              {tabRefreshing === tab ? " · đang cập nhật…" : ""}
            </Text>
            {samples.length > 0 ? (
              <Pressable onPress={selectAll} hitSlop={6}>
                <Text style={styles.selectAll}>
                  {selected.size === samples.length ? "Bỏ chọn tất cả" : "Chọn tất cả"}
                </Text>
              </Pressable>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          <Text style={styles.empty}>{TAB_META[tab].empty}</Text>
        }
        renderItem={({ item, index }) => renderItem(item, index + 1)}
      />

      {selected.size > 0 ? (
        <View
          style={[
            styles.stickyBar,
            { paddingBottom: Math.max(insets.bottom, 12) },
          ]}
        >
          <Text style={styles.stickyCount}>
            Đã chọn {selected.size} - tổng thời lượng {formatDurationMs(selectedDuration)}
          </Text>
          <View style={styles.bulkRow}>
            {tab === "unprocessed" ? (
              <Pressable
                style={[styles.actionBtn, bulkBusy && styles.disabled]}
                onPress={processSelected}
                disabled={bulkBusy}
              >
                <Text style={styles.actionBtnText}>
                  {bulkBusy ? "Đang xử lý…" : "Cân bằng âm lượng"}
                </Text>
              </Pressable>
            ) : null}
            {tab === "unprocessed" && selected.size >= 2 ? (
              <>
                <Pressable
                  style={[styles.actionBtn, bulkBusy && styles.disabled]}
                  onPress={combineSelected}
                  disabled={bulkBusy}
                >
                  <Text style={styles.actionBtnText}>
                    {bulkBusy ? "Đang ghép…" : "Ghép"}
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.actionBtn, bulkBusy && styles.disabled]}
                  onPress={smartCombineSelected}
                  disabled={bulkBusy}
                >
                  <Text style={styles.actionBtnText}>
                    {bulkBusy ? "Đang ghép êm…" : "Ghép êm"}
                  </Text>
                </Pressable>
              </>
            ) : null}
            {tab !== "archived" && selected.size === 1 ? (
              <Pressable
                style={[styles.actionBtn, bulkBusy && styles.disabled]}
                onPress={splitSelected}
                disabled={bulkBusy}
              >
                <Text style={styles.actionBtnText}>
                  {bulkBusy ? "Đang chia…" : "Chia đôi"}
                </Text>
              </Pressable>
            ) : null}
            {tab === "unprocessed" ? (
              <Pressable
                style={[styles.actionBtn, bulkBusy && styles.disabled]}
                onPress={() => bulkStage("processed")}
                disabled={bulkBusy}
              >
                <Text style={styles.actionBtnText}>
                  {bulkBusy ? "Đang lưu…" : "Duyệt"}
                </Text>
              </Pressable>
            ) : null}
            {tab === "archived" ? (
              <>
                <Pressable
                  style={[styles.actionBtn, bulkBusy && styles.disabled]}
                  onPress={() => bulkStage("unprocessed")}
                  disabled={bulkBusy}
                >
                  <Text style={styles.actionBtnText}>
                    {bulkBusy ? "Đang lưu…" : "Khôi phục"}
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.actionBtn, bulkBusy && styles.disabled]}
                  onPress={() => bulkStage("processed")}
                  disabled={bulkBusy}
                >
                  <Text style={styles.actionBtnText}>Duyệt</Text>
                </Pressable>
              </>
            ) : (
              <Pressable
                style={[styles.actionBtn, bulkBusy && styles.disabled]}
                onPress={() => bulkStage("archived")}
                disabled={bulkBusy}
              >
                <Text style={styles.actionBtnText}>Loại</Text>
              </Pressable>
            )}
            <Pressable
              style={[styles.actionBtn, bulkBusy && styles.disabled]}
              onPress={clearSelection}
              disabled={bulkBusy}
            >
              <Text style={styles.actionBtnText}>Trở về</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  list: { flex: 1 },
  content: { padding: 20, paddingBottom: 40, gap: 8 },
  contentWithBar: { paddingBottom: 140 },
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
    paddingVertical: 9,
    paddingHorizontal: 4,
    alignItems: "center",
    backgroundColor: colors.card,
  },
  tabActive: { borderColor: colors.brand, backgroundColor: colors.bgDeep },
  tabText: { fontSize: 12, fontWeight: "600", color: colors.inkSoft, textAlign: "center" },
  tabTextActive: { color: colors.brand },
  count: { fontSize: 13, fontWeight: "600", color: colors.brand, marginTop: 4 },
  selectAll: { fontSize: 13, fontWeight: "700", color: colors.brand, marginTop: 4 },
  stickyBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.card,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 10,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: -2 },
    elevation: 8,
  },
  stickyCount: { fontSize: 15, fontWeight: "700", color: colors.ink },
  bulkRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  actionBtn: {
    borderWidth: 1,
    borderColor: colors.brand,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 14,
    backgroundColor: colors.bgDeep,
  },
  actionBtnText: { color: colors.brand, fontWeight: "700", fontSize: 13 },
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
