import { MemoryItem } from "@forever/api-client";
import * as ImagePicker from "expo-image-picker";
import { useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { playLocalAudio, stopActivePlayback } from "@/lib/audio";
import { useAuth } from "@/lib/auth";
import { MemoryVideoModal } from "@/components/MemoryVideoModal";
import { fetchAuthedMediaUri } from "@/lib/media";
import { guessVideoMime, pickVideoMemoryFile } from "@/lib/mediaPick";
import { useSpaceScreenOptions } from "@/lib/spaceHeader";
import { colors, fonts } from "@/lib/theme";

function kindLabel(kind: string): string {
  if (kind === "voice") return "Giọng nói";
  if (kind === "video") return "Video";
  if (kind === "photo") return "Ảnh";
  if (kind === "letter") return "Thư";
  return "Ghi chú";
}

const MAX_VIDEO_BYTES = 200 * 1024 * 1024;

export default function LibraryScreen() {
  const { spaceId } = useLocalSearchParams<{ spaceId: string }>();
  const { api } = useAuth();
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteTitle, setNoteTitle] = useState("");
  const [noteBody, setNoteBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [photoUris, setPhotoUris] = useState<Record<string, string>>({});
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [videoOpen, setVideoOpen] = useState(false);
  const [videoUri, setVideoUri] = useState<string | null>(null);
  const [videoTitle, setVideoTitle] = useState("");
  const [videoLoading, setVideoLoading] = useState(false);
  const [videoError, setVideoError] = useState<string | null>(null);

  useSpaceScreenOptions({
    spaceId,
    title: "Thư viện ký ức",
    backTitle: "Nhà",
  });

  const load = useCallback(async () => {
    if (!spaceId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.listMemories(spaceId);
      setMemories(res.memories);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tải được thư viện.");
    } finally {
      setLoading(false);
    }
  }, [api, spaceId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const item of memories) {
        if (item.kind !== "photo" || !item.has_media) continue;
        try {
          const uri = await fetchAuthedMediaUri(
            api.memoryMediaUrl(item.id),
            item.id,
            item.media_mime ?? "image/jpeg",
          );
          if (!cancelled) {
            setPhotoUris((prev) => (prev[item.id] ? prev : { ...prev, [item.id]: uri }));
          }
        } catch {
          // ignore single image failures
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, memories]);

  const saveNote = async () => {
    if (!spaceId || !noteBody.trim() || saving) return;
    setSaving(true);
    try {
      await api.createNoteMemory(spaceId, {
        title: noteTitle.trim() || "Ghi chú",
        body: noteBody.trim(),
      });
      setNoteOpen(false);
      setNoteTitle("");
      setNoteBody("");
      await load();
    } catch (e) {
      Alert.alert("Lỗi", e instanceof Error ? e.message : "Không lưu được.");
    } finally {
      setSaving(false);
    }
  };

  const pickPhoto = async () => {
    if (!spaceId) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Cần quyền", "Cho phép truy cập ảnh để lưu vào thư viện.");
      return;
    }
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.85,
    });
    if (picked.canceled || !picked.assets[0]) return;
    const asset = picked.assets[0];
    setSaving(true);
    try {
      await api.uploadMemory(spaceId, {
        kind: "photo",
        uri: asset.uri,
        name: asset.fileName ?? "photo.jpg",
        mimeType: asset.mimeType ?? "image/jpeg",
        title: "Ảnh ký ức",
      });
      await load();
    } catch (e) {
      Alert.alert("Lỗi", e instanceof Error ? e.message : "Không tải ảnh được.");
    } finally {
      setSaving(false);
    }
  };

  const pickVideo = async () => {
    if (!spaceId) return;
    try {
      const asset = await pickVideoMemoryFile();
      if (!asset) return;
      if (asset.size != null && asset.size > MAX_VIDEO_BYTES) {
        Alert.alert("File quá lớn", "Video tối đa 200 MB.");
        return;
      }
      const name = asset.name ?? "video.mts";
      setSaving(true);
      try {
        await api.uploadMemory(spaceId, {
          kind: "video",
          uri: asset.uri,
          name,
          mimeType: guessVideoMime(name, asset.mimeType),
          title: "Video ký ức",
          body: "Có thể dùng cho Giọng từ ký ức (Extract).",
        });
        await load();
      } catch (e) {
        Alert.alert("Lỗi", e instanceof Error ? e.message : "Không tải video được.");
      } finally {
        setSaving(false);
      }
    } catch (e) {
      Alert.alert("Không chọn được file", e instanceof Error ? e.message : "Thử lại.");
    }
  };

  const playVoice = async (item: MemoryItem) => {
    if (!item.has_media) return;
    try {
      if (playingId === item.id) {
        await stopActivePlayback();
        setPlayingId(null);
        return;
      }
      const uri = await fetchAuthedMediaUri(
        api.memoryMediaUrl(item.id),
        item.id,
        item.media_mime ?? "audio/mp4",
      );
      setPlayingId(item.id);
      await playLocalAudio(uri, () => setPlayingId(null));
    } catch (e) {
      setPlayingId(null);
      Alert.alert("Lỗi", e instanceof Error ? e.message : "Không phát được.");
    }
  };

  const closeVideo = () => {
    setVideoOpen(false);
    setVideoUri(null);
    setVideoTitle("");
    setVideoLoading(false);
    setVideoError(null);
  };

  const playVideo = async (item: MemoryItem) => {
    if (!item.has_media) return;
    await stopActivePlayback();
    setPlayingId(null);
    setVideoOpen(true);
    setVideoUri(null);
    setVideoTitle(item.title || "Video ký ức");
    setVideoLoading(true);
    setVideoError(null);
    try {
      const uri = await fetchAuthedMediaUri(
        api.memoryMediaUrl(item.id),
        `video-${item.id}`,
        item.media_mime ?? "video/mp2t",
      );
      setVideoUri(uri);
    } catch (e) {
      setVideoError(e instanceof Error ? e.message : "Không phát được video.");
    } finally {
      setVideoLoading(false);
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
      <View style={styles.actions}>
        <Pressable style={styles.actionBtn} onPress={() => setNoteOpen(true)}>
          <Text style={styles.actionText}>Thêm ghi chú</Text>
        </Pressable>
        <Pressable style={styles.actionBtn} onPress={pickPhoto} disabled={saving}>
          <Text style={styles.actionText}>Thêm ảnh</Text>
        </Pressable>
        <Pressable style={styles.actionBtn} onPress={pickVideo} disabled={saving}>
          <Text style={styles.actionText}>Thêm video</Text>
        </Pressable>
      </View>

      <FlatList
        data={memories}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <Text style={styles.empty}>
            Chưa có ký ức. Thêm ghi chú, ảnh, video, hoặc trả lời Time-Capsule.
          </Text>
        }
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.kind}>{kindLabel(item.kind)}</Text>
            <Text style={styles.title}>{item.title || "Không tiêu đề"}</Text>
            {item.body ? <Text style={styles.body}>{item.body}</Text> : null}
            {item.kind === "photo" && photoUris[item.id] ? (
              <Image source={{ uri: photoUris[item.id] }} style={styles.photo} />
            ) : null}
            {item.kind === "voice" && item.has_media ? (
              <Pressable style={styles.playBtn} onPress={() => playVoice(item)}>
                <Text style={styles.playText}>
                  {playingId === item.id ? "Đang phát…" : "Nghe lại"}
                </Text>
              </Pressable>
            ) : null}
            {item.kind === "video" && item.has_media ? (
              <Pressable style={styles.playBtn} onPress={() => playVideo(item)}>
                <Text style={styles.playText}>Xem video</Text>
              </Pressable>
            ) : null}
            <Text style={styles.meta}>
              {item.creator_name ?? "Thành viên"}
              {item.occurred_at
                ? ` · ${new Date(item.occurred_at).toLocaleDateString("vi-VN")}`
                : ""}
            </Text>
          </View>
        )}
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <MemoryVideoModal
        visible={videoOpen}
        uri={videoUri}
        title={videoTitle}
        loading={videoLoading}
        error={videoError}
        onClose={closeVideo}
      />

      <Modal visible={noteOpen} animationType="slide" transparent>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Ghi chú mới</Text>
            <TextInput
              value={noteTitle}
              onChangeText={setNoteTitle}
              placeholder="Tiêu đề (tuỳ chọn)"
              placeholderTextColor={colors.inkSoft}
              style={styles.input}
            />
            <TextInput
              value={noteBody}
              onChangeText={setNoteBody}
              placeholder="Nội dung ký ức…"
              placeholderTextColor={colors.inkSoft}
              style={[styles.input, styles.inputTall]}
              multiline
            />
            <View style={styles.modalActions}>
              <Pressable onPress={() => setNoteOpen(false)}>
                <Text style={styles.cancel}>Huỷ</Text>
              </Pressable>
              <Pressable
                style={[styles.saveBtn, (!noteBody.trim() || saving) && { opacity: 0.5 }]}
                onPress={saveNote}
                disabled={!noteBody.trim() || saving}
              >
                <Text style={styles.saveText}>Lưu</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bg,
  },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 10, padding: 16, paddingBottom: 8 },
  actionBtn: {
    backgroundColor: colors.brand,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  actionText: { color: "#f4efe6", fontWeight: "600" },
  list: { padding: 16, paddingTop: 8, paddingBottom: 40 },
  empty: { color: colors.inkSoft, lineHeight: 22, paddingTop: 24 },
  card: {
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.line,
  },
  kind: {
    fontSize: 12,
    color: colors.brandSoft,
    fontWeight: "600",
    marginBottom: 4,
  },
  title: {
    fontFamily: fonts.display,
    fontSize: 20,
    color: colors.ink,
    marginBottom: 6,
  },
  body: { color: colors.ink, lineHeight: 22, fontSize: 16 },
  photo: {
    marginTop: 12,
    width: "100%",
    height: 180,
    borderRadius: 12,
    backgroundColor: colors.bgDeep,
  },
  playBtn: {
    marginTop: 12,
    alignSelf: "flex-start",
    backgroundColor: colors.bgDeep,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  playText: { color: colors.brand, fontWeight: "600" },
  meta: { marginTop: 10, color: colors.inkSoft, fontSize: 13 },
  error: { color: colors.danger, padding: 16 },
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
    gap: 10,
  },
  modalTitle: {
    fontFamily: fonts.display,
    fontSize: 22,
    color: colors.ink,
    marginBottom: 4,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: "#fff",
    color: colors.ink,
    fontSize: 16,
  },
  inputTall: { minHeight: 110, textAlignVertical: "top" },
  modalActions: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 8,
  },
  cancel: { color: colors.inkSoft, fontSize: 16 },
  saveBtn: {
    backgroundColor: colors.brand,
    borderRadius: 14,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  saveText: { color: "#f4efe6", fontWeight: "600" },
});
