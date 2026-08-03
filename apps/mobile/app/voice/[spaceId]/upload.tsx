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

const STEPS = ["Chọn file", "Nghe thử", "Lưu"] as const;
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

type PickedFile = {
  uri: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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

  useSpaceScreenOptions({ spaceId, title: "Tải file audio", backTitle: "Nhà" });

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
        type: "audio/*",
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled || !result.assets?.length) return;

      const asset = result.assets[0];
      const sourceUri = asset.uri;
      const sourceName = asset.name || "sample.wav";

      const info = await FileSystem.getInfoAsync(sourceUri);
      const sizeBytes = info.exists && "size" in info ? info.size ?? 0 : 0;
      if (sizeBytes > MAX_UPLOAD_BYTES) {
        Alert.alert(
          "File quá lớn",
          `Tối đa 25 MB. File này: ${formatBytes(sizeBytes)}.`,
        );
        return;
      }

      const staged = await stageLocalAudioFile(sourceUri, {
        name: sourceName,
        mimeType: asset.mimeType,
        cacheKey: `${Date.now()}`,
      });

      setPicked({ uri: staged.uri, name: staged.name, mimeType: staged.mimeType, sizeBytes });
      setPhase("review");
    } catch (e) {
      Alert.alert("Lỗi", e instanceof Error ? e.message : "Không chọn được file.");
    } finally {
      setPicking(false);
    }
  };

  const togglePreview = async () => {
    if (!picked) return;
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
      await api.addVoiceSample(voiceId, {
        uri: picked.uri,
        name: picked.name,
        mimeType: picked.mimeType,
        source: "upload",
        note: note.trim() || undefined,
      });
      if (uploadAnother) {
        setPicked(null);
        setNote("");
        setPhase("pick");
        Alert.alert("Đã lưu", "Chọn file tiếp theo khi sẵn sàng.");
      } else {
        Alert.alert("Đã lưu mẫu giọng", "Quay lại Voice DNA để xem điểm và Clone.", [
          { text: "OK", onPress: () => router.back() },
        ]);
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
          Tải ghi âm cũ của người thân — tin nhắn thoại Zalo, cuộc gọi, video đã trích
          audio…
        </Text>
        <Text style={styles.formats}>mp3 · m4a · wav · aac · webm · 3gp · tối đa 25 MB</Text>

        {phase === "pick" ? (
          <Pressable
            style={[styles.pickBtn, picking && styles.disabled]}
            onPress={pickFile}
            disabled={picking}
          >
            {picking ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.pickBtnText}>Chọn file audio</Text>
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
            </Text>

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
              <Pressable style={[styles.btnPrimary, styles.btnFlex]} onPress={togglePreview}>
                <Text style={styles.btnPrimaryText}>
                  {!previewing ? "Nghe thử" : previewPaused ? "Tiếp tục" : "Tạm dừng"}
                </Text>
              </Pressable>
              <Pressable
                style={[styles.btnPrimary, styles.btnFlex, saving && styles.disabled]}
                onPress={() => saveSample(false)}
                disabled={saving}
              >
                <Text style={styles.btnPrimaryText}>
                  {saving ? "Đang lưu…" : "Lưu mẫu"}
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
