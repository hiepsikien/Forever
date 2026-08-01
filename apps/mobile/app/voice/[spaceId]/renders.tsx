import {
  VoiceProfile,
  VoiceRender,
  voiceTtsModelLabel,
} from "@forever/api-client";
import { useNavigation } from "@react-navigation/native";
import { useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useLayoutEffect, useState } from "react";
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
import { fetchAuthedMediaUri } from "@/lib/media";
import { colors, fonts } from "@/lib/theme";

type Playback = { id: string; paused: boolean } | null;

export default function VoiceRendersScreen() {
  const { spaceId, voiceId: voiceIdParam } = useLocalSearchParams<{
    spaceId: string;
    voiceId?: string;
  }>();
  const { api } = useAuth();
  const navigation = useNavigation();
  const [voices, setVoices] = useState<VoiceProfile[]>([]);
  const [filterVoiceId, setFilterVoiceId] = useState<string | null>(
    voiceIdParam || null,
  );
  const [renders, setRenders] = useState<VoiceRender[]>([]);
  const [loading, setLoading] = useState(true);
  const [playback, setPlayback] = useState<Playback>(null);

  useLayoutEffect(() => {
    navigation.setOptions({ title: "Bản TTS đã tạo" });
  }, [navigation]);

  const load = useCallback(async () => {
    if (!spaceId) return;
    setLoading(true);
    try {
      const [v, r] = await Promise.all([
        api.listVoices(spaceId),
        api.listSpaceVoiceRenders(spaceId, filterVoiceId || undefined),
      ]);
      setVoices(v.voices);
      setRenders(r.renders);
    } catch (e) {
      Alert.alert("Lỗi", e instanceof Error ? e.message : "Không tải lịch sử.");
    } finally {
      setLoading(false);
    }
  }, [api, spaceId, filterVoiceId]);

  useEffect(() => {
    load();
    return () => {
      void stopActivePlayback();
    };
  }, [load]);

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
      const url = api.voiceRenderMediaUrl(item.voice_profile_id, item.id);
      const uri = await fetchAuthedMediaUri(
        url,
        `voice-render-${item.id}`,
        item.media_mime,
      );
      setPlayback({ id: item.id, paused: false });
      await playLocalAudio(uri, () => setPlayback(null));
    } catch (e) {
      setPlayback(null);
      Alert.alert("Lỗi", e instanceof Error ? e.message : "Không phát được.");
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
          <Text style={styles.title}>Bản TTS đã tạo</Text>
          <Text style={styles.sub}>
            Lọc theo Voice DNA — mỗi bản ghi tên giọng, model và thời điểm.
          </Text>
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
        </View>
      }
      ListEmptyComponent={
        <Text style={styles.empty}>
          Chưa có bản nào. Vào “Tạo giọng từ text” rồi bấm Lưu.
        </Text>
      }
      renderItem={({ item }) => {
        const active = playback?.id === item.id;
        const paused = active && playback?.paused;
        const when = item.created_at.slice(0, 16).replace("T", " ");
        const voiceName = item.voice_display_name || "Voice DNA";
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
            </Text>
            <View style={styles.row}>
              <Pressable style={styles.play} onPress={() => togglePlay(item)}>
                <Text style={styles.playText}>
                  {!active ? "Nghe" : paused ? "Tiếp tục" : "Tạm dừng"}
                </Text>
              </Pressable>
              <Pressable onPress={() => remove(item)}>
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
  row: { flexDirection: "row", alignItems: "center", gap: 14 },
  play: {
    backgroundColor: colors.brand,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  playText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  delete: { color: colors.danger, fontWeight: "700", fontSize: 13 },
});
