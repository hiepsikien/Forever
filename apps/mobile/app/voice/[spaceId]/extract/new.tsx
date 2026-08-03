import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { MemoryItem } from "@forever/api-client";

import { useAuth } from "@/lib/auth";
import {
  guessAudioMime,
  guessVideoMime,
  pickExtractMediaFile,
} from "@/lib/mediaPick";
import { useSpaceScreenOptions } from "@/lib/spaceHeader";
import { colors, fonts } from "@/lib/theme";

const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

type PickedFile = {
  uri: string;
  name: string;
  mimeType: string;
  sizeBytes?: number;
};

type Source =
  | { kind: "file"; file: PickedFile }
  | { kind: "memory"; memory: MemoryItem };

function formatBytes(bytes?: number): string {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isExtractableMemory(item: MemoryItem): boolean {
  if (!item.has_media) return false;
  if (item.kind === "video") return true;
  if (item.kind === "voice") return true;
  const mime = item.media_mime ?? "";
  return mime.startsWith("audio/") || mime.startsWith("video/");
}

function sourceLabel(source: Source): string {
  if (source.kind === "file") {
    const video = source.file.mimeType.startsWith("video/");
    return `${source.file.name}${video ? " · video" : ""}`;
  }
  return source.memory.title || (source.memory.kind === "video" ? "Video ký ức" : "Giọng ký ức");
}

export default function ExtractNewScreen() {
  const { spaceId, voiceId } = useLocalSearchParams<{
    spaceId: string;
    voiceId?: string;
  }>();
  const { api } = useAuth();
  const router = useRouter();

  const [numSpeakers, setNumSpeakers] = useState("2");
  const [source, setSource] = useState<Source | null>(null);
  const [busy, setBusy] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [memoriesLoading, setMemoriesLoading] = useState(false);

  useSpaceScreenOptions({
    spaceId,
    title: "Giọng từ ký ức",
    backTitle: "Nhà",
  });

  const loadMemories = useCallback(async () => {
    if (!spaceId) return;
    setMemoriesLoading(true);
    try {
      const res = await api.listMemories(spaceId);
      setMemories(res.memories.filter(isExtractableMemory));
    } catch (e) {
      Alert.alert(
        "Lỗi",
        e instanceof Error ? e.message : "Không tải được thư viện.",
      );
    } finally {
      setMemoriesLoading(false);
    }
  }, [api, spaceId]);

  useEffect(() => {
    if (libraryOpen) void loadMemories();
  }, [libraryOpen, loadMemories]);

  const pickFile = async () => {
    try {
      const asset = await pickExtractMediaFile();
      if (!asset) return;
      const name = asset.name || "tape.m4a";
      const sizeBytes = asset.size ?? undefined;
      if (sizeBytes != null && sizeBytes > MAX_UPLOAD_BYTES) {
        Alert.alert("File quá lớn", "Tối đa 200 MB. Hãy cắt ngắn hoặc nén trước.");
        return;
      }
      const mimeType = name.match(/\.(mts|m2ts|mp4|mov|mkv|avi|wmv|webm|3gp)$/i)
        ? guessVideoMime(name, asset.mimeType)
        : guessAudioMime(name, asset.mimeType);
      setSource({
        kind: "file",
        file: {
          uri: asset.uri,
          name,
          mimeType,
          sizeBytes,
        },
      });
    } catch (e) {
      Alert.alert("Không chọn được file", e instanceof Error ? e.message : "Thử lại.");
    }
  };

  const submit = async () => {
    if (!spaceId) return;
    if (!source) {
      Alert.alert("Chưa chọn nguồn", "Chọn file hoặc ký ức từ thư viện.");
      return;
    }
    const n = Number.parseInt(numSpeakers, 10);
    if (!Number.isFinite(n) || n < 1 || n > 20) {
      Alert.alert("Số người", "Nhập số người nói từ 1 đến 20.");
      return;
    }
    setBusy(true);
    try {
      const job =
        source.kind === "memory"
          ? await api.createExtractJobFromMemory(spaceId, {
              memoryId: source.memory.id,
              numSpeakers: n,
              voiceProfileId: voiceId || undefined,
            })
          : await api.createExtractJob(spaceId, {
              uri: source.file.uri,
              name: source.file.name,
              mimeType: source.file.mimeType,
              numSpeakers: n,
              voiceProfileId: voiceId || undefined,
            });
      const q = voiceId ? `?voiceId=${voiceId}` : "";
      router.replace(`/voice/${spaceId}/extract/${job.id}${q}` as never);
    } catch (e) {
      Alert.alert(
        "Lỗi",
        e instanceof Error ? e.message : "Không tạo được job Extract.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.root}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.title}>Pool giọng từ băng cũ</Text>
      <Text style={styles.body}>
        Chạy một lần → pool chung các SPEAKER. Video (mts, mp4, mov…) sẽ được
        trích audio trước khi tách giọng. Có thể chọn từ thư viện ký ức.
      </Text>

      <Text style={styles.label}>Số người nói trong băng</Text>
      <TextInput
        style={styles.input}
        value={numSpeakers}
        onChangeText={setNumSpeakers}
        keyboardType="number-pad"
        placeholder="vd. 5"
        placeholderTextColor={colors.inkSoft}
      />

      <Pressable style={styles.pick} onPress={pickFile} disabled={busy}>
        <Text style={styles.pickTitle}>
          {source?.kind === "file" ? "Đổi file" : "Chọn file từ máy"}
        </Text>
        <Text style={styles.pickSub}>
          {source?.kind === "file"
            ? `${sourceLabel(source)}${source.file.sizeBytes ? ` · ${formatBytes(source.file.sizeBytes)}` : ""}`
            : "mp3 · m4a · mts · mp4 · mov · tối đa 200 MB"}
        </Text>
      </Pressable>

      <Pressable
        style={styles.pickSecondary}
        onPress={() => setLibraryOpen(true)}
        disabled={busy}
      >
        <Text style={styles.pickTitle}>
          {source?.kind === "memory" ? "Đổi ký ức" : "Chọn từ thư viện ký ức"}
        </Text>
        <Text style={styles.pickSub}>
          {source?.kind === "memory"
            ? sourceLabel(source)
            : "Video hoặc giọng đã lưu trong thư viện"}
        </Text>
      </Pressable>

      <Pressable
        style={[styles.btn, (!source || busy) && styles.disabled]}
        onPress={submit}
        disabled={!source || busy}
      >
        {busy ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.btnText}>Tạo pool & tách giọng</Text>
        )}
      </Pressable>

      <Modal visible={libraryOpen} animationType="slide" transparent>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Chọn ký ức</Text>
            <Text style={styles.modalSub}>
              Video hoặc giọng nói đã lưu — không cần tải lại file.
            </Text>
            {memoriesLoading ? (
              <ActivityIndicator color={colors.brand} style={{ marginVertical: 24 }} />
            ) : (
              <FlatList
                data={memories}
                keyExtractor={(item) => item.id}
                style={styles.memoryList}
                ListEmptyComponent={
                  <Text style={styles.emptyMemories}>
                    Chưa có video hoặc giọng trong thư viện. Thêm video ở Thư
                    viện ký ức trước.
                  </Text>
                }
                renderItem={({ item }) => (
                  <Pressable
                    style={styles.memoryRow}
                    onPress={() => {
                      setSource({ kind: "memory", memory: item });
                      setLibraryOpen(false);
                    }}
                  >
                    <Text style={styles.memoryKind}>
                      {item.kind === "video" ? "Video" : "Giọng"}
                    </Text>
                    <Text style={styles.memoryTitle} numberOfLines={2}>
                      {item.title || "Không tiêu đề"}
                    </Text>
                    {item.body ? (
                      <Text style={styles.memoryBody} numberOfLines={2}>
                        {item.body}
                      </Text>
                    ) : null}
                  </Pressable>
                )}
              />
            )}
            <Pressable style={styles.modalClose} onPress={() => setLibraryOpen(false)}>
              <Text style={styles.modalCloseText}>Đóng</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  root: { padding: 20, gap: 14, paddingBottom: 40 },
  title: {
    fontFamily: fonts.display,
    fontSize: 26,
    color: colors.ink,
  },
  body: { fontSize: 15, lineHeight: 22, color: colors.inkSoft },
  label: {
    marginTop: 8,
    fontSize: 13,
    fontWeight: "700",
    color: colors.inkSoft,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.ink,
  },
  pick: {
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 16,
    gap: 4,
  },
  pickSecondary: {
    borderWidth: 1,
    borderColor: colors.brandSoft,
    backgroundColor: colors.bgDeep,
    borderRadius: 14,
    padding: 16,
    gap: 4,
  },
  pickTitle: { fontSize: 16, fontWeight: "700", color: colors.brand },
  pickSub: { fontSize: 13, color: colors.inkSoft },
  btn: {
    marginTop: 8,
    backgroundColor: colors.brand,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
  },
  btnText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  disabled: { opacity: 0.45 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    justifyContent: "flex-end",
  },
  modalCard: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    maxHeight: "75%",
    gap: 8,
  },
  modalTitle: {
    fontFamily: fonts.display,
    fontSize: 22,
    color: colors.ink,
  },
  modalSub: { fontSize: 14, color: colors.inkSoft, lineHeight: 20 },
  memoryList: { maxHeight: 360 },
  memoryRow: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    backgroundColor: colors.card,
  },
  memoryKind: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.brandSoft,
    marginBottom: 4,
  },
  memoryTitle: { fontSize: 16, fontWeight: "600", color: colors.ink },
  memoryBody: { marginTop: 4, fontSize: 14, color: colors.inkSoft },
  emptyMemories: {
    color: colors.inkSoft,
    lineHeight: 22,
    paddingVertical: 16,
    textAlign: "center",
  },
  modalClose: { alignSelf: "center", paddingVertical: 12 },
  modalCloseText: { color: colors.inkSoft, fontSize: 16 },
});
