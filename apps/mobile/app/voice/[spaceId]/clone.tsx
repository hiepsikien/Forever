import {
  VOICE_PROVIDERS,
  VoiceProvider,
  VoiceSample,
} from "@forever/api-client";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Switch,
  Text,
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
import {
  cloneMaxDurationMs,
  cloneMaxSamples,
  formatDurationMs,
  suggestCloneSampleIds,
} from "@/lib/cloneSuggest";
import { formatLocalDateTime } from "@/lib/datetime";
import { fetchAuthedMediaUri } from "@/lib/media";
import { useSpaceScreenOptions } from "@/lib/spaceHeader";
import { colors, fonts } from "@/lib/theme";

type Playback = { id: string; paused: boolean } | null;

export default function CloneVoiceScreen() {
  const { spaceId, voiceId } = useLocalSearchParams<{
    spaceId: string;
    voiceId?: string;
  }>();
  const { api } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [samples, setSamples] = useState<VoiceSample[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [provider, setProvider] = useState<VoiceProvider>("elevenlabs");
  const [removeNoise, setRemoveNoise] = useState(true);
  const [busy, setBusy] = useState(false);
  const [playback, setPlayback] = useState<Playback>(null);
  const [playBusyId, setPlayBusyId] = useState<string | null>(null);
  const mediaCacheRef = useRef<Map<string, string>>(new Map());
  const playLockRef = useRef(false);

  useSpaceScreenOptions({ spaceId, title: "Clone giọng", backTitle: "Nhà" });

  const maxDurationMs = cloneMaxDurationMs(provider);
  const maxSamples = cloneMaxSamples(provider);

  const applySuggestion = useCallback(
    (list: VoiceSample[]) => {
      setSelected(
        new Set(suggestCloneSampleIds(list, { maxDurationMs, maxSamples })),
      );
    },
    [maxDurationMs, maxSamples],
  );

  const load = useCallback(async () => {
    if (!spaceId || !voiceId) return;
    setLoading(true);
    try {
      const res = await api.listSpaceVoiceSamples(spaceId, voiceId, "processed");
      setSamples(res.samples);
    } catch (e) {
      Alert.alert("Lỗi", e instanceof Error ? e.message : "Không tải mẫu.");
    } finally {
      setLoading(false);
    }
  }, [api, spaceId, voiceId]);

  useEffect(() => {
    void load();
    return () => {
      void stopActivePlayback();
    };
  }, [load]);

  // Re-suggest when the list arrives and when the provider changes the budget.
  useEffect(() => {
    applySuggestion(samples);
  }, [samples, applySuggestion]);

  const suggestedIds = useMemo(
    () => new Set(suggestCloneSampleIds(samples, { maxDurationMs, maxSamples })),
    [samples, maxDurationMs, maxSamples],
  );
  const selectedSamples = useMemo(
    () => samples.filter((s) => selected.has(s.id)),
    [samples, selected],
  );
  const selectedDurationMs = useMemo(
    () => selectedSamples.reduce((sum, s) => sum + (s.duration_ms ?? 0), 0),
    [selectedSamples],
  );
  const overCount = selected.size > maxSamples;
  const overDuration = selectedDurationMs > maxDurationMs;
  const canSubmit =
    !!voiceId &&
    selected.size >= 1 &&
    !overCount &&
    !overDuration &&
    !busy;

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const togglePlay = async (item: VoiceSample) => {
    if (!voiceId || playLockRef.current) return;
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
        const url = api.voiceSampleMediaUrl(voiceId, item.id);
        uri = await fetchAuthedMediaUri(url, `clone-sample-${item.id}`, item.media_mime);
        mediaCacheRef.current.set(item.id, uri);
      }
      setPlayback({ id: item.id, paused: false });
      await playLocalAudio(uri, () => setPlayback(null));
    } catch (e) {
      setPlayback(null);
      Alert.alert("Lỗi", e instanceof Error ? e.message : "Không phát được.");
    } finally {
      setPlayBusyId(null);
      playLockRef.current = false;
    }
  };

  const submit = async () => {
    if (!voiceId || !canSubmit) return;
    setBusy(true);
    try {
      const res = await api.cloneVoice(voiceId, {
        sample_ids: [...selected],
        remove_background_noise: removeNoise,
        provider,
      });
      Alert.alert(
        res.status === "ready" ? "Voice DNA sẵn sàng" : "Clone xong",
        res.status === "ready"
          ? "Bạn có thể tạo giọng từ text."
          : res.error_message || res.status,
        [{ text: "OK", onPress: () => router.back() }],
      );
    } catch (e) {
      Alert.alert("Clone thất bại", e instanceof Error ? e.message : "Không clone được.");
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <FlatList
        style={styles.list}
        contentContainerStyle={[styles.content, styles.contentWithBar]}
        data={samples}
        keyExtractor={(s) => s.id}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={styles.title}>Chọn mẫu để clone</Text>
            <Text style={styles.sub}>
              Máy đã chọn sẵn vài mẫu tốt (1–{maxSamples}, tổng ≤{" "}
              {formatDurationMs(maxDurationMs)}). Sửa tick nếu muốn, rồi bấm Clone
              bên dưới.
            </Text>
            {samples.length > 0 ? (
              <Pressable
                onPress={() => applySuggestion(samples)}
                disabled={busy}
                hitSlop={6}
              >
                <Text style={[styles.suggestLink, busy && styles.disabled]}>
                  Gợi ý chọn mẫu
                </Text>
              </Pressable>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          <Text style={styles.empty}>
            Chưa có mẫu sẵn sàng. Vào Mẫu giọng → Duyệt ít nhất một đoạn sạch.
          </Text>
        }
        renderItem={({ item, index }) => {
          const checked = selected.has(item.id);
          const isLoading = playBusyId === item.id;
          const isActive = playback?.id === item.id;
          const isPaused = isActive && playback?.paused;
          const suggested = suggestedIds.has(item.id);
          return (
            <View style={[styles.card, checked && styles.cardSelected]}>
              <Pressable style={styles.selectRow} onPress={() => toggleSelect(item.id)}>
                <View style={[styles.checkbox, checked && styles.checkboxOn]}>
                  {checked ? <Text style={styles.checkMark}>✓</Text> : null}
                </View>
                <View style={styles.selectCopy}>
                  <Text style={styles.cardTitle}>
                    #{index + 1} ·{" "}
                    {item.duration_label ?? formatDurationMs(item.duration_ms)}
                    {suggested ? " · đề xuất" : ""}
                  </Text>
                  <Text style={styles.meta}>
                    {item.quality_score != null
                      ? `${item.quality_score} · ${item.quality_label ?? ""}`
                      : "Chưa chấm điểm"}
                    {" · "}
                    {formatLocalDateTime(item.created_at)}
                  </Text>
                </View>
              </Pressable>
              {item.note?.trim() ? (
                <Text style={styles.note} numberOfLines={2}>
                  {item.note}
                </Text>
              ) : null}
              <Pressable
                style={[styles.playBtn, (!!playBusyId || isLoading) && styles.disabled]}
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
            </View>
          );
        }}
      />

      <View
        style={[
          styles.stickyBar,
          { paddingBottom: Math.max(insets.bottom, 12) },
        ]}
      >
        <Text style={styles.stickyCount}>
          Đã chọn {selected.size} - tổng thời lượng{" "}
          {formatDurationMs(selectedDurationMs)}
        </Text>
        {overCount || overDuration ? (
          <Text style={styles.warn}>
            {overCount
              ? `Tối đa ${maxSamples} mẫu.`
              : `Tổng thời lượng quá dài — tối đa ${formatDurationMs(maxDurationMs)}.`}
          </Text>
        ) : null}
        <View style={styles.providerRow}>
          {VOICE_PROVIDERS.map((option) => {
            const active = option.id === provider;
            return (
              <Pressable
                key={option.id}
                style={[styles.providerChip, active && styles.providerChipOn]}
                onPress={() => {
                  setProvider(option.id);
                  // Forever already cleans samples; MiniMax reads them as-is.
                  setRemoveNoise(option.id !== "minimax");
                }}
                disabled={busy}
              >
                <Text
                  style={[styles.providerLabel, active && styles.providerLabelOn]}
                >
                  {option.label}
                </Text>
                <Text
                  style={[styles.providerHint, active && styles.providerHintOn]}
                >
                  {option.hint}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <View style={styles.noiseRow}>
          <View style={styles.noiseCopy}>
            <Text style={styles.noiseLabel}>Lọc tiếng ồn nền</Text>
            <Text style={styles.noiseHint}>
              Bật khi mẫu có ồn phòng — tắt nếu giọng đã sạch.
            </Text>
          </View>
          <Switch
            value={removeNoise}
            onValueChange={setRemoveNoise}
            trackColor={{ false: colors.line, true: colors.brandSoft }}
            thumbColor={removeNoise ? colors.brand : "#f4f3f4"}
          />
        </View>
        <Pressable
          style={[styles.btn, !canSubmit && styles.disabled]}
          onPress={submit}
          disabled={!canSubmit}
        >
          <Text style={styles.btnText}>
            {busy ? "Đang clone…" : `Clone (${selected.size})`}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  list: { flex: 1 },
  content: { padding: 20, paddingBottom: 40, gap: 8 },
  contentWithBar: { paddingBottom: 200 },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bg,
  },
  header: { gap: 8, marginBottom: 8 },
  title: { fontFamily: fonts.display, fontSize: 24, color: colors.ink },
  sub: { fontSize: 14, lineHeight: 20, color: colors.inkSoft },
  suggestLink: { fontSize: 14, fontWeight: "700", color: colors.brand },
  empty: { fontSize: 14, color: colors.inkSoft, marginTop: 16 },
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
  warn: { fontSize: 13, color: colors.danger, fontWeight: "600" },
  providerRow: { flexDirection: "row", gap: 8 },
  providerChip: {
    flex: 1,
    gap: 2,
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.bgDeep,
  },
  providerChipOn: { borderColor: colors.brand, backgroundColor: colors.brandSoft },
  providerLabel: { fontSize: 14, fontWeight: "700", color: colors.ink },
  providerLabelOn: { color: colors.brand },
  providerHint: { fontSize: 11, lineHeight: 15, color: colors.inkSoft },
  providerHintOn: { color: colors.ink },
  noiseRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.bgDeep,
  },
  noiseCopy: { flex: 1, gap: 2 },
  noiseLabel: { fontSize: 14, fontWeight: "700", color: colors.ink },
  noiseHint: { fontSize: 12, lineHeight: 16, color: colors.inkSoft },
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
  selectRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  selectCopy: { flex: 1, gap: 2 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.line,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  checkboxOn: { borderColor: colors.brand, backgroundColor: colors.brand },
  checkMark: { color: "#fff", fontWeight: "700", fontSize: 14 },
  cardTitle: { fontSize: 15, fontWeight: "700", color: colors.ink },
  meta: { fontSize: 12, color: colors.inkSoft },
  note: { fontSize: 13, lineHeight: 18, color: colors.inkSoft },
  playBtn: {
    alignSelf: "flex-start",
    backgroundColor: colors.brand,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  playText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  btn: {
    backgroundColor: colors.brand,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: "center",
  },
  btnText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  disabled: { opacity: 0.5 },
});
