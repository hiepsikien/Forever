import { ApiError, StoryChunkDetail } from "@forever/api-client";
import {
  requestRecordingPermissionsAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  playLocalAudio,
  preparePlaybackMode,
  prepareRecordingMode,
  stopActivePlayback,
} from "@/lib/audio";
import { RecordingLevelMeter } from "@/lib/recordingMeter";
import { VOICE_RECORDING_OPTIONS } from "@/lib/recordingOptions";
import { useAuth } from "@/lib/auth";
import { useSpaceScreenOptions } from "@/lib/spaceHeader";
import { colors, fonts, createThemedStyles } from "@/lib/theme";

type Phase = "loading" | "script" | "recording" | "review" | "empty";

export default function StoryRecordScreen() {
  const { spaceId, identityId, work } = useLocalSearchParams<{
    spaceId: string;
    identityId: string;
    work?: string;
  }>();
  const { api } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const recorder = useAudioRecorder(VOICE_RECORDING_OPTIONS);
  const recorderState = useAudioRecorderState(recorder, 80);

  const [phase, setPhase] = useState<Phase>("loading");
  const [detail, setDetail] = useState<StoryChunkDetail | null>(null);
  const [localUri, setLocalUri] = useState<string | null>(null);
  const [durationMs, setDurationMs] = useState(0);
  const [saving, setSaving] = useState(false);

  useSpaceScreenOptions({
    spaceId,
    title: "Thu kể chuyện",
    backTitle: "Kệ",
  });

  const loadNext = useCallback(async () => {
    if (!spaceId || !identityId) return;
    setPhase("loading");
    setLocalUri(null);
    setDetail(null);
    await stopActivePlayback();
    try {
      const next = await api.nextStoryToRecord(
        spaceId,
        identityId,
        typeof work === "string" ? work : undefined,
      );
      setDetail(next);
      setPhase("script");
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        setPhase("empty");
      } else {
        Alert.alert("Lỗi", e instanceof Error ? e.message : "Không lấy được đoạn.");
        setPhase("empty");
      }
    }
  }, [api, identityId, spaceId, work]);

  useEffect(() => {
    void loadNext();
    return () => {
      void stopActivePlayback();
    };
  }, [loadNext]);

  const startRecording = async () => {
    try {
      await stopActivePlayback();
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) {
        Alert.alert("Cần quyền", "Cho phép micro để ghi.");
        return;
      }
      await prepareRecordingMode();
      await recorder.prepareToRecordAsync();
      recorder.record();
      setPhase("recording");
      setLocalUri(null);
    } catch (e) {
      setPhase("script");
      Alert.alert("Lỗi", e instanceof Error ? e.message : "Không ghi được.");
    }
  };

  const stopRecording = async () => {
    try {
      const ms = recorderState.durationMillis ?? 0;
      await recorder.stop();
      await preparePlaybackMode();
      const uri = recorder.uri;
      if (!uri) throw new Error("Không có file ghi âm.");
      setDurationMs(ms);
      setLocalUri(uri);
      setPhase("review");
    } catch (e) {
      setPhase("script");
      Alert.alert("Lỗi", e instanceof Error ? e.message : "Không dừng ghi được.");
    }
  };

  const save = async () => {
    if (!spaceId || !identityId || !detail || !localUri || saving) return;
    setSaving(true);
    try {
      await api.uploadStoryRecording(spaceId, identityId, detail.chunk.id, {
        uri: localUri,
        name: `story-${detail.chunk.id}.m4a`,
        mimeType: "audio/mp4",
        durationMs,
      });
      Alert.alert("Đã lưu", "Đoạn này vào kệ nghe.", [
        { text: "Đoạn khác", onPress: () => void loadNext() },
        {
          text: "Xong",
          onPress: () => router.back(),
        },
      ]);
    } catch (e) {
      Alert.alert("Lỗi", e instanceof Error ? e.message : "Không lưu được.");
    } finally {
      setSaving(false);
    }
  };

  if (phase === "loading") {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }

  if (phase === "empty" || !detail) {
    return (
      <View style={styles.centerPad}>
        <Text style={styles.emptyTitle}>Không còn đoạn chưa ghi</Text>
        <Text style={styles.emptyBody}>
          Bật Lục Vân Tiên hoặc Kiều trên kệ, hoặc đã ghi hết các đoạn đang mở.
        </Text>
        <Pressable style={styles.primaryBtn} onPress={() => router.back()}>
          <Text style={styles.primaryBtnText}>Về kệ</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.root, { paddingBottom: insets.bottom + 16 }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.work}>
          {detail.work.title}
          {detail.chunk.label ? ` · ${detail.chunk.label}` : ""}
        </Text>
        <Text style={styles.hint}>
          ~{detail.chunk.approx_seconds}s · đọc to, rõ — rồi ghi
        </Text>
        <Text style={styles.body}>{detail.chunk.body}</Text>
      </ScrollView>

      <View style={styles.footer}>
        {phase === "recording" ? (
          <RecordingLevelMeter
            active
            metering={recorderState.metering}
            durationMillis={recorderState.durationMillis ?? 0}
          />
        ) : null}
        {phase === "script" ? (
          <Pressable style={styles.primaryBtn} onPress={startRecording}>
            <Text style={styles.primaryBtnText}>Bắt đầu ghi</Text>
          </Pressable>
        ) : null}
        {phase === "recording" ? (
          <Pressable style={styles.stopBtn} onPress={stopRecording}>
            <Text style={styles.primaryBtnText}>Dừng</Text>
          </Pressable>
        ) : null}
        {phase === "review" && localUri ? (
          <View style={styles.reviewRow}>
            <Pressable
              style={styles.secondaryBtn}
              onPress={() =>
                playLocalAudio(localUri).catch(() =>
                  Alert.alert("Lỗi", "Không phát lại được."),
                )
              }
            >
              <Text style={styles.secondaryBtnText}>Nghe lại</Text>
            </Pressable>
            <Pressable
              style={styles.secondaryBtn}
              onPress={() => {
                setLocalUri(null);
                setPhase("script");
              }}
            >
              <Text style={styles.secondaryBtnText}>Ghi lại</Text>
            </Pressable>
            <Pressable
              style={[styles.primaryBtn, styles.flex]}
              disabled={saving}
              onPress={save}
            >
              {saving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryBtnText}>Lưu</Text>
              )}
            </Pressable>
          </View>
        ) : null}
        {phase === "script" ? (
          <Pressable style={styles.skip} onPress={() => void loadNext()}>
            <Text style={styles.skipText}>Đoạn khác</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = createThemedStyles(() => ({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 20, paddingBottom: 24 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  centerPad: {
    flex: 1,
    padding: 28,
    justifyContent: "center",
    gap: 12,
  },
  emptyTitle: {
    fontFamily: fonts.serif,
    fontSize: 22,
    color: colors.ink,
  },
  emptyBody: {
    fontFamily: fonts.sans,
    fontSize: 15,
    lineHeight: 22,
    color: colors.muted,
    marginBottom: 12,
  },
  work: {
    fontFamily: fonts.sansSemi,
    fontSize: 14,
    color: colors.muted,
    marginBottom: 4,
  },
  hint: {
    fontFamily: fonts.sans,
    fontSize: 13,
    color: colors.muted,
    marginBottom: 16,
  },
  body: {
    fontFamily: fonts.serif,
    fontSize: 20,
    lineHeight: 32,
    color: colors.ink,
  },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    gap: 10,
  },
  primaryBtn: {
    backgroundColor: colors.brand,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  primaryBtnText: {
    fontFamily: fonts.sansSemi,
    color: "#fff",
    fontSize: 16,
  },
  stopBtn: {
    backgroundColor: "#b33",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  secondaryBtn: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
    alignItems: "center",
  },
  secondaryBtnText: {
    fontFamily: fonts.sansSemi,
    color: colors.ink,
    fontSize: 15,
  },
  reviewRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  flex: { flex: 1 },
  skip: { alignItems: "center", paddingVertical: 6 },
  skipText: {
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.muted,
  },
}));
