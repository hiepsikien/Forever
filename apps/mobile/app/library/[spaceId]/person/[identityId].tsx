import {
  IdentityProfile,
  MemoryCandidate,
  MemoryItem,
  MemoryVisibility,
} from "@forever/api-client";
import * as ImagePicker from "expo-image-picker";
import { useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";

import {
  AddMemoryAction,
  AddMemorySheet,
} from "@/components/library/AddMemorySheet";
import { KindFilterChips } from "@/components/library/KindFilterChips";
import { LibrarySearchBar } from "@/components/library/LibrarySearchBar";
import { MemoryKindCard } from "@/components/library/MemoryKindCard";
import { MemoryReadModal } from "@/components/library/MemoryReadModal";
import {
  TextMemoryFormModal,
  TextMemoryKind,
} from "@/components/library/TextMemoryFormModal";
import { MemoryCaptionModal } from "@/components/MemoryCaptionModal";
import { MemoryVideoModal } from "@/components/MemoryVideoModal";
import { playLocalAudio, stopActivePlayback } from "@/lib/audio";
import { useAuth } from "@/lib/auth";
import { identityChipLabel } from "@/lib/identityDisplay";
import {
  candidatesForPerson,
  filterMemories,
  groupLifeByDecade,
  memoriesForPerson,
  SHELF_LABELS,
  ShelfFilter,
  sortByCreatedDesc,
  UNTAGGED_PERSON_ID,
} from "@/lib/libraryShelves";
import { fetchAuthedMediaUri } from "@/lib/media";
import {
  displayMemoryNote,
  displayMemoryTitle,
  isGenericMemoryTitle,
  titleFromFileName,
} from "@/lib/memoryDisplay";
import {
  mergeMemoryTags,
  parseHeritageIdentityIds,
} from "@/lib/memoryTags";
import { guessVideoMime, pickVideoMemoryFile } from "@/lib/mediaPick";
import { useSpaceScreenOptions } from "@/lib/spaceHeader";
import { colors, fonts } from "@/lib/theme";

const MAX_VIDEO_BYTES = 200 * 1024 * 1024;
const THUMB_RETRY_DELAYS_MS = [3000, 5000, 10000, 15000, 30000];
const MAX_THUMB_ATTEMPTS = 10;

type PendingUpload = {
  kind: "video" | "photo";
  uri: string;
  name: string;
  mimeType: string;
};

type ListRow =
  | { type: "section"; key: string; title: string }
  | { type: "memory"; key: string; item: MemoryItem }
  | { type: "candidate"; key: string; item: MemoryCandidate };

const KIND_FACT: Record<string, string> = {
  life_state: "Hiện tại",
  event: "Việc đã xảy ra",
  preference: "Thói quen",
  relationship: "Quan hệ",
};

export default function LibraryPersonScreen() {
  const { spaceId, identityId } = useLocalSearchParams<{
    spaceId: string;
    identityId: string;
  }>();
  const { api, user } = useAuth();

  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [identities, setIdentities] = useState<IdentityProfile[]>([]);
  const [candidates, setCandidates] = useState<MemoryCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [shelf, setShelf] = useState<ShelfFilter>("all");
  const [query, setQuery] = useState("");
  const [privateOnly, setPrivateOnly] = useState(false);

  const [addOpen, setAddOpen] = useState(false);
  const [textOpen, setTextOpen] = useState(false);
  const [textKind, setTextKind] = useState<TextMemoryKind>("note");
  const [textTitle, setTextTitle] = useState("");
  const [textBody, setTextBody] = useState("");
  const [textOccurred, setTextOccurred] = useState("");
  const [textIdentityIds, setTextIdentityIds] = useState<string[]>([]);

  const [captionOpen, setCaptionOpen] = useState(false);
  const [captionMode, setCaptionMode] = useState<"upload" | "edit">("upload");
  const [captionTitle, setCaptionTitle] = useState("");
  const [captionBody, setCaptionBody] = useState("");
  const [pendingUpload, setPendingUpload] = useState<PendingUpload | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [captionKind, setCaptionKind] = useState<"video" | "photo" | "voice">("video");
  const [captionIdentityIds, setCaptionIdentityIds] = useState<string[]>([]);
  const [editingBaseTags, setEditingBaseTags] = useState("");

  const [photoUris, setPhotoUris] = useState<Record<string, string>>({});
  const [thumbUris, setThumbUris] = useState<Record<string, string>>({});
  const [thumbLoading, setThumbLoading] = useState<Record<string, boolean>>({});
  const [thumbErrors, setThumbErrors] = useState<Record<string, boolean>>({});
  const [playingId, setPlayingId] = useState<string | null>(null);
  const thumbRetryTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const thumbLoadedRef = useRef<Set<string>>(new Set());
  const loadVideoThumbRef = useRef<(item: MemoryItem, attempt?: number) => void>(
    () => {},
  );

  const [videoOpen, setVideoOpen] = useState(false);
  const [videoUri, setVideoUri] = useState<string | null>(null);
  const [videoTitle, setVideoTitle] = useState("");
  const [videoLoading, setVideoLoading] = useState(false);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [busyCandidateId, setBusyCandidateId] = useState<string | null>(null);
  const [reading, setReading] = useState<MemoryItem | null>(null);

  const person = useMemo(
    () => identities.find((i) => i.id === identityId) ?? null,
    [identities, identityId],
  );

  const title =
    identityId === UNTAGGED_PERSON_ID
      ? "Chưa neo ai"
      : person
        ? identityChipLabel(person, user?.id)
        : "Ký ức";

  useSpaceScreenOptions({
    spaceId,
    title,
    backTitle: "Thư viện",
  });

  const load = useCallback(async () => {
    if (!spaceId) return;
    setError(null);
    try {
      const [memRes, idRes, candRes] = await Promise.all([
        api.listMemories(spaceId),
        api.listIdentities(spaceId),
        api.listMemoryCandidates(spaceId, "pending").catch(() => ({ candidates: [] })),
      ]);
      setMemories(memRes.memories);
      setIdentities(idRes.identities);
      setCandidates(candRes.candidates);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tải được.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [api, spaceId]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  const personMemories = useMemo(
    () => (identityId ? memoriesForPerson(memories, identityId) : []),
    [memories, identityId],
  );

  const personCandidates = useMemo(
    () => (identityId ? candidatesForPerson(candidates, identityId) : []),
    [candidates, identityId],
  );

  const filtered = useMemo(
    () =>
      filterMemories(personMemories, {
        shelf,
        query,
        privateOnly,
      }),
    [personMemories, shelf, query, privateOnly],
  );

  const listRows: ListRow[] = useMemo(() => {
    const rows: ListRow[] = [];
    const showHeard = shelf === "all" || shelf === "heard";
    const showLife = shelf === "all" || shelf === "life";
    const showPoems = shelf === "all" || shelf === "poems";
    const showArtifacts = shelf === "all" || shelf === "artifacts";

    if (showHeard && !privateOnly && personCandidates.length > 0) {
      const q = query.trim().toLowerCase();
      const pending = personCandidates.filter(
        (c) => !q || c.statement.toLowerCase().includes(q),
      );
      if (pending.length) {
        rows.push({ type: "section", key: "pending", title: "Chờ duyệt" });
        for (const c of pending) {
          rows.push({ type: "candidate", key: `c-${c.id}`, item: c });
        }
      }
    }

    if (showLife) {
      const life = filtered.filter((m) => m.kind === "milestone");
      if (life.length) {
        if (shelf === "all") {
          rows.push({ type: "section", key: "life", title: SHELF_LABELS.life });
        }
        for (const section of groupLifeByDecade(life)) {
          if (shelf === "life" || shelf === "all") {
            rows.push({
              type: "section",
              key: `dec-${section.key}`,
              title: section.label,
            });
          }
          for (const item of section.items) {
            rows.push({ type: "memory", key: item.id, item });
          }
        }
      }
    }

    if (showPoems) {
      const poems = sortByCreatedDesc(filtered.filter((m) => m.kind === "poem"));
      if (poems.length) {
        if (shelf === "all") {
          rows.push({ type: "section", key: "poems", title: SHELF_LABELS.poems });
        }
        for (const item of poems) {
          rows.push({ type: "memory", key: item.id, item });
        }
      }
    }

    if (showArtifacts) {
      const arts = sortByCreatedDesc(
        filtered.filter((m) =>
          ["photo", "video", "voice", "note"].includes(m.kind),
        ),
      );
      if (arts.length) {
        if (shelf === "all") {
          rows.push({
            type: "section",
            key: "artifacts",
            title: SHELF_LABELS.artifacts,
          });
        }
        for (const item of arts) {
          rows.push({ type: "memory", key: item.id, item });
        }
      }
    }

    if (showHeard) {
      const heard = sortByCreatedDesc(
        filtered.filter((m) => m.kind === "knowledge"),
      );
      if (heard.length) {
        rows.push({
          type: "section",
          key: "kept",
          title: shelf === "heard" ? "Đã giữ" : SHELF_LABELS.heard,
        });
        for (const item of heard) {
          rows.push({ type: "memory", key: item.id, item });
        }
      }
    }

    return rows;
  }, [filtered, shelf, privateOnly, personCandidates, query]);

  useEffect(() => {
    let cancelled = false;
    thumbRetryTimers.current.forEach(clearTimeout);
    thumbRetryTimers.current = [];

    const scheduleRetry = (fn: () => void, delayMs: number) => {
      const timer = setTimeout(fn, delayMs);
      thumbRetryTimers.current.push(timer);
    };

    const loadVideoThumb = async (item: MemoryItem, attempt = 0) => {
      if (cancelled || thumbLoadedRef.current.has(item.id)) return;
      setThumbLoading((prev) => ({ ...prev, [item.id]: true }));
      try {
        const uri = await fetchAuthedMediaUri(
          api.memoryThumbnailUrl(item.id),
          `thumb-${item.id}`,
          "image/jpeg",
        );
        if (!cancelled) {
          thumbLoadedRef.current.add(item.id);
          setThumbUris((prev) => (prev[item.id] ? prev : { ...prev, [item.id]: uri }));
        }
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : "";
        const retryable =
          msg.includes("503") || msg.includes("502") || msg.includes("504");
        if (retryable && attempt < MAX_THUMB_ATTEMPTS) {
          const delay =
            THUMB_RETRY_DELAYS_MS[Math.min(attempt, THUMB_RETRY_DELAYS_MS.length - 1)];
          scheduleRetry(() => loadVideoThumb(item, attempt + 1), delay);
          return;
        }
        if (attempt < 2) {
          scheduleRetry(() => loadVideoThumb(item, attempt + 1), 2000);
          return;
        }
        setThumbErrors((prev) => ({ ...prev, [item.id]: true }));
      } finally {
        if (!cancelled) {
          setThumbLoading((prev) => ({ ...prev, [item.id]: false }));
        }
      }
    };

    loadVideoThumbRef.current = loadVideoThumb;

    (async () => {
      for (const item of personMemories) {
        if (!item.has_media) continue;
        try {
          if (item.kind === "photo") {
            const uri = await fetchAuthedMediaUri(
              api.memoryMediaUrl(item.id),
              item.id,
              item.media_mime ?? "image/jpeg",
            );
            if (!cancelled) {
              setPhotoUris((prev) =>
                prev[item.id] ? prev : { ...prev, [item.id]: uri },
              );
            }
          }
          if (item.kind === "video" && !thumbLoadedRef.current.has(item.id)) {
            void loadVideoThumb(item);
          }
        } catch {
          // ignore
        }
      }
    })();

    return () => {
      cancelled = true;
      thumbRetryTimers.current.forEach(clearTimeout);
      thumbRetryTimers.current = [];
    };
  }, [api, personMemories]);

  const defaultIdentityIds = useMemo(() => {
    if (!identityId || identityId === UNTAGGED_PERSON_ID) return [];
    return [identityId];
  }, [identityId]);

  const openTextForm = (kind: TextMemoryKind) => {
    setTextKind(kind);
    setTextTitle("");
    setTextBody("");
    setTextOccurred("");
    setTextIdentityIds(defaultIdentityIds);
    setTextOpen(true);
  };

  const onAddSelect = (action: AddMemoryAction) => {
    if (action === "note" || action === "milestone" || action === "poem") {
      openTextForm(action);
      return;
    }
    if (action === "photo") void pickPhoto();
    if (action === "video") void pickVideo();
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
    setPendingUpload({
      kind: "photo",
      uri: asset.uri,
      name: asset.fileName ?? "photo.jpg",
      mimeType: asset.mimeType ?? "image/jpeg",
    });
    setCaptionMode("upload");
    setCaptionKind("photo");
    setCaptionTitle(titleFromFileName(asset.fileName ?? "photo.jpg"));
    setCaptionBody("");
    setCaptionIdentityIds(defaultIdentityIds);
    setEditingId(null);
    setCaptionOpen(true);
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
      setPendingUpload({
        kind: "video",
        uri: asset.uri,
        name,
        mimeType: guessVideoMime(name, asset.mimeType),
      });
      setCaptionMode("upload");
      setCaptionKind("video");
      setCaptionTitle(titleFromFileName(name));
      setCaptionBody("");
      setCaptionIdentityIds(defaultIdentityIds);
      setEditingId(null);
      setCaptionOpen(true);
    } catch (e) {
      Alert.alert("Không chọn được file", e instanceof Error ? e.message : "Thử lại.");
    }
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

  const saveText = async () => {
    if (!spaceId || !textBody.trim() || saving) return;
    setSaving(true);
    try {
      const tags = mergeMemoryTags("", textIdentityIds);
      let occurred_at: string | undefined;
      if (textKind === "milestone" && textOccurred.trim()) {
        const raw = textOccurred.trim();
        occurred_at = /^\d{4}$/.test(raw) ? `${raw}-01-01` : raw;
      }
      await api.createNoteMemory(spaceId, {
        kind: textKind,
        title: textTitle.trim() || undefined,
        body: textBody.trim(),
        tags: tags || undefined,
        occurred_at,
      });
      setTextOpen(false);
      await load();
    } catch (e) {
      Alert.alert("Lỗi", e instanceof Error ? e.message : "Không lưu được.");
    } finally {
      setSaving(false);
    }
  };

  const saveCaption = async () => {
    if (!spaceId || saving) return;
    const titleVal = captionTitle.trim();
    if (!titleVal) {
      Alert.alert("Thiếu tên", "Hãy đặt tên để dễ nhận ra sau này.");
      return;
    }
    setSaving(true);
    try {
      if (captionMode === "upload" && pendingUpload) {
        await api.uploadMemory(spaceId, {
          kind: pendingUpload.kind,
          uri: pendingUpload.uri,
          name: pendingUpload.name,
          mimeType: pendingUpload.mimeType,
          title: titleVal,
          body: captionBody.trim(),
          tags: mergeMemoryTags("", captionIdentityIds) || undefined,
        });
      } else if (captionMode === "edit" && editingId) {
        await api.updateMemory(editingId, {
          title: titleVal,
          body: captionBody.trim(),
          tags: mergeMemoryTags(editingBaseTags, captionIdentityIds),
        });
      }
      setCaptionOpen(false);
      setPendingUpload(null);
      setEditingId(null);
      await load();
    } catch (e) {
      Alert.alert("Lỗi", e instanceof Error ? e.message : "Không lưu được.");
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = (item: MemoryItem) => {
    Alert.alert(
      "Xoá ký ức?",
      `"${displayMemoryTitle(item.kind, item.title)}" sẽ bị xoá. Không thể hoàn tác.`,
      [
        { text: "Huỷ", style: "cancel" },
        {
          text: "Xoá",
          style: "destructive",
          onPress: async () => {
            setSaving(true);
            try {
              await api.deleteMemory(item.id);
              await load();
            } catch (e) {
              Alert.alert("Lỗi", e instanceof Error ? e.message : "Không xoá được.");
            } finally {
              setSaving(false);
            }
          },
        },
      ],
    );
  };

  const toggleVisibility = (item: MemoryItem) => {
    const next = item.visibility === "private" ? "family" : "private";
    Alert.alert(
      next === "private" ? "Giữ riêng?" : "Chia sẻ cả nhà?",
      next === "private"
        ? "Chỉ mình bạn đọc được."
        : "Cả nhà sẽ đọc được ký ức này.",
      [
        { text: "Thôi", style: "cancel" },
        {
          text: next === "private" ? "Giữ riêng" : "Chia sẻ",
          onPress: async () => {
            setSaving(true);
            try {
              const saved = await api.updateMemory(item.id, { visibility: next });
              setMemories((prev) =>
                prev.map((m) => (m.id === saved.id ? saved : m)),
              );
            } catch (e) {
              Alert.alert("Lỗi", e instanceof Error ? e.message : "Chưa đổi được.");
            } finally {
              setSaving(false);
            }
          },
        },
      ],
    );
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

  const settleCandidate = async (
    item: MemoryCandidate,
    keep: boolean,
    visibility: MemoryVisibility = "family",
  ) => {
    setBusyCandidateId(item.id);
    try {
      if (keep) await api.approveMemoryCandidate(item.id, visibility);
      else await api.dismissMemoryCandidate(item.id);
      setCandidates((prev) => prev.filter((row) => row.id !== item.id));
      if (keep) await load();
    } catch (e) {
      Alert.alert("Lỗi", e instanceof Error ? e.message : "Không lưu được.");
    } finally {
      setBusyCandidateId(null);
    }
  };

  const keepCandidate = (item: MemoryCandidate) => {
    if (item.audience_scope !== "direct") {
      void settleCandidate(item, true);
      return;
    }
    Alert.alert(
      "Điều này nói riêng",
      "Bạn muốn giữ riêng cho mình, hay chia sẻ để cả nhà cùng đọc?",
      [
        { text: "Thôi", style: "cancel" },
        {
          text: "Giữ riêng",
          onPress: () => settleCandidate(item, true, "private"),
        },
        {
          text: "Chia sẻ cả nhà",
          onPress: () => settleCandidate(item, true, "family"),
        },
      ],
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
      <View style={styles.toolbar}>
        <Pressable style={styles.addBtn} onPress={() => setAddOpen(true)}>
          <Text style={styles.addBtnText}>Thêm</Text>
        </Pressable>
        <Pressable
          style={[styles.filterChip, privateOnly && styles.filterChipOn]}
          onPress={() => setPrivateOnly((v) => !v)}
        >
          <Text style={[styles.filterChipText, privateOnly && styles.filterChipTextOn]}>
            Chỉ mình tôi
          </Text>
        </Pressable>
      </View>
      {privateOnly ? (
        <Text style={styles.privateHint}>
          Đang xem ký ức bạn giữ riêng — người khác trong nhà không thấy.
        </Text>
      ) : null}

      <LibrarySearchBar value={query} onChange={setQuery} />
      <KindFilterChips value={shelf} onChange={setShelf} />

      <FlatList
        data={listRows}
        keyExtractor={(row) => row.key}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load();
            }}
            tintColor={colors.brand}
          />
        }
        ListEmptyComponent={
          <Text style={styles.empty}>
            {privateOnly
              ? "Chưa có ký ức giữ riêng trên kệ này. Bật lại «Chỉ mình tôi» để xem cả nhà."
              : "Chưa có ký ức trên kệ này. Bấm Thêm để ghi lại."}
          </Text>
        }
        renderItem={({ item: row }) => {
          if (row.type === "section") {
            return <Text style={styles.section}>{row.title}</Text>;
          }
          if (row.type === "candidate") {
            const c = row.item;
            const busy = busyCandidateId === c.id;
            return (
              <View style={styles.candidateCard}>
                <Text style={styles.candidateKind}>
                  {KIND_FACT[c.fact_kind] ?? c.fact_kind}
                  {c.audience_scope === "direct" ? " · phòng riêng" : ""}
                </Text>
                <Text style={styles.candidateBody}>{c.statement}</Text>
                {c.source_body ? (
                  <Text style={styles.candidateSource} numberOfLines={2}>
                    «{c.source_body}»
                  </Text>
                ) : null}
                <View style={styles.candidateActions}>
                  <Pressable
                    style={[styles.candBtn, styles.candKeep]}
                    disabled={busy}
                    onPress={() => keepCandidate(c)}
                  >
                    <Text style={styles.candKeepText}>Giữ lại</Text>
                  </Pressable>
                  <Pressable
                    style={styles.candBtn}
                    disabled={busy}
                    onPress={() => settleCandidate(c, false)}
                  >
                    <Text style={styles.candDismissText}>Bỏ</Text>
                  </Pressable>
                </View>
              </View>
            );
          }
          const item = row.item;
          return (
            <MemoryKindCard
              item={item}
              identities={identities}
              userId={user?.id}
              photoUri={photoUris[item.id]}
              thumbUri={thumbUris[item.id]}
              thumbLoading={thumbLoading[item.id]}
              thumbError={thumbErrors[item.id]}
              playingVoice={playingId === item.id}
              saving={saving}
              onPress={() => setReading(item)}
              onEdit={() => openCaptionForEdit(item)}
              onDelete={() => confirmDelete(item)}
              onToggleVisibility={
                item.created_by === user?.id
                  ? () => toggleVisibility(item)
                  : undefined
              }
              onPlayVoice={() => playVoice(item)}
              onPlayVideo={() => playVideo(item)}
              onRetryThumb={() => {
                thumbLoadedRef.current.delete(item.id);
                loadVideoThumbRef.current(item);
              }}
            />
          );
        }}
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <MemoryReadModal
        item={reading}
        visible={Boolean(reading)}
        onClose={() => setReading(null)}
      />

      <AddMemorySheet
        visible={addOpen}
        onClose={() => setAddOpen(false)}
        onSelect={onAddSelect}
      />

      <TextMemoryFormModal
        visible={textOpen}
        kind={textKind}
        title={textTitle}
        body={textBody}
        occurredAt={textOccurred}
        identities={identities}
        selectedIdentityIds={textIdentityIds}
        userId={user?.id}
        busy={saving}
        onChangeTitle={setTextTitle}
        onChangeBody={setTextBody}
        onChangeOccurredAt={setTextOccurred}
        onToggleIdentity={(id) =>
          setTextIdentityIds((prev) =>
            prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
          )
        }
        onCancel={() => setTextOpen(false)}
        onSave={saveText}
      />

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
        onToggleIdentity={(id) =>
          setCaptionIdentityIds((prev) =>
            prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
          )
        }
        onCancel={() => {
          setCaptionOpen(false);
          setPendingUpload(null);
          setEditingId(null);
        }}
        onSave={saveCaption}
      />

      <MemoryVideoModal
        visible={videoOpen}
        uri={videoUri}
        title={videoTitle}
        loading={videoLoading}
        loadingHint="Đang mở video… (lần đầu có thể chờ server chuẩn bị)."
        error={videoError}
        onClose={() => {
          setVideoOpen(false);
          setVideoUri(null);
          setVideoError(null);
        }}
      />
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
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 4,
  },
  addBtn: {
    backgroundColor: colors.brand,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  addBtnText: { color: "#f4efe6", fontWeight: "700" },
  filterChip: {
    flexShrink: 0,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.bgDeep,
  },
  filterChipOn: {
    backgroundColor: colors.brand,
    borderColor: colors.brand,
  },
  filterChipText: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.brandSoft,
  },
  filterChipTextOn: { color: "#f4efe6" },
  privateHint: {
    paddingHorizontal: 16,
    paddingBottom: 6,
    fontSize: 13,
    lineHeight: 18,
    color: colors.inkSoft,
  },
  list: { padding: 16, paddingTop: 4, paddingBottom: 48 },
  section: {
    fontFamily: fonts.display,
    fontSize: 20,
    color: colors.ink,
    marginTop: 12,
    marginBottom: 8,
  },
  empty: { color: colors.inkSoft, lineHeight: 22, paddingTop: 24 },
  error: { color: colors.danger, padding: 16 },
  candidateCard: {
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 14,
    marginBottom: 10,
    gap: 8,
  },
  candidateKind: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.brandSoft,
  },
  candidateBody: {
    fontSize: 16,
    lineHeight: 24,
    color: colors.ink,
  },
  candidateSource: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.inkSoft,
    fontStyle: "italic",
  },
  candidateActions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 4,
  },
  candBtn: {
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: colors.bgDeep,
  },
  candKeep: { backgroundColor: colors.brand },
  candKeepText: { color: "#f4efe6", fontWeight: "700" },
  candDismissText: { color: colors.inkSoft, fontWeight: "600" },
});
