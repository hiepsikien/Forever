import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import { useNavigation } from "@react-navigation/native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import {
  pauseActivePlayback,
  playLocalAudio,
  preparePlaybackMode,
  prepareRecordingMode,
  resumeActivePlayback,
  stopActivePlayback,
} from "@/lib/audio";
import { useAuth } from "@/lib/auth";
import { colors, fonts } from "@/lib/theme";

type Phase = "script" | "recording" | "review";

export default function VoiceRecordScreen() {
  const { spaceId, voiceId } = useLocalSearchParams<{
    spaceId: string;
    voiceId: string;
  }>();
  const { api } = useAuth();
  const navigation = useNavigation();
  const router = useRouter();
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder);

  const [phase, setPhase] = useState<Phase>("script");
  const [script, setScript] = useState("");
  const [scriptSource, setScriptSource] = useState<string>("");
  const [approxSeconds, setApproxSeconds] = useState<number | null>(null);
  const [theme, setTheme] = useState("");
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [localUri, setLocalUri] = useState<string | null>(null);
  const [durationMs, setDurationMs] = useState(0);
  const [previewPaused, setPreviewPaused] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [seed, setSeed] = useState(0);

  useLayoutEffect(() => {
    navigation.setOptions({ title: "Ghi sample Voice DNA" });
  }, [navigation]);

  const generateScript = useCallback(
    async (nextSeed?: number) => {
      if (!spaceId || generating) return;
      setGenerating(true);
      try {
        const s = nextSeed ?? seed + 1;
        setSeed(s);
        const res = await api.generateVoiceScript(spaceId, {
          theme: theme.trim() || undefined,
          seed: s,
        });
        setScript(res.script);
        setScriptSource(res.source);
        setApproxSeconds(res.approx_seconds);
        setPhase("script");
        setLocalUri(null);
        setPreviewing(false);
        await stopActivePlayback();
      } catch (e) {
        Alert.alert("Lỗi", e instanceof Error ? e.message : "Không tạo đoạn đọc.");
      } finally {
        setGenerating(false);
      }
    },
    [api, generating, seed, spaceId, theme],
  );

  useEffect(() => {
    return () => {
      void stopActivePlayback();
    };
  }, []);

  const startRecording = async () => {
    if (!script.trim()) {
      Alert.alert("Thiếu đoạn đọc", "Hãy để AI tạo đoạn trước khi ghi.");
      return;
    }
    try {
      await stopActivePlayback();
      setPreviewing(false);
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) {
        Alert.alert("Cần quyền", "Cho phép micro để ghi sample.");
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

  const togglePreview = async () => {
    if (!localUri) return;
    if (previewing) {
      if (previewPaused) {
        if (resumeActivePlayback()) setPreviewPaused(false);
        return;
      }
      if (pauseActivePlayback()) setPreviewPaused(true);
      return;
    }
    try {
      setPreviewing(true);
      setPreviewPaused(false);
      await playLocalAudio(localUri, () => {
        setPreviewing(false);
        setPreviewPaused(false);
      });
    } catch (e) {
      setPreviewing(false);
      Alert.alert("Lỗi", e instanceof Error ? e.message : "Không phát được.");
    }
  };

  const saveSample = async (recordAnother: boolean) => {
    if (!voiceId || !localUri || saving) return;
    setSaving(true);
    try {
      await stopActivePlayback();
      setPreviewing(false);
      await api.addVoiceSample(voiceId, {
        uri: localUri,
        name: "sample.m4a",
        mimeType: "audio/mp4",
        source: "record",
        durationMs,
        note: script.trim(),
      });
      if (recordAnother) {
        setLocalUri(null);
        setPhase("script");
        setScript("");
        setScriptSource("");
        setApproxSeconds(null);
        Alert.alert("Đã lưu", "Bấm AI Generate đoạn đọc khi sẵn sàng ghi thêm.");
      } else {
        Alert.alert("Đã lưu sample", "Quay lại Voice DNA để xem điểm và Clone.", [
          { text: "OK", onPress: () => router.back() },
        ]);
      }
    } catch (e) {
      Alert.alert("Lỗi", e instanceof Error ? e.message : "Không lưu sample.");
    } finally {
      setSaving(false);
    }
  };

  const discardTake = async () => {
    await stopActivePlayback();
    setPreviewing(false);
    setLocalUri(null);
    setPhase("script");
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={88}
    >
      <ScrollView
        contentContainerStyle={styles.root}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.section}>1. Đoạn đọc (AI)</Text>
        <View style={styles.card}>
          <TextInput
            style={styles.themeInput}
            value={theme}
            onChangeText={setTheme}
            placeholder="Chủ đề gợi ý (tuỳ chọn): quê nhà, Tết, buổi sáng…"
            placeholderTextColor={colors.inkSoft}
          />
          <Pressable
            style={[styles.btnGhost, generating && styles.disabled]}
            onPress={() => generateScript()}
            disabled={generating}
          >
            <Text style={styles.btnGhostText}>
              {generating ? "Đang tạo…" : "AI Generate đoạn đọc"}
            </Text>
          </Pressable>
          {generating && !script ? (
            <ActivityIndicator color={colors.brand} style={{ marginTop: 12 }} />
          ) : (
            <>
              <Text style={styles.script}>
                {script ||
                  "Chưa có đoạn đọc. Bấm “AI Generate đoạn đọc” khi sẵn sàng."}
              </Text>
              <Text style={styles.meta}>
                {scriptSource
                  ? `Nguồn: ${scriptSource === "gemini" ? "Gemini" : "mẫu sẵn"}`
                  : ""}
                {approxSeconds ? ` · ~${approxSeconds}s` : ""}
              </Text>
            </>
          )}
        </View>

        <Text style={styles.section}>2. Ghi âm</Text>
        <View style={styles.card}>
          <Text style={styles.help}>
            Đọc to đoạn trên, phòng yên, micro gần miệng. Không cần đọc hoàn hảo —
            giọng tự nhiên là tốt nhất cho Voice DNA.
          </Text>
          {phase === "recording" ? (
            <Pressable style={[styles.btn, styles.btnDanger]} onPress={stopRecording}>
              <Text style={styles.btnText}>
                Dừng ghi
                {recorderState.durationMillis
                  ? ` (${Math.round(recorderState.durationMillis / 1000)}s)`
                  : ""}
              </Text>
            </Pressable>
          ) : (
            <Pressable
              style={[styles.btn, (phase === "review" || !script) && styles.disabled]}
              onPress={startRecording}
              disabled={phase === "review" || !script || generating}
            >
              <Text style={styles.btnText}>
                {phase === "review" ? "Đang ở bước nghe lại" : "Bắt đầu ghi âm"}
              </Text>
            </Pressable>
          )}
        </View>

        <Text style={styles.section}>3. Nghe thử & lưu</Text>
        <View style={styles.card}>
          {!localUri ? (
            <Text style={styles.meta}>Ghi xong sẽ nghe lại tại đây.</Text>
          ) : (
            <>
              <Text style={styles.meta}>
                Take hiện tại · {Math.round(durationMs / 1000)}s
              </Text>
              <View style={styles.row}>
                <Pressable style={styles.btn} onPress={togglePreview}>
                  <Text style={styles.btnText}>
                    {!previewing
                      ? "Nghe thử lại"
                      : previewPaused
                        ? "Tiếp tục"
                        : "Tạm dừng"}
                  </Text>
                </Pressable>
                {previewing && !previewPaused ? (
                  <Pressable
                    style={styles.btnGhost}
                    onPress={() => {
                      if (pauseActivePlayback()) setPreviewPaused(true);
                    }}
                  >
                    <Text style={styles.btnGhostText}>Pause</Text>
                  </Pressable>
                ) : null}
              </View>
              <Pressable
                style={[styles.btn, saving && styles.disabled]}
                onPress={() => saveSample(false)}
                disabled={saving}
              >
                <Text style={styles.btnText}>
                  {saving ? "Đang lưu…" : "Lưu sample"}
                </Text>
              </Pressable>
              <Pressable
                style={[styles.btnGhost, saving && styles.disabled]}
                onPress={() => saveSample(true)}
                disabled={saving}
              >
                <Text style={styles.btnGhostText}>Lưu & ghi thêm</Text>
              </Pressable>
              <Pressable style={styles.textBtn} onPress={discardTake}>
                <Text style={styles.textBtnLabel}>Bỏ take này, ghi lại</Text>
              </Pressable>
            </>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  root: { padding: 20, gap: 12, paddingBottom: 40 },
  section: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.inkSoft,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginTop: 4,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 14,
    gap: 10,
  },
  themeInput: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: colors.ink,
    backgroundColor: "#fff",
  },
  script: {
    fontFamily: fonts.display,
    fontSize: 17,
    lineHeight: 26,
    color: colors.ink,
    marginTop: 4,
  },
  meta: { fontSize: 12, color: colors.inkSoft },
  help: { fontSize: 14, lineHeight: 20, color: colors.inkSoft },
  row: { flexDirection: "row", gap: 10, flexWrap: "wrap" },
  btn: {
    backgroundColor: colors.brand,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    alignItems: "center",
  },
  btnDanger: { backgroundColor: colors.danger },
  btnText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  btnGhost: {
    borderWidth: 1,
    borderColor: colors.brand,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    alignItems: "center",
  },
  btnGhostText: { color: colors.brand, fontWeight: "700", fontSize: 15 },
  textBtn: { alignItems: "center", paddingVertical: 6 },
  textBtnLabel: { color: colors.inkSoft, fontWeight: "600", fontSize: 13 },
  disabled: { opacity: 0.5 },
});
