import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
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
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  pauseActivePlayback,
  playLocalAudio,
  preparePlaybackMode,
  resumeActivePlayback,
  stopActivePlayback,
} from "@/lib/audio";
import { useAuth } from "@/lib/auth";
import { stageLocalAudioFile } from "@/lib/media";
import { useSpaceScreenOptions } from "@/lib/spaceHeader";
import { colors, fonts } from "@/lib/theme";

type Phase = "pick" | "review";

const STEPS = ["Chọn file", "Xem lại", "Lưu"] as const;
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;

type PickedFile = {
  uri: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  isVideo: boolean;
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function guessIsVideo(mime: string, name: string): boolean {
  if ((mime || "").startsWith("video/")) return true;
  return /\.(mp4|mov|m4v|mkv|webm|avi|3gp)$/i.test(name);
}

function stepIndex(phase: Phase, hasFile: boolean): number {
  if (phase === "review") return 2;
  return hasFile ? 1 : 0;
}

export default function VoiceUploadScreen() {
  const { spaceId, voiceId } = useLocalSearchParams<{
    spaceId: string;
    voiceId: string;
  }>();
  const { api } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [phase, setPhase] = useState<Phase>("pick");
  const [picked, setPicked] = useState<PickedFile | null>(null);
  const [note, setNote] = useState("");
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [previewPaused, setPreviewPaused] = useState(false);

  const hasFile = picked != null;
  const activeStep = stepIndex(phase, hasFile);

  useSpaceScreenOptions({
    spaceId,
    title: "Tải file",
    backTitle: "Nhà",
  });

  useEffect(() => {
    return () => {
      void stopActivePlayback();
    };
  }, []);

  const pickFile = async () => {
    if (picking) return;
    setPicking(true);
    try {
      await stopActivePlayback();
      setPreviewing(false);
      const result = await DocumentPicker.getDocumentAsync({
        type: ["audio/*", "video/*"],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled || !result.assets?.length) return;

      const asset = result.assets[0];
      const sourceUri = asset.uri;
      const sourceName = asset.name || "sample.wav";
      const mimeType = asset.mimeType || "application/octet-stream";
      const isVideo = guessIsVideo(mimeType, sourceName);

      const info = await FileSystem.getInfoAsync(sourceUri);
      const sizeBytes = info.exists && "size" in info ? info.size ?? 0 : 0;
      const maxBytes = isVideo ? MAX_VIDEO_BYTES : MAX_AUDIO_BYTES;
      if (sizeBytes > maxBytes) {
        Alert.alert(
          "File quá lớn",
          isVideo
            ? `Video tối đa 100 MB. File này: ${formatBytes(sizeBytes)}. Băng dài hơn hãy dùng Tách giọng từ băng dài.`
            : `Audio tối đa 25 MB. File này: ${formatBytes(sizeBytes)}.`,
        );
        return;
      }

      if (isVideo) {
        setPicked({
          uri: sourceUri,
          name: sourceName,
          mimeType: mimeType.startsWith("video/") ? mimeType : "video/mp4",
          sizeBytes,
          isVideo: true,
        });
      } else {
        const staged = await stageLocalAudioFile(sourceUri, {
          name: sourceName,
          mimeType,
          cacheKey: `${Date.now()}`,
        });
        setPicked({
          uri: staged.uri,
          name: staged.name,
          mimeType: staged.mimeType,
          sizeBytes,
          isVideo: false,
        });
      }
      setPhase("review");
    } catch (e) {
      Alert.alert("Lỗi", e instanceof Error ? e.message : "Không chọn được file.");
    } finally {
      setPicking(false);
    }
  };

  const togglePreview = async () => {
    if (!picked || picked.isVideo) return;
    if (previewing) {
      if (previewPaused) {
        if (resumeActivePlayback()) setPreviewPaused(false);
        return;
      }
      if (pauseActivePlayback()) setPreviewPaused(true);
      return;
    }
    try {
      await preparePlaybackMode();
      setPreviewing(true);
      setPreviewPaused(false);
      await playLocalAudio(picked.uri, () => {
        setPreviewing(false);
        setPreviewPaused(false);
      });
    } catch (e) {
      setPreviewing(false);
      Alert.alert("Lỗi", e instanceof Error ? e.message : "Không phát được.");
    }
  };

  const discardFile = async () => {
    await stopActivePlayback();
    setPreviewing(false);
    setPicked(null);
    setPhase("pick");
  };

  const saveSample = async (uploadAnother: boolean) => {
    if (!voiceId || !picked || saving) return;
    setSaving(true);
    try {
      await stopActivePlayback();
      setPreviewing(false);
      const res = await api.addVoiceSample(voiceId, {
        uri: picked.uri,
        name: picked.name,
        mimeType: picked.mimeType,
        source: "upload",
        note: note.trim() || undefined,
      });
      const fromVideo = res.from_video || picked.isVideo;
      if (uploadAnother) {
        setPicked(null);
        setNote("");
        setPhase("pick");
        Alert.alert(
          "Đã lưu",
          fromVideo
            ? "Đã tách tiếng. Mẫu ở tab Chưa xử lý — nghe rồi Duyệt. Chọn file tiếp khi sẵn sàng."
            : "Chọn file tiếp theo khi sẵn sàng.",
        );
      } else {
        Alert.alert(
          fromVideo ? "Đã tách tiếng" : "Đã lưu mẫu giọng",
          fromVideo
            ? "Mẫu vào tab Chưa xử lý — nghe lại rồi Duyệt trước khi clone."
            : "Quay lại Voice DNA để xem điểm và Clone.",
          [{ text: "OK", onPress: () => router.back() }],
        );
      }
    } catch (e) {
      Alert.alert("Lỗi", e instanceof Error ? e.message : "Không lưu được.");
    } finally {
      setSaving(false);
    }
  };

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
                <Text style={[styles.stepNum, active && styles.stepNumActive]}>
                  {done ? "✓" : i + 1}
                </Text>
              </View>
              <Text
                style={[styles.stepLabel, active && styles.stepLabelActive]}
                numberOfLines={1}
              >
                {label}
              </Text>
            </View>
          );
        })}
      </View>

      <ScrollView
        style={styles.flex}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 120 }]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.lead}>
          Tải ghi âm hoặc video của người thân — Zalo, cuộc gọi, clip điện thoại. Video chỉ
          lấy tiếng nói (hình không lưu vào mẫu giọng).
        </Text>
        <Text style={styles.formats}>
          Audio ≤25 MB · Video ≤100 MB (mp4/mov…) · băng dài nhiều người → Tách giọng từ
          băng dài
        </Text>
        <Text style={styles.qualityNote}>
          ElevenLabs rất nhạy với chất lượng thu: đoạn ngắn sạch (~30–60s) thường clone tốt
          hơn băng cũ dài (vd. ~6 phút). Với file dài, hãy cắt/tách đoạn rõ lời trước khi
          clone — hoặc ưu tiên ghi mới đọc text nếu còn làm được.
        </Text>

        {phase === "pick" ? (
          <Pressable
            style={[styles.pickBtn, picking && styles.disabled]}
            onPress={pickFile}
            disabled={picking}
          >
            {picking ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.pickBtnText}>Chọn file audio / video</Text>
            )}
          </Pressable>
        ) : null}

        {picked ? (
          <View style={styles.fileCard}>
            <Text style={styles.fileName} numberOfLines={2}>
              {picked.name}
            </Text>
            <Text style={styles.fileMeta}>
              {formatBytes(picked.sizeBytes)} · {picked.mimeType}
              {picked.isVideo ? " · sẽ tách tiếng khi lưu" : ""}
            </Text>
            {picked.isVideo ? (
              <Text style={styles.videoHint}>
                Không nghe thử video tại đây — sau khi lưu, nghe bản tiếng ở Mẫu giọng →
                Chưa xử lý.
              </Text>
            ) : null}

            <Text style={styles.noteLabel}>Ghi chú (tuỳ chọn)</Text>
            <TextInput
              style={styles.noteInput}
              value={note}
              onChangeText={setNote}
              placeholder="Vd: Zalo 2023, video đám cưới, cuộc gọi…"
              placeholderTextColor={colors.inkSoft}
              multiline
            />
          </View>
        ) : null}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
        {phase === "review" && picked ? (
          <>
            <View style={styles.footerRow}>
              {!picked.isVideo ? (
                <Pressable style={[styles.btnPrimary, styles.btnFlex]} onPress={togglePreview}>
                  <Text style={styles.btnPrimaryText}>
                    {!previewing ? "Nghe thử" : previewPaused ? "Tiếp tục" : "Tạm dừng"}
                  </Text>
                </Pressable>
              ) : null}
              <Pressable
                style={[styles.btnPrimary, styles.btnFlex, saving && styles.disabled]}
                onPress={() => saveSample(false)}
                disabled={saving}
              >
                <Text style={styles.btnPrimaryText}>
                  {saving
                    ? picked.isVideo
                      ? "Đang tách tiếng…"
                      : "Đang lưu…"
                    : picked.isVideo
                      ? "Tách tiếng & lưu"
                      : "Lưu mẫu"}
                </Text>
              </Pressable>
            </View>
            <View style={styles.footerRow}>
              <Pressable
                style={[styles.btnGhost, styles.btnFlex, saving && styles.disabled]}
                onPress={() => saveSample(true)}
                disabled={saving}
              >
                <Text style={styles.btnGhostText}>Lưu & tải thêm</Text>
              </Pressable>
              <Pressable style={[styles.btnGhost, styles.btnFlex]} onPress={discardFile}>
                <Text style={styles.btnGhostText}>Chọn file khác</Text>
              </Pressable>
            </View>
          </>
        ) : null}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
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
  stepLabel: {
    flex: 1,
    fontSize: 11,
    color: colors.inkSoft,
    fontWeight: "600",
  },
  stepLabelActive: {
    color: colors.ink,
  },
  content: {
    padding: 20,
    gap: 14,
  },
  lead: {
    fontFamily: fonts.display,
    fontSize: 20,
    lineHeight: 28,
    color: colors.ink,
  },
  formats: {
    fontSize: 13,
    color: colors.inkSoft,
    lineHeight: 18,
  },
  qualityNote: {
    fontSize: 13,
    color: colors.inkSoft,
    lineHeight: 19,
    marginTop: 4,
  },
  pickBtn: {
    backgroundColor: colors.brand,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 8,
  },
  pickBtnText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 16,
  },
  fileCard: {
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 14,
    gap: 8,
  },
  fileName: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.ink,
  },
  fileMeta: {
    fontSize: 12,
    color: colors.inkSoft,
  },
  videoHint: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.inkSoft,
    marginTop: 4,
  },
  noteLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.inkSoft,
    marginTop: 4,
  },
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
  footer: {
    borderTopWidth: 1,
    borderTopColor: colors.line,
    backgroundColor: colors.bg,
    paddingHorizontal: 20,
    paddingTop: 12,
    gap: 10,
  },
  footerRow: {
    flexDirection: "row",
    gap: 10,
  },
  btnFlex: { flex: 1 },
  btnPrimary: {
    backgroundColor: colors.brand,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
  },
  btnPrimaryText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 15,
  },
  btnGhost: {
    borderWidth: 1,
    borderColor: colors.brand,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
  },
  btnGhostText: {
    color: colors.brand,
    fontWeight: "700",
    fontSize: 14,
  },
  disabled: { opacity: 0.5 },
});
