import { useAudioRecorder, useAudioRecorderState } from "expo-audio";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  pauseActivePlayback,
  playLocalAudio,
  preparePlaybackMode,
  prepareRecordingMode,
  resumeActivePlayback,
  stopActivePlayback,
} from "@/lib/audio";
import { ensureRecordingPermission } from "@/lib/micPermission";
import { RecordingLevelMeter } from "@/lib/recordingMeter";
import { VOICE_RECORDING_OPTIONS } from "@/lib/recordingOptions";
import { useAuth } from "@/lib/auth";
import { useSpaceScreenOptions } from "@/lib/spaceHeader";
import { colors, fonts, createThemedStyles } from "@/lib/theme";

type Phase = "script" | "recording" | "review";

const STEPS = ["Đoạn đọc", "Ghi âm", "Lưu"] as const;

function stepIndex(phase: Phase, hasScript: boolean): number {
  if (phase === "review") return 2;
  if (phase === "recording") return 1;
  return hasScript ? 1 : 0;
}

export default function VoiceRecordScreen() {
  const { spaceId, voiceId } = useLocalSearchParams<{
    spaceId: string;
    voiceId: string;
  }>();
  const { api } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const recorder = useAudioRecorder(VOICE_RECORDING_OPTIONS);
  const recorderState = useAudioRecorderState(recorder, 80);

  const [phase, setPhase] = useState<Phase>("script");
  const [script, setScript] = useState("");
  const [scriptSource, setScriptSource] = useState("");
  const [approxSeconds, setApproxSeconds] = useState<number | null>(null);
  const [theme, setTheme] = useState("");
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [localUri, setLocalUri] = useState<string | null>(null);
  const [durationMs, setDurationMs] = useState(0);
  const [previewPaused, setPreviewPaused] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [seed, setSeed] = useState(0);
  const [showTheme, setShowTheme] = useState(true);

  const hasScript = script.trim().length > 0;
  const activeStep = stepIndex(phase, hasScript);

  useSpaceScreenOptions({ spaceId, title: "Ghi mẫu", backTitle: "Nhà" });

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
        setShowTheme(false);
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
    if (!hasScript) {
      Alert.alert("Thiếu đoạn đọc", "Hãy để AI tạo đoạn trước khi ghi.");
      return;
    }
    try {
      await stopActivePlayback();
      setPreviewing(false);
      const allowed = await ensureRecordingPermission();
      if (!allowed) {
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
        setShowTheme(true);
        Alert.alert("Đã lưu", "Tạo đoạn đọc mới khi sẵn sàng ghi tiếp.");
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

  const scriptMeta =
    scriptSource || approxSeconds
      ? [
          scriptSource
            ? scriptSource === "gemini"
              ? "Gemini"
              : "Mẫu sẵn"
            : null,
          approxSeconds ? `~${approxSeconds}s đọc` : null,
        ]
          .filter(Boolean)
          .join(" · ")
      : null;

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={88}
    >
      <View style={styles.steps}>
        {STEPS.map((label, i) => {
          const done = i < activeStep;
          const active = i === activeStep;
          return (
            <View key={label} style={styles.stepItem}>
              <View
                style={[
                  styles.stepDot,
                  done && styles.stepDotDone,
                  active && !done && styles.stepDotActive,
                ]}
              >
                <Text
                  style={[
                    styles.stepNum,
                    done && styles.stepNumDone,
                    active && !done && styles.stepNumActive,
                  ]}
                >
                  {done ? "✓" : i + 1}
                </Text>
              </View>
              <Text
                style={[styles.stepLabel, active && styles.stepLabelActive]}
              >
                {label}
              </Text>
              {i < STEPS.length - 1 ? (
                <View style={[styles.stepLine, done && styles.stepLineDone]} />
              ) : null}
            </View>
          );
        })}
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {phase === "script" && !hasScript ? (
          <View style={styles.setupCard}>
            <Text style={styles.setupTitle}>Tạo đoạn đọc</Text>
            <Text style={styles.setupHint}>
              AI sẽ viết một đoạn ngắn để bạn đọc to, tự nhiên — không cần diễn
              xuất.
            </Text>
            <TextInput
              style={styles.themeInput}
              value={theme}
              onChangeText={setTheme}
              placeholder="Chủ đề (tuỳ chọn): quê nhà, Tết, buổi sáng…"
              placeholderTextColor={colors.inkSoft}
            />
          </View>
        ) : (
          <>
            {phase === "recording" ? (
              <>
                <View style={styles.recordingBanner}>
                  <View style={styles.recordingDot} />
                  <Text style={styles.recordingBannerText}>
                    Đang ghi — đọc to, phòng yên
                  </Text>
                </View>
                <View style={styles.meterHero}>
                  <RecordingLevelMeter
                    active
                    variant="large"
                    metering={recorderState.metering}
                    durationMillis={recorderState.durationMillis}
                    barColor="#e04535"
                    dotColor="#e04535"
                  />
                </View>
              </>
            ) : null}

            {phase === "review" ? (
              <Text style={styles.reviewMeta}>
                Take · {Math.round(durationMs / 1000)} giây
              </Text>
            ) : null}

            <Text style={styles.scriptLabel}>
              {phase === "recording" ? "Đọc đoạn này" : "Đoạn đọc"}
            </Text>
            <Text style={styles.script}>{script}</Text>
            {scriptMeta ? <Text style={styles.meta}>{scriptMeta}</Text> : null}

            {phase === "script" && hasScript ? (
              <Text style={styles.tip}>
                Micro gần miệng, giọng tự nhiên là đủ. Bấm ghi âm ở dưới khi sẵn
                sàng.
              </Text>
            ) : null}

            {phase === "script" && hasScript && showTheme ? (
              <View style={styles.themeExpand}>
                <TextInput
                  style={styles.themeInput}
                  value={theme}
                  onChangeText={setTheme}
                  placeholder="Chủ đề mới (tuỳ chọn)…"
                  placeholderTextColor={colors.inkSoft}
                />
              </View>
            ) : null}
          </>
        )}

        {generating && !hasScript ? (
          <ActivityIndicator color={colors.brand} style={styles.loader} />
        ) : null}
      </ScrollView>

      <View
        style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12) }]}
      >
        {phase === "script" && !hasScript ? (
          <Pressable
            style={[styles.btnPrimary, generating && styles.disabled]}
            onPress={() => generateScript()}
            disabled={generating}
          >
            <Text style={styles.btnPrimaryText}>
              {generating ? "Đang tạo…" : "AI Generate đoạn đọc"}
            </Text>
          </Pressable>
        ) : null}

        {phase === "script" && hasScript ? (
          <>
            <Pressable
              style={[styles.btnPrimary, generating && styles.disabled]}
              onPress={startRecording}
              disabled={generating}
            >
              <Text style={styles.btnPrimaryText}>Bắt đầu ghi âm</Text>
            </Pressable>
            <View style={styles.footerRow}>
              <Pressable
                style={[styles.btnGhost, generating && styles.disabled]}
                onPress={() => generateScript()}
                disabled={generating}
              >
                <Text style={styles.btnGhostText}>
                  {generating ? "Đang tạo…" : "Đoạn khác"}
                </Text>
              </Pressable>
              <Pressable
                style={styles.btnGhost}
                onPress={() => setShowTheme((v) => !v)}
              >
                <Text style={styles.btnGhostText}>
                  {showTheme ? "Ẩn chủ đề" : "Đổi chủ đề"}
                </Text>
              </Pressable>
            </View>
          </>
        ) : null}

        {phase === "recording" ? (
          <>
            <View style={styles.meterFooter}>
              <RecordingLevelMeter
                active
                metering={recorderState.metering}
                durationMillis={recorderState.durationMillis}
                barColor="#e04535"
                dotColor="#e04535"
              />
            </View>
            <Pressable style={[styles.btnPrimary, styles.btnDanger]} onPress={stopRecording}>
              <Text style={styles.btnPrimaryText}>Dừng ghi</Text>
            </Pressable>
          </>
        ) : null}

        {phase === "review" ? (
          <>
            <View style={styles.footerRow}>
              <Pressable style={[styles.btnPrimary, styles.btnFlex]} onPress={togglePreview}>
                <Text style={styles.btnPrimaryText}>
                  {!previewing
                    ? "Nghe thử"
                    : previewPaused
                      ? "Tiếp tục"
                      : "Tạm dừng"}
                </Text>
              </Pressable>
              <Pressable
                style={[styles.btnPrimary, styles.btnFlex, saving && styles.disabled]}
                onPress={() => saveSample(false)}
                disabled={saving}
              >
                <Text style={styles.btnPrimaryText}>
                  {saving ? "Đang lưu…" : "Lưu sample"}
                </Text>
              </Pressable>
            </View>
            <View style={styles.footerRow}>
              <Pressable
                style={[styles.btnGhost, styles.btnFlex, saving && styles.disabled]}
                onPress={() => saveSample(true)}
                disabled={saving}
              >
                <Text style={styles.btnGhostText}>Lưu & ghi thêm</Text>
              </Pressable>
              <Pressable style={[styles.btnGhost, styles.btnFlex]} onPress={discardTake}>
                <Text style={styles.btnGhostText}>Ghi lại</Text>
              </Pressable>
            </View>
          </>
        ) : null}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = createThemedStyles((colors) => ({
  flex: { flex: 1, backgroundColor: colors.bg },
  steps: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
    gap: 4,
  },
  stepItem: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  stepDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: colors.line,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.card,
  },
  stepDotDone: {
    backgroundColor: colors.brand,
    borderColor: colors.brand,
  },
  stepDotActive: {
    borderColor: colors.brand,
    backgroundColor: "#fff",
  },
  stepNum: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.inkSoft,
  },
  stepNumActive: {
    color: colors.brand,
  },
  stepNumDone: {
    color: "#fff",
  },
  stepLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: colors.inkSoft,
    flexShrink: 1,
  },
  stepLabelActive: {
    color: colors.ink,
  },
  stepLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.line,
    marginLeft: 4,
  },
  stepLineDone: {
    backgroundColor: colors.brandSoft,
  },
  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 16,
    flexGrow: 1,
  },
  setupCard: {
    backgroundColor: colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 18,
    gap: 10,
    marginTop: 8,
  },
  setupTitle: {
    fontFamily: fonts.display,
    fontSize: 22,
    color: colors.ink,
  },
  setupHint: {
    fontSize: 15,
    lineHeight: 22,
    color: colors.inkSoft,
  },
  themeInput: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: colors.ink,
    backgroundColor: "#fff",
    marginTop: 4,
  },
  themeExpand: {
    marginTop: 16,
  },
  scriptLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.inkSoft,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginBottom: 8,
  },
  script: {
    fontFamily: fonts.display,
    fontSize: 20,
    lineHeight: 30,
    color: colors.ink,
  },
  meta: {
    fontSize: 13,
    color: colors.inkSoft,
    marginTop: 12,
  },
  tip: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.inkSoft,
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  reviewMeta: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.brand,
    marginBottom: 12,
  },
  recordingBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#fff7f5",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(180, 80, 60, 0.25)",
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 16,
  },
  recordingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#e04535",
  },
  recordingBannerText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#a04535",
  },
  meterHero: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(224, 69, 53, 0.28)",
    backgroundColor: "#fff7f5",
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 20,
  },
  loader: { marginTop: 24 },
  footer: {
    borderTopWidth: 1,
    borderTopColor: colors.line,
    backgroundColor: colors.card,
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 8,
  },
  footerRow: {
    flexDirection: "row",
    gap: 8,
  },
  btnFlex: { flex: 1 },
  btnPrimary: {
    backgroundColor: colors.brand,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    alignItems: "center",
  },
  btnDanger: { backgroundColor: colors.danger },
  btnPrimaryText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  btnGhost: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 12,
    alignItems: "center",
    backgroundColor: colors.bg,
  },
  btnGhostText: { color: colors.ink, fontWeight: "600", fontSize: 14 },
  meterFooter: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(224, 69, 53, 0.22)",
    backgroundColor: "#fff7f5",
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  disabled: { opacity: 0.5 },
}));
