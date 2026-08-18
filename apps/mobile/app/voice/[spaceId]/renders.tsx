import {
  minimaxEmotionLabel,
  VoiceProfile,
  VoiceRender,
  VoiceSample,
  type VoiceProvider,
  voiceProviderForModel,
  voiceProviderLabel,
  voiceTtsModelLabel,
} from "@forever/api-client";
import { useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";

import { AudioInfoSheet, AudioInfoTarget } from "@/components/AudioInfoSheet";
import {
  pauseActivePlayback,
  playLocalAudio,
  resumeActivePlayback,
  stopActivePlayback,
} from "@/lib/audio";
import { useAuth } from "@/lib/auth";
import { formatPct } from "@/lib/cloneSuggest";
import { formatLocalDateTime } from "@/lib/datetime";
import { useSpaceScreenOptions } from "@/lib/spaceHeader";
import {
  fetchAuthedMediaUri,
  prepareAudioExport,
  shareLocalAudio,
} from "@/lib/media";
import { colors, fonts, createThemedStyles } from "@/lib/theme";

type PlaybackKind = "render" | "sample";
type Playback = { id: string; kind: PlaybackKind; paused: boolean } | null;
type BusyAction = { id: string; kind: "share" | "apply" } | null;

function exportBaseName(item: VoiceRender): string {
  const voice = item.voice_display_name || "Voice-DNA";
  const stamp = item.created_at
    .slice(0, 16)
    .replace("T", "-")
    .replace(/:/g, "");
  const suffix = item.id.slice(-6);
  return `Forever-TTS-${voice}-${stamp}-${suffix}`;
}

type ParamRow = { label: string; value: string };

function formatSigned(value: number): string {
  if (value === 0) return "0";
  return value > 0 ? `+${value}` : `−${Math.abs(value)}`;
}

function renderParamRows(item: VoiceRender): ParamRow[] {
  const provider =
    item.provider ?? voiceProviderForModel(item.model_id) ?? "elevenlabs";
  const isMinimax = provider === "minimax";
  const rows: ParamRow[] = [
    {
      label: "Dịch vụ",
      value: voiceProviderLabel(provider),
    },
    { label: "Model", value: voiceTtsModelLabel(item.model_id) },
  ];
  if (item.provider_voice_name) {
    rows.push({ label: "Bản clone", value: item.provider_voice_name });
  }
  if (isMinimax) {
    // Always list MiniMax knobs — 0 is a real setting (neutral), not "missing".
    rows.push({
      label: "Cảm xúc",
      value: minimaxEmotionLabel(item.emotion),
    });
    rows.push({
      label: "Cao độ",
      value: formatSigned(item.pitch ?? 0),
    });
    rows.push({
      label: "Chất giọng",
      value: formatSigned(item.timbre ?? 0),
    });
    rows.push({
      label: "Lực đọc",
      value: formatSigned(item.intensity ?? 0),
    });
  } else {
    if (item.stability != null) {
      rows.push({ label: "Ổn định", value: formatPct(item.stability) });
    }
    if (item.similarity_boost != null) {
      rows.push({
        label: "Giống giọng",
        value: formatPct(item.similarity_boost),
      });
    }
    if (item.style != null) {
      rows.push({ label: "Phong cách", value: formatPct(item.style) });
    }
    if (item.use_speaker_boost != null) {
      rows.push({
        label: "Speaker boost",
        value: item.use_speaker_boost ? "Bật" : "Tắt",
      });
    }
  }
  if (item.speed != null) {
    rows.push({ label: "Tốc độ", value: item.speed.toFixed(2) });
  }
  if (item.lengthen_pauses != null) {
    rows.push({
      label: "Nghỉ câu",
      value: item.lengthen_pauses ? "Kéo dài" : "Mặc định",
    });
  }
  return rows;
}

function sampleChipLabel(sample: VoiceSample): string {
  const who = sample.voice_display_name ?? "Voice";
  return `${who} · ${sample.duration_label ?? "—:—"}`;
}

export default function VoiceRendersScreen() {
  const {
    spaceId,
    voiceId: voiceIdParam,
    providerVoiceId: providerVoiceIdParam,
    cloneName: cloneNameParam,
  } = useLocalSearchParams<{
    spaceId: string;
    voiceId?: string;
    providerVoiceId?: string;
    cloneName?: string;
  }>();
  const { api } = useAuth();
  const [voices, setVoices] = useState<VoiceProfile[]>([]);
  const [filterVoiceId, setFilterVoiceId] = useState<string | null>(
    voiceIdParam || null,
  );
  const providerVoiceId = Array.isArray(providerVoiceIdParam)
    ? providerVoiceIdParam[0]
    : providerVoiceIdParam;
  const cloneName = Array.isArray(cloneNameParam)
    ? cloneNameParam[0]
    : cloneNameParam;
  const [renders, setRenders] = useState<VoiceRender[]>([]);
  const [loading, setLoading] = useState(true);
  const [playback, setPlayback] = useState<Playback>(null);
  const [busy, setBusy] = useState<BusyAction>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [cleanSamples, setCleanSamples] = useState<VoiceSample[]>([]);
  const [compareSampleId, setCompareSampleId] = useState<string | null>(null);
  const [audioInfoTarget, setAudioInfoTarget] =
    useState<AudioInfoTarget | null>(null);

  const compareSample = useMemo(
    () => cleanSamples.find((s) => s.id === compareSampleId) ?? null,
    [cleanSamples, compareSampleId],
  );

  useSpaceScreenOptions({
    spaceId,
    title: providerVoiceId ? "TTS theo clone" : "Bản đã tạo",
    backTitle: "Nhà",
  });

  const load = useCallback(async () => {
    if (!spaceId) return;
    setLoading(true);
    try {
      const [v, r, s] = await Promise.all([
        api.listVoices(spaceId),
        api.listSpaceVoiceRenders(spaceId, {
          voiceId: filterVoiceId || undefined,
          providerVoiceId: providerVoiceId || undefined,
        }),
        api.listSpaceVoiceSamples(
          spaceId,
          filterVoiceId || undefined,
          "processed",
        ),
      ]);
      setVoices(v.voices);
      setRenders(r.renders);
      setCleanSamples(s.samples);
    } catch (e) {
      Alert.alert("Lỗi", e instanceof Error ? e.message : "Không tải lịch sử.");
    } finally {
      setLoading(false);
    }
  }, [api, spaceId, filterVoiceId, providerVoiceId]);

  useEffect(() => {
    load();
    return () => {
      void stopActivePlayback();
    };
  }, [load]);

  useEffect(() => {
    setCompareSampleId((current) =>
      current && cleanSamples.some((s) => s.id === current) ? current : null,
    );
  }, [cleanSamples]);

  const getPlayUri = async (item: VoiceRender): Promise<string> => {
    const url = api.voiceRenderMediaUrl(item.voice_profile_id, item.id);
    return fetchAuthedMediaUri(url, `voice-render-${item.id}`, item.media_mime);
  };

  const resolveExportUri = async (item: VoiceRender): Promise<string> => {
    const cached = await getPlayUri(item);
    return prepareAudioExport(cached, exportBaseName(item), item.media_mime);
  };

  const togglePlayback = async (
    id: string,
    kind: PlaybackKind,
    resolveUri: () => Promise<string>,
  ) => {
    if (playback?.id === id && playback.kind === kind) {
      if (playback.paused) {
        if (resumeActivePlayback()) setPlayback({ id, kind, paused: false });
        return;
      }
      if (pauseActivePlayback()) setPlayback({ id, kind, paused: true });
      return;
    }
    try {
      const uri = await resolveUri();
      setPlayback({ id, kind, paused: false });
      await playLocalAudio(uri, () => setPlayback(null));
    } catch (e) {
      setPlayback(null);
      Alert.alert("Lỗi", e instanceof Error ? e.message : "Không phát được.");
    }
  };

  const togglePlay = (item: VoiceRender) =>
    togglePlayback(item.id, "render", () => getPlayUri(item));

  const toggleSamplePlay = (sample: VoiceSample) => {
    const vid = sample.voice_profile_id;
    if (!vid) return;
    void togglePlayback(sample.id, "sample", () =>
      fetchAuthedMediaUri(
        api.voiceSampleMediaUrl(vid, sample.id),
        `voice-sample-${sample.id}`,
        sample.media_mime,
      ),
    );
  };

  const openRenderInfo = (item: VoiceRender) => {
    setAudioInfoTarget({
      label: `Bản TTS · ${voiceTtsModelLabel(item.model_id)} · ${
        item.voice_display_name || "Voice DNA"
      }`,
      load: () => api.voiceRenderAudioInfo(item.voice_profile_id, item.id),
    });
  };

  const openSampleInfo = (sample: VoiceSample) => {
    const vid = sample.voice_profile_id;
    if (!vid) return;
    setAudioInfoTarget({
      label: `Mẫu gốc · ${sampleChipLabel(sample)}`,
      load: () => api.voiceSampleAudioInfo(vid, sample.id),
    });
  };

  const shareRender = async (item: VoiceRender) => {
    if (busy) return;
    setBusy({ id: item.id, kind: "share" });
    try {
      const uri = await resolveExportUri(item);
      await shareLocalAudio(uri, {
        mimeType: item.media_mime,
        dialogTitle: exportBaseName(item),
      });
    } catch (e) {
      Alert.alert(
        "Lỗi",
        e instanceof Error ? e.message : "Không chia sẻ được.",
      );
    } finally {
      setBusy(null);
    }
  };

  const applyRenderForCall = async (item: VoiceRender) => {
    if (busy) return;
    const cloneId = (item.provider_voice_id || "").trim();
    if (!cloneId) {
      Alert.alert(
        "Thiếu bản clone",
        "Bản TTS này không ghi clone. Tạo lại từ «Tạo câu nói» rồi dùng nút này.",
      );
      return;
    }
    const who = item.voice_display_name || "người này";
    Alert.alert(
      "Dùng cho Gọi?",
      `Gắn model và setting của bản này cho cuộc gọi / chat ký ức của ${who}.`,
      [
        { text: "Huỷ", style: "cancel" },
        {
          text: "Dùng",
          onPress: async () => {
            setBusy({ id: item.id, kind: "apply" });
            try {
              const provider = (item.provider ??
                voiceProviderForModel(item.model_id) ??
                "elevenlabs") as VoiceProvider;
              await api.setChatTtsPrefs(item.voice_profile_id, {
                provider_voice_id: cloneId,
                provider,
                provider_voice_name: item.provider_voice_name || undefined,
                model_id: item.model_id || undefined,
                speed: item.speed ?? undefined,
                lengthen_pauses: item.lengthen_pauses ?? undefined,
                stability: item.stability ?? undefined,
                similarity_boost: item.similarity_boost ?? undefined,
                style: item.style ?? undefined,
                use_speaker_boost: item.use_speaker_boost ?? undefined,
                emotion: item.emotion || undefined,
                pitch: item.pitch ?? undefined,
                intensity: item.intensity ?? undefined,
                timbre: item.timbre ?? undefined,
              });
              Alert.alert(
                "Đã gắn cho Gọi",
                `${who} sẽ nói bằng clone và setting của bản này.`,
              );
            } catch (e) {
              Alert.alert(
                "Không gắn được",
                e instanceof Error ? e.message : "Thử lại sau.",
              );
            } finally {
              setBusy(null);
            }
          },
        },
      ],
    );
  };

  const remove = (item: VoiceRender) => {
    Alert.alert("Xóa bản TTS?", item.text.slice(0, 80), [
      { text: "Huỷ", style: "cancel" },
      {
        text: "Xóa",
        style: "destructive",
        onPress: async () => {
          try {
            await api.deleteVoiceRender(item.voice_profile_id, item.id);
            if (playback?.id === item.id && playback.kind === "render") {
              await stopActivePlayback();
              setPlayback(null);
            }
            await load();
          } catch (e) {
            Alert.alert(
              "Lỗi",
              e instanceof Error ? e.message : "Không xóa được.",
            );
          }
        },
      },
    ]);
  };

  if (loading && !renders.length) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }

  const filterVoices = voices.length
    ? voices
    : Array.from(
        new Map(
          renders
            .filter((r) => r.voice_profile_id)
            .map((r) => [
              r.voice_profile_id,
              {
                id: r.voice_profile_id,
                display_name: r.voice_display_name || "Voice DNA",
              },
            ]),
        ).values(),
      );

  return (
    <>
      <FlatList
        style={styles.root}
        contentContainerStyle={styles.content}
        data={renders}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={styles.title}>
              {providerVoiceId ? "TTS theo clone" : "Bản TTS đã tạo"}
            </Text>
            <Text style={styles.sub}>
              {providerVoiceId
                ? `Các câu nói tạo từ “${cloneName || "bản clone này"}”. Nhấn «Dùng cho Gọi» để gắn set đó.`
                : "Lọc theo người — nghe, gắn cho Gọi, hoặc chia sẻ từng bản."}
            </Text>
            {!providerVoiceId ? (
              <View style={styles.chips}>
                <Pressable
                  style={[styles.chip, !filterVoiceId && styles.chipActive]}
                  onPress={() => setFilterVoiceId(null)}
                >
                  <Text
                    style={[
                      styles.chipText,
                      !filterVoiceId && styles.chipTextActive,
                    ]}
                  >
                    Tất cả
                  </Text>
                </Pressable>
                {filterVoices.map((v) => {
                  const active = filterVoiceId === v.id;
                  return (
                    <Pressable
                      key={v.id}
                      style={[styles.chip, active && styles.chipActive]}
                      onPress={() => setFilterVoiceId(v.id)}
                    >
                      <Text
                        style={[
                          styles.chipText,
                          active && styles.chipTextActive,
                        ]}
                        numberOfLines={1}
                      >
                        {v.display_name}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}

            {cleanSamples.length ? (
              <View style={styles.compareBox}>
                <Text style={styles.compareTitle}>Mẫu đối chiếu</Text>
                <Text style={styles.compareHint}>
                  Chọn một mẫu đã sẵn sàng clone để nghe giọng gốc, rồi nghe bản
                  TTS bên dưới và so sánh.
                </Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.compareChips}
                >
                  {cleanSamples.map((sample) => {
                    const active = compareSampleId === sample.id;
                    return (
                      <Pressable
                        key={sample.id}
                        style={[styles.chip, active && styles.chipActive]}
                        onPress={() =>
                          setCompareSampleId(active ? null : sample.id)
                        }
                      >
                        <Text
                          style={[
                            styles.chipText,
                            active && styles.chipTextActive,
                          ]}
                          numberOfLines={1}
                        >
                          {sampleChipLabel(sample)}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
                {compareSample ? (
                  <View style={styles.compareRow}>
                    <Pressable
                      style={styles.compareBtn}
                      onPress={() => toggleSamplePlay(compareSample)}
                    >
                      <Text style={styles.compareBtnText}>
                        {playback?.id === compareSample.id &&
                        playback.kind === "sample"
                          ? playback.paused
                            ? "Tiếp tục mẫu gốc"
                            : "Tạm dừng mẫu gốc"
                          : "Nghe mẫu gốc"}
                      </Text>
                    </Pressable>
                    <Pressable
                      style={styles.compareInfoBtn}
                      onPress={() => openSampleInfo(compareSample)}
                    >
                      <Text style={styles.compareInfoText}>Thông số audio</Text>
                    </Pressable>
                  </View>
                ) : null}
              </View>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          <Text style={styles.empty}>
            {providerVoiceId
              ? "Chưa có câu nói từ bản clone này."
              : "Chưa có bản nào. Vào Tạo câu nói — mỗi lần tạo đều lưu tự động."}
          </Text>
        }
        renderItem={({ item }) => {
          const active = playback?.id === item.id && playback.kind === "render";
          const paused = active && playback?.paused;
          const when = formatLocalDateTime(item.created_at);
          const voiceName = item.voice_display_name || "Voice DNA";
          const sharing = busy?.id === item.id && busy.kind === "share";
          const applying = busy?.id === item.id && busy.kind === "apply";
          const itemBusy = sharing || applying;
          const expanded = expandedId === item.id;
          const params = renderParamRows(item);
          const canApply = Boolean((item.provider_voice_id || "").trim());

          return (
            <View style={styles.card}>
              <View style={styles.voiceHeader}>
                <Text style={styles.voiceName} numberOfLines={1}>
                  {voiceName}
                </Text>
                <View style={styles.providerTag}>
                  <Text style={styles.providerTagText}>
                    {voiceProviderLabel(
                      item.provider ?? voiceProviderForModel(item.model_id),
                    )}
                  </Text>
                </View>
              </View>
              {item.provider_voice_name ? (
                <Text style={styles.cloneName} numberOfLines={2}>
                  {item.provider_voice_name}
                </Text>
              ) : null}
              <Text
                style={styles.body}
                numberOfLines={expanded ? undefined : 4}
              >
                {item.text}
              </Text>
              <View style={styles.metaRow}>
                <Text style={styles.meta} numberOfLines={2}>
                  {when}
                  {" · "}
                  {voiceTtsModelLabel(item.model_id)}
                </Text>
                <Pressable
                  style={styles.detailBtn}
                  onPress={() => setExpandedId(expanded ? null : item.id)}
                  hitSlop={8}
                >
                  <Text style={styles.detailLink}>
                    {expanded ? "Thu gọn" : "Xem chi tiết"}
                  </Text>
                </Pressable>
              </View>
              {expanded ? (
                <View style={styles.detailBox}>
                  {params.map((row) => (
                    <View key={row.label} style={styles.detailRow}>
                      <Text style={styles.detailLabel}>{row.label}</Text>
                      <Text style={styles.detailValue}>{row.value}</Text>
                    </View>
                  ))}
                  <Pressable
                    style={styles.detailInfoBtn}
                    onPress={() => openRenderInfo(item)}
                  >
                    <Text style={styles.detailInfoText}>Thông số audio</Text>
                  </Pressable>
                </View>
              ) : null}
              <Pressable
                style={[
                  styles.applyBtn,
                  (!canApply || itemBusy) && styles.disabled,
                ]}
                onPress={() => void applyRenderForCall(item)}
                disabled={!canApply || itemBusy}
              >
                {applying ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.applyBtnText}>Dùng cho Gọi</Text>
                )}
              </Pressable>
              {!canApply ? (
                <Text style={styles.applyHint}>
                  Bản cũ thiếu clone — tạo lại từ «Tạo câu nói» để gắn được.
                </Text>
              ) : null}
              <View style={styles.row}>
                <Pressable
                  style={styles.play}
                  onPress={() => togglePlay(item)}
                  disabled={itemBusy}
                >
                  <Text style={styles.playText}>
                    {!active ? "Nghe" : paused ? "Tiếp tục" : "Tạm dừng"}
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.secondary, itemBusy && styles.disabled]}
                  onPress={() => shareRender(item)}
                  disabled={itemBusy}
                >
                  {sharing ? (
                    <ActivityIndicator size="small" color={colors.brand} />
                  ) : (
                    <Text style={styles.secondaryText}>Chia sẻ</Text>
                  )}
                </Pressable>
                <Pressable
                  style={styles.deleteBtn}
                  onPress={() => remove(item)}
                  disabled={itemBusy}
                  hitSlop={6}
                >
                  <Text style={styles.delete}>Xóa</Text>
                </Pressable>
              </View>
            </View>
          );
        }}
      />
      <AudioInfoSheet
        target={audioInfoTarget}
        onClose={() => setAudioInfoTarget(null)}
      />
    </>
  );
}

const styles = createThemedStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 20, paddingBottom: 40, gap: 10 },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bg,
  },
  header: { gap: 6, marginBottom: 8 },
  title: { fontFamily: fonts.display, fontSize: 24, color: colors.ink },
  sub: { fontSize: 14, lineHeight: 20, color: colors.inkSoft },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: "#fff",
    maxWidth: 160,
  },
  chipActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipText: { fontSize: 13, fontWeight: "600", color: colors.inkSoft },
  chipTextActive: { color: "#fff" },
  empty: { fontSize: 14, color: colors.inkSoft, marginTop: 16 },
  card: {
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 14,
    gap: 8,
    marginBottom: 8,
  },
  voiceHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  voiceName: {
    flexShrink: 1,
    fontSize: 12,
    fontWeight: "700",
    color: colors.brand,
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  providerTag: {
    flexShrink: 0,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.bgDeep,
  },
  providerTagText: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.ink,
  },
  cloneName: { fontSize: 13, fontWeight: "600", color: colors.inkSoft },
  body: {
    fontFamily: fonts.display,
    fontSize: 16,
    lineHeight: 24,
    color: colors.ink,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  meta: { fontSize: 12, color: colors.inkSoft, flexShrink: 1 },
  detailBtn: { paddingVertical: 6, paddingLeft: 10 },
  detailLink: { fontSize: 13, fontWeight: "700", color: colors.brand },
  detailBox: {
    backgroundColor: colors.bgDeep,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  detailRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  detailLabel: { fontSize: 12, color: colors.inkSoft },
  detailValue: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.ink,
    flexShrink: 1,
    textAlign: "right",
  },
  detailInfoBtn: {
    marginTop: 8,
    marginBottom: 6,
    alignSelf: "flex-start",
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: "#fff",
    borderRadius: 8,
    paddingVertical: 7,
    paddingHorizontal: 12,
  },
  detailInfoText: { fontSize: 12, fontWeight: "700", color: colors.inkSoft },
  compareBox: {
    marginTop: 12,
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 12,
    gap: 8,
  },
  compareTitle: { fontSize: 13, fontWeight: "700", color: colors.ink },
  compareHint: { fontSize: 12, lineHeight: 17, color: colors.inkSoft },
  compareChips: { gap: 8, paddingVertical: 2 },
  compareRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  compareBtn: {
    borderWidth: 1,
    borderColor: colors.brand,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  compareBtnText: { color: colors.brand, fontWeight: "700", fontSize: 13 },
  compareInfoBtn: {
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: "#fff",
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  compareInfoText: { fontSize: 13, fontWeight: "700", color: colors.inkSoft },
  applyBtn: {
    backgroundColor: colors.brand,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
    marginBottom: 4,
  },
  applyBtnText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  applyHint: {
    fontSize: 12,
    lineHeight: 17,
    color: colors.inkSoft,
    marginBottom: 6,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
  },
  play: {
    backgroundColor: colors.brandSoft,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  playText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  secondary: {
    borderWidth: 1,
    borderColor: colors.brand,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    minWidth: 64,
    alignItems: "center",
  },
  secondaryText: { color: colors.brand, fontWeight: "700", fontSize: 13 },
  disabled: { opacity: 0.5 },
  // Keeps the destructive action away from Nghe / Chia sẻ.
  deleteBtn: { marginLeft: "auto", paddingVertical: 8, paddingHorizontal: 8 },
  delete: { color: colors.danger, fontWeight: "700", fontSize: 13 },
}));
