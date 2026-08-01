import { VoiceSample } from "@forever/api-client";
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

export default function VoiceSamplesScreen() {
  const { spaceId, voiceId } = useLocalSearchParams<{
    spaceId: string;
    voiceId?: string;
  }>();
  const { api } = useAuth();
  const navigation = useNavigation();
  const [samples, setSamples] = useState<VoiceSample[]>([]);
  const [loading, setLoading] = useState(true);
  const [playback, setPlayback] = useState<Playback>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftNote, setDraftNote] = useState("");
  const [saving, setSaving] = useState(false);

  useLayoutEffect(() => {
    navigation.setOptions({ title: "Sample đã ghi" });
  }, [navigation]);

  const load = useCallback(async () => {
    if (!spaceId) return;
    setLoading(true);
    try {
      const res = await api.listSpaceVoiceSamples(spaceId, voiceId || undefined);
      setSamples(res.samples);
    } catch (e) {
      Alert.alert("Lỗi", e instanceof Error ? e.message : "Không tải sample.");
    } finally {
      setLoading(false);
    }
  }, [api, spaceId, voiceId]);

  useEffect(() => {
    load();
    return () => {
      void stopActivePlayback();
    };
  }, [load]);

  const togglePlay = async (item: VoiceSample) => {
    const voiceId = item.voice_profile_id;
    if (!voiceId) return;

    if (playback?.id === item.id) {
      if (playback.paused) {
        if (resumeActivePlayback()) setPlayback({ id: item.id, paused: false });
        return;
      }
      if (pauseActivePlayback()) setPlayback({ id: item.id, paused: true });
      return;
    }

    try {
      const url = api.voiceSampleMediaUrl(voiceId, item.id);
      const uri = await fetchAuthedMediaUri(url, `voice-sample-${item.id}`, item.media_mime);
      setPlayback({ id: item.id, paused: false });
      await playLocalAudio(uri, () => setPlayback(null));
    } catch (e) {
      setPlayback(null);
      Alert.alert("Lỗi", e instanceof Error ? e.message : "Không phát được.");
    }
  };

  const saveNote = async (item: VoiceSample) => {
    const voiceId = item.voice_profile_id;
    if (!voiceId || saving) return;
    setSaving(true);
    try {
      const updated = await api.updateVoiceSampleNote(voiceId, item.id, draftNote);
      setSamples((prev) => prev.map((s) => (s.id === item.id ? { ...s, ...updated } : s)));
      setEditingId(null);
    } catch (e) {
      Alert.alert("Lỗi", e instanceof Error ? e.message : "Không lưu ghi chú.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (item: VoiceSample) => {
    const voiceId = item.voice_profile_id;
    if (!voiceId) return;
    Alert.alert("Xóa sample?", "Sample sẽ bị xóa và cần Clone lại nếu voice đang ready.", [
      { text: "Huỷ", style: "cancel" },
      {
        text: "Xóa",
        style: "destructive",
        onPress: async () => {
          try {
            await api.deleteVoiceSample(voiceId, item.id);
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

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }

  const good = samples.filter((s) => (s.quality_score ?? 0) >= 75);
  const ok = samples.filter((s) => {
    const q = s.quality_score ?? 0;
    return q >= 55 && q < 75;
  });
  const weak = samples.filter((s) => (s.quality_score ?? 0) < 55);

  const renderItem = (item: VoiceSample, index: number) => {
    const scoreColor =
      (item.quality_score ?? 0) >= 75
        ? colors.brand
        : (item.quality_score ?? 0) >= 55
          ? colors.accent
          : colors.danger;
    const isActive = playback?.id === item.id;
    const isPaused = isActive && playback?.paused;

    return (
      <View style={styles.card}>
        <Text style={styles.title}>
          #{index + 1} · {item.voice_display_name ?? "Voice"} ·{" "}
          {item.duration_label ?? "—:—"}
        </Text>
        <Text style={styles.meta}>
          {item.voice_subject_kind === "heritage" ? "Ký ức" : "Giọng sống"} ·{" "}
          {item.source} · {item.created_at.slice(0, 16).replace("T", " ")}
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
                <Pressable
                  style={styles.btn}
                  onPress={() => saveNote(item)}
                  disabled={saving}
                >
                  <Text style={styles.btnText}>{saving ? "Đang lưu…" : "Lưu"}</Text>
                </Pressable>
                <Pressable
                  style={styles.btnGhost}
                  onPress={() => setEditingId(null)}
                >
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
          <Pressable onPress={() => remove(item)}>
            <Text style={styles.delete}>Xóa</Text>
          </Pressable>
        </View>
      </View>
    );
  };

  const sections = [
    { key: "good", title: "Tốt — nên giữ để clone", data: good },
    { key: "ok", title: "Tạm được — nghe lại trước khi giữ", data: ok },
    { key: "weak", title: "Yếu / kém — cân nhắc xóa", data: weak },
  ];

  return (
    <FlatList
      style={styles.root}
      contentContainerStyle={styles.content}
      data={sections}
      keyExtractor={(s) => s.key}
      ListHeaderComponent={
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Sample đã ghi</Text>
          <Text style={styles.headerSub}>
            Nghe lại, gắn ghi chú text, chọn sample tốt rồi quay lại hub để Clone.
          </Text>
          <Text style={styles.count}>
            {samples.length} sample
            {voiceId ? " · lọc theo Voice DNA đang chọn" : " trong không gian"}
          </Text>
        </View>
      }
      ListEmptyComponent={
        <Text style={styles.empty}>Chưa có sample. Ghi từ trang Voice DNA.</Text>
      }
      renderItem={({ item: section }) => {
        if (!section.data.length) return null;
        return (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{section.title}</Text>
            {section.data.map((sample, idx) => (
              <View key={sample.id}>{renderItem(sample, idx + 1)}</View>
            ))}
          </View>
        );
      }}
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
  count: { fontSize: 13, fontWeight: "600", color: colors.brand, marginTop: 4 },
  empty: { fontSize: 14, color: colors.inkSoft, marginTop: 20 },
  section: { gap: 10, marginBottom: 16 },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.inkSoft,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 14,
    gap: 8,
    marginBottom: 8,
  },
  title: { fontSize: 15, fontWeight: "700", color: colors.ink },
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
  delete: { color: colors.danger, fontWeight: "700", fontSize: 13 },
  btn: {
    backgroundColor: colors.brand,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  btnText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  btnGhost: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  btnGhostText: { color: colors.inkSoft, fontWeight: "600", fontSize: 13 },
});
