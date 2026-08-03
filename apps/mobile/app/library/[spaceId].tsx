import { IdentityProfile, MemoryItem } from "@forever/api-client";
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

import { MemoryCaptionModal } from "@/components/MemoryCaptionModal";
import { IdentityChipPicker } from "@/components/IdentityChipPicker";
import { MemoryVideoModal } from "@/components/MemoryVideoModal";
import { playLocalAudio, stopActivePlayback } from "@/lib/audio";
import { useAuth } from "@/lib/auth";
import { fetchAuthedMediaUri } from "@/lib/media";
import {
  displayMemoryNote,
  displayMemoryTitle,
  isGenericMemoryTitle,
  titleFromFileName,
} from "@/lib/memoryDisplay";
import {
  heritageLabelsForMemory,
  mergeMemoryTags,
  parseHeritageIdentityIds,
} from "@/lib/memoryTags";
import { guessVideoMime, pickVideoMemoryFile } from "@/lib/mediaPick";
import { useSpaceScreenOptions } from "@/lib/spaceHeader";
import { colors, fonts } from "@/lib/theme";

const MAX_VIDEO_BYTES = 200 * 1024 * 1024;

type PendingUpload = {
  kind: "video" | "photo";
  uri: string;
  name: string;
  mimeType: string;
};

function kindLabel(kind: string): string {
  if (kind === "voice") return "Giọng nói";
  if (kind === "video") return "Video";
  if (kind === "photo") return "Ảnh";
  return "Ghi chú";
}

