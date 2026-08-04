import {
  VoiceProfile,
  VoiceRender,
  voiceTtsModelLabel,
} from "@forever/api-client";
import { useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

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
import { colors, fonts } from "@/lib/theme";

type Playback = { id: string; paused: boolean } | null;
type BusyAction = { id: string; kind: "share" } | null;

function exportBaseName(item: VoiceRender): string {
  const voice = item.voice_display_name || "Voice-DNA";
  const stamp = item.created_at
    .slice(0, 16)
    .replace("T", "-")
    .replace(/:/g, "");
  const suffix = item.id.slice(-6);
  return `Forever-TTS-${voice}-${stamp}-${suffix}`;
}

function renderParamLines(item: VoiceRender): string[] {
  const lines: string[] = [
    `Model: ${voiceTtsModelLabel(item.model_id)}`,
  ];
  if (item.provider_voice_name) {
    lines.push(`Bản clone: ${item.provider_voice_name}`);
  }
  if (item.stability != null || item.similarity_boost != null) {
    lines.push(
      `Ổn định ${formatPct(item.stability)} · Giống giọng ${formatPct(item.similarity_boost)}`,
    );
  }
  if (item.style != null || item.speed != null) {
    lines.push(
      `Phong cách ${formatPct(item.style)} · Tốc độ ${
        item.speed != null ? item.speed.toFixed(2) : "—"
      }`,
    );
  }
  const flags: string[] = [];
  if (item.use_speaker_boost != null) {
    flags.push(item.use_speaker_boost ? "Speaker boost bật" : "Speaker boost tắt");
  }
  if (item.lengthen_pauses != null) {
    flags.push(item.lengthen_pauses ? "Kéo dài nghỉ câu" : "Nghỉ câu mặc định");
  }
  if (flags.length) lines.push(flags.join(" · "));
  return lines;
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

  useSpaceScreenOptions({
    spaceId,
    title: providerVoiceId ? "TTS theo clone" : "Bản đã tạo",
    backTitle: "Nhà",
  });

  const load = useCallback(async () => {
    if (!spaceId) return;
    setLoading(true);
    try {
      const [v, r] = await Promise.all([
        api.listVoices(spaceId),
        api.listSpaceVoiceRenders(spaceId, {
          voiceId: filterVoiceId || undefined,
          providerVoiceId: providerVoiceId || undefined,
        }),
      ]);
      setVoices(v.voices);
      setRenders(r.renders);
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

  const getPlayUri = async (item: VoiceRender): Promise<string> => {
    const url = api.voiceRenderMediaUrl(item.voice_profile_id, item.id);
    return fetchAuthedMediaUri(
      url,
      `voice-render-${item.id}`,
      item.media_mime,
    );
  };

  const resolveExportUri = async (item: VoiceRender): Promise<string> => {
    const cached = await getPlayUri(item);
    return prepareAudioExport(cached, exportBaseName(item), item.media_mime);
  };

  const togglePlay = async (item: VoiceRender) => {
    if (playback?.id === item.id) {
      if (playback.paused) {
        if (resumeActivePlayback()) setPlayback({ id: item.id, paused: false });
        return;
      }
      if (pauseActivePlayback()) setPlayback({ id: item.id, paused: true });
      return;
    }
    try {
      const uri = await getPlayUri(item);
      setPlayback({ id: item.id, paused: false });
      await playLocalAudio(uri, () => setPlayback(null));
    } catch (e) {
      setPlayback(null);
      Alert.alert("Lỗi", e instanceof Error ? e.message : "Không phát được.");
    }
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
      Alert.alert("Lỗi", e instanceof Error ? e.message : "Không chia sẻ được.");
    } finally {
      setBusy(null);
    }
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
              ? `Các câu nói tạo từ “${cloneName || "bản clone này"}”.`
              : "Lọc theo người — nghe, xem thông số, hoặc chia sẻ từng bản."}
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
                    style={[styles.chipText, active && styles.chipTextActive]}
                    numberOfLines={1}
                  >
                    {v.display_name}
                  </Text>
                </Pressable>
              );
            })}
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
        const active = playback?.id === item.id;
        const paused = active && playback?.paused;
        const when = formatLocalDateTime(item.created_at);
        const voiceName = item.voice_display_name || "Voice DNA";
        const sharing = busy?.id === item.id && busy.kind === "share";
        const itemBusy = sharing;
        const expanded = expandedId === item.id;
        const params = renderParamLines(item);

        return (
          <View style={styles.card}>
            <Text style={styles.voiceName}>{voiceName}</Text>
            {item.provider_voice_name ? (
              <Text style={styles.cloneName} numberOfLines={2}>
                {item.provider_voice_name}
              </Text>
            ) : null}
            <Text style={styles.body} numberOfLines={4}>
              {item.text}
            </Text>
            <Text style={styles.meta}>
              {when}
              {" · "}
              {voiceTtsModelLabel(item.model_id)}
              {" · "}
              <Text
                style={styles.detailLink}
                onPress={() => setExpandedId(expanded ? null : item.id)}
              >
                {expanded ? "Ẩn" : "Chi tiết"}
              </Text>
            </Text>
            {expanded ? (
              <View style={styles.detailBox}>
                {params.map((line) => (
                  <Text key={line} style={styles.detailLine}>
                    {line}
                  </Text>
                ))}
              </View>
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
              <Pressable onPress={() => remove(item)} disabled={itemBusy}>
                <Text style={styles.delete}>Xóa</Text>
              </Pressable>
            </View>
          </View>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
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
  voiceName: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.brand,
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  cloneName: { fontSize: 13, fontWeight: "600", color: colors.inkSoft },
  body: {
    fontFamily: fonts.display,
    fontSize: 16,
    lineHeight: 24,
    color: colors.ink,
  },
  meta: { fontSize: 12, color: colors.inkSoft },
  detailLink: { fontSize: 12, fontWeight: "600", color: colors.brand },
  detailBox: {
    backgroundColor: colors.bgDeep,
    borderRadius: 10,
    padding: 10,
    gap: 4,
  },
  detailLine: { fontSize: 12, lineHeight: 17, color: colors.inkSoft },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
  },
  play: {
    backgroundColor: colors.brand,
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
  delete: { color: colors.danger, fontWeight: "700", fontSize: 13 },
});