export default function LibraryScreen() {
  const { spaceId } = useLocalSearchParams<{ spaceId: string }>();
  const { api, user } = useAuth();
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [identities, setIdentities] = useState<IdentityProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [noteOpen, setNoteOpen] = useState(false);
  const [noteTitle, setNoteTitle] = useState("");
  const [noteBody, setNoteBody] = useState("");

  const [captionOpen, setCaptionOpen] = useState(false);
  const [captionMode, setCaptionMode] = useState<"upload" | "edit">("upload");
  const [captionTitle, setCaptionTitle] = useState("");
  const [captionBody, setCaptionBody] = useState("");
  const [pendingUpload, setPendingUpload] = useState<PendingUpload | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [captionKind, setCaptionKind] = useState<"video" | "photo" | "voice">("video");
  const [captionIdentityIds, setCaptionIdentityIds] = useState<string[]>([]);
  const [editingBaseTags, setEditingBaseTags] = useState("");
  const [noteIdentityIds, setNoteIdentityIds] = useState<string[]>([]);

  const [photoUris, setPhotoUris] = useState<Record<string, string>>({});
  const [thumbUris, setThumbUris] = useState<Record<string, string>>({});
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
      const [memRes, idRes] = await Promise.all([
        api.listMemories(spaceId),
        api.listIdentities(spaceId),
      ]);
      setMemories(memRes.memories);
      setIdentities(idRes.identities);
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
        if (!item.has_media) continue;
        try {
          if (item.kind === "photo") {
            const uri = await fetchAuthedMediaUri(
              api.memoryMediaUrl(item.id),
              item.id,
              item.media_mime ?? "image/jpeg",
            );
            if (!cancelled) {
              setPhotoUris((prev) => (prev[item.id] ? prev : { ...prev, [item.id]: uri }));
            }
          }
          if (item.kind === "video") {
            const uri = await fetchAuthedMediaUri(
              api.memoryThumbnailUrl(item.id),
              `thumb-${item.id}`,
              "image/jpeg",
            );
            if (!cancelled) {
              setThumbUris((prev) => (prev[item.id] ? prev : { ...prev, [item.id]: uri }));
            }
          }
        } catch {
          // ignore per-item preview failures
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, memories]);

  const toggleCaptionIdentity = (identityId: string) => {
    setCaptionIdentityIds((prev) =>
      prev.includes(identityId)
        ? prev.filter((id) => id !== identityId)
        : [...prev, identityId],
    );
  };

  const toggleNoteIdentity = (identityId: string) => {
    setNoteIdentityIds((prev) =>
      prev.includes(identityId)
        ? prev.filter((id) => id !== identityId)
        : [...prev, identityId],
    );
  };

  const openCaptionForUpload = (pending: PendingUpload) => {
    setPendingUpload(pending);
    setCaptionMode("upload");
    setCaptionKind(pending.kind);
    setCaptionTitle(titleFromFileName(pending.name));
    setCaptionBody("");
    setCaptionIdentityIds([]);
    setEditingBaseTags("");
    setEditingId(null);
    setCaptionOpen(true);
  };

  const openCaptionForEdit = (item: MemoryItem) => {
    setPendingUpload(null);
    setCaptionMode("edit");
    setCaptionKind(item.kind as "video" | "photo" | "voice");
    setCaptionTitle(isGenericMemoryTitle(item.kind, item.title) ? "" : item.title);
    setCaptionBody(displayMemoryNote(item.body) ?? "");
    setCaptionIdentityIds(parseHeritageIdentityIds(item.tags));
    setEditingBaseTags(item.tags ?? "");
    setEditingId(item.id);
    setCaptionOpen(true);
  };

  const closeCaption = () => {
    setCaptionOpen(false);
    setPendingUpload(null);
    setEditingId(null);
    setCaptionIdentityIds([]);
    setEditingBaseTags("");
  };

  const saveCaption = async () => {
    if (!spaceId || saving) return;
    const title = captionTitle.trim();
    if (!title) {
      Alert.alert("Thiếu tên", "Hãy đặt tên để dễ nhận ra sau này.");
      return;
    }
    setSaving(true);
    try {
      const tags = mergeMemoryTags("", captionIdentityIds);
      if (captionMode === "upload" && pendingUpload) {
        await api.uploadMemory(spaceId, {
          kind: pendingUpload.kind,
          uri: pendingUpload.uri,
          name: pendingUpload.name,
          mimeType: pendingUpload.mimeType,
          title,
          body: captionBody.trim(),
          tags: tags || undefined,
        });
        closeCaption();
        await load();
        return;
      }
      if (captionMode === "edit" && editingId) {
        await api.updateMemory(editingId, {
          title,
          body: captionBody.trim(),
          tags: mergeMemoryTags(editingBaseTags, captionIdentityIds),
        });
        closeCaption();
        await load();
      }
    } catch (e) {
      Alert.alert("Lỗi", e instanceof Error ? e.message : "Không lưu được.");
    } finally {
      setSaving(false);
    }
  };

  const saveNote = async () => {
    if (!spaceId || !noteBody.trim() || saving) return;
    setSaving(true);
    try {
      const tags = mergeMemoryTags("", noteIdentityIds);
      await api.createNoteMemory(spaceId, {
        title: noteTitle.trim() || "Ghi chú",
        body: noteBody.trim(),
        tags: tags || undefined,
      });
      setNoteOpen(false);
      setNoteTitle("");
      setNoteBody("");
      setNoteIdentityIds([]);
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
    openCaptionForUpload({
      kind: "photo",
      uri: asset.uri,
      name: asset.fileName ?? "photo.jpg",
      mimeType: asset.mimeType ?? "image/jpeg",
    });
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
      openCaptionForUpload({
        kind: "video",
        uri: asset.uri,
        name,
        mimeType: guessVideoMime(name, asset.mimeType),
      });
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
    setVideoTitle(displayMemoryTitle(item.kind, item.title));
    setVideoLoading(true);
    setVideoError(null);
    try {
      const uri = await fetchAuthedMediaUri(
        api.memoryPlaybackUrl(item.id),
        `playback-v2-${item.id}`,
        "video/mp4",
        `${item.title || "video"}.mp4`,
      );
      setVideoUri(uri);
    } catch (e) {
      setVideoError(e instanceof Error ? e.message : "Không phát được video.");
    } finally {
      setVideoLoading(false);
    }
  };

  const renderCard = (item: MemoryItem) => {
    const note = displayMemoryNote(item.body);
    const title = displayMemoryTitle(item.kind, item.title);
    const untitled = isGenericMemoryTitle(item.kind, item.title);
    const people = heritageLabelsForMemory(item.tags, identities, user?.id);

    return (
      <View style={styles.card}>
        <View style={styles.cardTop}>
          <Text style={styles.kind}>{kindLabel(item.kind)}</Text>
          <Pressable onPress={() => openCaptionForEdit(item)} hitSlop={8}>
            <Text style={styles.editLink}>Sửa</Text>
          </Pressable>
        </View>

        <Text style={[styles.title, untitled && styles.titleUntitled]}>{title}</Text>

        {people.length > 0 ? (
          <View style={styles.peopleRow}>
            {people.map((label) => (
              <View key={`${item.id}-${label}`} style={styles.personChip}>
                <Text style={styles.personChipText}>{label}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {note ? <Text style={styles.note}>{note}</Text> : null}

        {item.kind === "photo" && photoUris[item.id] ? (
          <Image source={{ uri: photoUris[item.id] }} style={styles.mediaPreview} />
        ) : null}

        {item.kind === "video" && item.has_media ? (
          <Pressable style={styles.videoThumbWrap} onPress={() => playVideo(item)}>
            {thumbUris[item.id] ? (
              <Image source={{ uri: thumbUris[item.id] }} style={styles.mediaPreview} />
            ) : (
              <View style={[styles.mediaPreview, styles.videoPlaceholder]}>
                <ActivityIndicator color={colors.brand} />
              </View>
            )}
            <View style={styles.playBadge}>
              <Text style={styles.playBadgeText}>▶ Phát</Text>
            </View>
          </Pressable>
        ) : null}

        {item.kind === "voice" && item.has_media ? (
          <Pressable style={styles.voiceBtn} onPress={() => playVoice(item)}>
            <Text style={styles.voiceBtnText}>
              {playingId === item.id ? "⏸ Đang phát…" : "▶ Nghe lại"}
            </Text>
          </Pressable>
        ) : null}

        {!note && item.kind !== "note" ? (
          <Pressable onPress={() => openCaptionForEdit(item)}>
            <Text style={styles.addNoteLink}>+ Thêm ghi chú</Text>
          </Pressable>
        ) : null}

        <Text style={styles.meta}>
          {item.creator_name ?? "Thành viên"}
          {item.occurred_at
            ? ` · ${new Date(item.occurred_at).toLocaleDateString("vi-VN")}`
            : ""}
        </Text>
      </View>
    );
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
        renderItem={({ item }) => renderCard(item)}
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <MemoryCaptionModal
        visible={captionOpen}
        mode={captionMode}
        mediaKind={captionKind}
        title={captionTitle}
        body={captionBody}
        identities={identities}
        selectedIdentityIds={captionIdentityIds}
        userId={user?.id}
        busy={saving}
        onChangeTitle={setCaptionTitle}
        onChangeBody={setCaptionBody}
        onToggleIdentity={toggleCaptionIdentity}
        onCancel={closeCaption}
        onSave={saveCaption}
      />

      <MemoryVideoModal
        visible={videoOpen}
        uri={videoUri}
        title={videoTitle}
        loading={videoLoading}
        loadingHint="Đang mở video… (lần đầu có thể chờ server chuẩn bị)."
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
            {identities.length > 0 ? (
              <>
                <Text style={styles.noteIdentityLabel}>Ai trong ký ức này?</Text>
                <IdentityChipPicker
                  identities={identities}
                  selectedIds={noteIdentityIds}
                  onToggle={toggleNoteIdentity}
                  userId={user?.id}
                />
              </>
            ) : null}
            <View style={styles.modalActions}>
              <Pressable
                onPress={() => {
                  setNoteOpen(false);
                  setNoteIdentityIds([]);
                }}
              >
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
    gap: 8,
  },
  cardTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  kind: {
    fontSize: 12,
    color: colors.brandSoft,
    fontWeight: "600",
  },
  editLink: {
    fontSize: 13,
    color: colors.brand,
    fontWeight: "600",
  },
  title: {
    fontFamily: fonts.display,
    fontSize: 22,
    color: colors.ink,
  },
  titleUntitled: {
    color: colors.inkSoft,
    fontStyle: "italic",
  },
  note: {
    color: colors.ink,
    lineHeight: 22,
    fontSize: 15,
  },
  peopleRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  personChip: {
    backgroundColor: colors.bgDeep,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  personChipText: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.brandSoft,
  },
  noteIdentityLabel: {
    marginTop: 4,
    fontSize: 13,
    fontWeight: "700",
    color: colors.inkSoft,
  },
  mediaPreview: {
    width: "100%",
    height: 200,
    borderRadius: 12,
    backgroundColor: colors.bgDeep,
  },
  videoThumbWrap: { position: "relative" },
  videoPlaceholder: {
    alignItems: "center",
    justifyContent: "center",
  },
  playBadge: {
    position: "absolute",
    left: 12,
    bottom: 12,
    backgroundColor: "rgba(0,0,0,0.55)",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  playBadgeText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  voiceBtn: {
    alignSelf: "flex-start",
    backgroundColor: colors.bgDeep,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  voiceBtnText: { color: colors.brand, fontWeight: "600" },
  addNoteLink: {
    fontSize: 14,
    color: colors.brandSoft,
    fontWeight: "600",
  },
  meta: { color: colors.inkSoft, fontSize: 13, marginTop: 4 },
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
