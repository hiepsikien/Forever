import {
  IdentityProfile,
  MemoryCandidate,
  MemoryItem,
  MemoryVisibility,
} from "@forever/api-client";
import * as ImagePicker from "expo-image-picker";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Linking,
  Pressable,
  RefreshControl,
  StyleSheet,
  Switch,
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
  reciteButtonLabel,
  usePoemRecite,
} from "@/lib/poemRecite";
import {
  candidatesForPerson,
  countShelves,
  filterMemories,
  groupFamilyCalendar,
  memoriesForPerson,
  partitionPoems,
  PERSON_LIFE_LABEL,
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
  mergeCalendarTags,
  mergeMemoryTags,
  parseCalendarKind,
  parseHeritageIdentityIds,
  CalendarKind,
} from "@/lib/memoryTags";
import {
  documentPickerErrorMessage,
  MediaPermissionError,
  pickVideoFromPhotos,
} from "@/lib/mediaPick";
import { useSpaceScreenOptions } from "@/lib/spaceHeader";
import { colors, fonts, createThemedStyles } from "@/lib/theme";

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
  const { spaceId, identityId, shelf: shelfParam } = useLocalSearchParams<{
    spaceId: string;
    identityId: string;
    shelf?: string;
  }>();
  const { api, user } = useAuth();
  const router = useRouter();

  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [identities, setIdentities] = useState<IdentityProfile[]>([]);
  const [candidates, setCandidates] = useState<MemoryCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [shelf, setShelf] = useState<ShelfFilter>(() => {
    const raw = typeof shelfParam === "string" ? shelfParam : "";
    if (
      raw === "poems" ||
      raw === "life" ||
      raw === "artifacts" ||
      raw === "heard"
    ) {
      return raw;
    }
    return "all";
  });
  const [query, setQuery] = useState("");
  const [privateOnly, setPrivateOnly] = useState(false);
  /** all | own | gift — only applies when shelf is poems (or all with poems). */
  const [poemAuth, setPoemAuth] = useState<"all" | "own" | "gift">("all");

  const [addOpen, setAddOpen] = useState(false);
  const [textOpen, setTextOpen] = useState(false);
  const [textKind, setTextKind] = useState<TextMemoryKind>("note");
  const [textTitle, setTextTitle] = useState("");
  const [textBody, setTextBody] = useState("");
  const [textOccurred, setTextOccurred] = useState("");
  const [textCalendarKind, setTextCalendarKind] = useState<CalendarKind>("khac");
  const [textIdentityIds, setTextIdentityIds] = useState<string[]>([]);
  const [textEditingId, setTextEditingId] = useState<string | null>(null);
  const [textPhotoUri, setTextPhotoUri] = useState<string | null>(null);
  const [textPhotoName, setTextPhotoName] = useState("milestone.jpg");
  const [textPhotoMime, setTextPhotoMime] = useState("image/jpeg");
  const [textClearPhoto, setTextClearPhoto] = useState(false);
  const [canModerate, setCanModerate] = useState(false);
  const [canIngest, setCanIngest] = useState(false);

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
  const recite = usePoemRecite();

  const person = useMemo(
    () => identities.find((i) => i.id === identityId) ?? null,
    [identities, identityId],
  );
  const canRecite =
    Boolean(person) &&
    person?.status === "remembered" &&
    person?.voice_status === "ready" &&
    Boolean(person?.voice_provider_voice_id);

  const title =
    identityId === UNTAGGED_PERSON_ID
      ? "Chưa neo ai"
      : person
        ? person.handle
          ? `${identityChipLabel(person, user?.id)} · @${person.handle}`
          : identityChipLabel(person, user?.id)
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
      const [memRes, idRes, candRes, spaceRes, stewRes] = await Promise.all([
        api.listMemories(spaceId),
        api.listIdentities(spaceId),
        api.listMemoryCandidates(spaceId, "pending").catch(() => ({ candidates: [] })),
        api.getSpace(spaceId).catch(() => null),
        api.getStewardship(spaceId).catch(() => null),
      ]);
      setMemories(memRes.memories);
      setIdentities(idRes.identities);
      setCandidates(candRes.candidates);
      setCanModerate(
        spaceRes?.role === "owner" ||
          spaceRes?.role === "moderator" ||
          Boolean(stewRes?.is_steward),
      );
      setCanIngest(
        spaceRes?.role === "owner" || Boolean(stewRes?.is_steward),
      );
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

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const personMemories = useMemo(
    () => (identityId ? memoriesForPerson(memories, identityId) : []),
    [memories, identityId],
  );
  const personShelfCounts = useMemo(
    () => countShelves(personMemories),
    [personMemories],
  );
  const poemParts = useMemo(
    () => partitionPoems(personMemories.filter((m) => m.kind === "poem")),
    [personMemories],
  );
  const poemsChipLabel = useMemo(() => {
    const own = poemParts.own.length;
    const gift = poemParts.gift.length;
    if (own && gift) return `Thơ · ${own}+${gift}`;
    if (gift) return `Thơ · ${gift}`;
    if (own) return `Thơ · ${own}`;
    return "Thơ";
  }, [poemParts]);

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
      const life = filterMemories(
        personMemories.filter((m) => m.kind === "milestone"),
        {
          query,
          privateOnly,
        },
      );
      if (life.length) {
        if (shelf === "all") {
          rows.push({ type: "section", key: "life", title: PERSON_LIFE_LABEL });
        }
        for (const section of groupFamilyCalendar(life)) {
          if (shelf === "life" || shelf === "all") {
            rows.push({
              type: "section",
              key: `cal-${section.key}`,
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
      const { own, gift } = partitionPoems(poems);
      const showOwn = poemAuth !== "gift" && own.length > 0;
      const showGift = poemAuth !== "own" && gift.length > 0;
      if (showOwn || showGift) {
        // Gift first when both: album tặng is what people look for after ingest.
        if (showGift) {
          const hideGiftTitle = shelf === "poems" && poemAuth === "gift";
          if (!hideGiftTitle) {
            rows.push({
              type: "section",
              key: "poems-gift",
              title:
                shelf === "poems"
                  ? "Thơ tặng"
                  : `Thơ tặng · ${gift.length}`,
            });
          }
          for (const item of gift) {
            rows.push({ type: "memory", key: item.id, item });
          }
        }
        if (showOwn) {
          const hideOwnTitle = shelf === "poems" && poemAuth === "own";
          if (!hideOwnTitle) {
            const who = person?.display_name?.trim() || "người này";
            rows.push({
              type: "section",
              key: "poems-own",
              title:
                gift.length > 0 || poemAuth === "own" || shelf === "poems"
                  ? shelf === "poems"
                    ? `Thơ của ${who}`
                    : `Thơ của ${who} · ${own.length}`
                  : SHELF_LABELS.poems,
            });
          }
          for (const item of own) {
            rows.push({ type: "memory", key: item.id, item });
          }
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
  }, [
    filtered,
    shelf,
    privateOnly,
    personCandidates,
    query,
    poemAuth,
    person?.display_name,
    personMemories,
  ]);

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
      for (const item of memories) {
        if (!item.has_media) continue;
        try {
          if (item.kind === "photo" || (item.kind === "milestone" && item.has_media)) {
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
  }, [api, memories]);

  const defaultIdentityIds = useMemo(() => {
    if (!identityId || identityId === UNTAGGED_PERSON_ID) return [];
    return [identityId];
  }, [identityId]);

  const openTextForm = (kind: TextMemoryKind) => {
    setTextKind(kind);
    setTextTitle("");
    setTextBody("");
    setTextOccurred("");
    setTextCalendarKind("khac");
    setTextIdentityIds(defaultIdentityIds);
    setTextEditingId(null);
    setTextPhotoUri(null);
    setTextClearPhoto(false);
    setTextOpen(true);
  };

  const pickMilestonePhoto = async () => {
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.85,
    });
    if (picked.canceled || !picked.assets[0]) return;
    const asset = picked.assets[0];
    setTextPhotoUri(asset.uri);
    setTextPhotoName(asset.fileName ?? "milestone.jpg");
    setTextPhotoMime(asset.mimeType ?? "image/jpeg");
    setTextClearPhoto(false);
  };

  const openTextForEdit = (item: MemoryItem) => {
    const kind =
      item.kind === "milestone" || item.kind === "poem" || item.kind === "note"
        ? item.kind
        : "note";
    setTextKind(kind);
    setTextTitle(isGenericMemoryTitle(item.kind, item.title) ? "" : item.title);
    setTextBody(item.body ?? "");
    if (item.occurred_at) {
      const d = new Date(item.occurred_at);
      const y = d.getUTCFullYear();
      const m = String(d.getUTCMonth() + 1).padStart(2, "0");
      const day = String(d.getUTCDate()).padStart(2, "0");
      setTextOccurred(`${y}-${m}-${day}`);
    } else {
      setTextOccurred("");
    }
    setTextIdentityIds(parseHeritageIdentityIds(item.tags));
    setTextCalendarKind(parseCalendarKind(item.tags));
    setTextEditingId(item.id);
    setTextPhotoUri(photoUris[item.id] ?? null);
    setTextClearPhoto(false);
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
      const asset = await pickVideoFromPhotos();
      if (!asset) return;
      if (asset.size != null && asset.size > MAX_VIDEO_BYTES) {
        Alert.alert("File quá lớn", "Video tối đa 200 MB.");
        return;
      }
      setPendingUpload({
        kind: "video",
        uri: asset.uri,
        name: asset.name,
        mimeType: asset.mimeType,
      });
      setCaptionMode("upload");
      setCaptionKind("video");
      setCaptionTitle(titleFromFileName(asset.name));
      setCaptionBody("");
      setCaptionIdentityIds(defaultIdentityIds);
      setEditingId(null);
      setCaptionOpen(true);
    } catch (e) {
      if (e instanceof MediaPermissionError) {
        Alert.alert(
          "Máy chưa cho đọc Ảnh",
          "Video cần quyền Ảnh của máy — không liên quan tới quyền trong nhà. Mở Cài đặt → Forever → Ảnh và chọn Tất cả ảnh.",
          [
            { text: "Để sau", style: "cancel" },
            { text: "Mở Cài đặt", onPress: () => void Linking.openSettings() },
          ],
        );
        return;
      }
      Alert.alert("Không chọn được file", documentPickerErrorMessage(e));
    }
  };

  const openCaptionForEdit = (item: MemoryItem) => {
    if (
      item.kind === "milestone" ||
      item.kind === "poem" ||
      item.kind === "note" ||
      item.kind === "knowledge"
    ) {
      openTextForEdit(item);
      return;
    }
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

  const canEditItem = (item: MemoryItem) =>
    item.created_by === user?.id || canModerate;

  const saveText = async () => {
    if (!spaceId || !textBody.trim() || saving) return;
    setSaving(true);
    try {
      const yearOnly =
        textKind === "milestone" && /^\d{4}$/.test(textOccurred.trim());
      let tags = mergeMemoryTags(
        textEditingId
          ? memories.find((m) => m.id === textEditingId)?.tags ?? ""
          : "",
        textIdentityIds,
      );
      if (textKind === "milestone") {
        tags = mergeCalendarTags(tags, textCalendarKind, yearOnly);
      }
      let occurred_at: string | undefined;
      if (textKind === "milestone" && textOccurred.trim()) {
        const raw = textOccurred.trim();
        occurred_at = yearOnly ? `${raw}-01-01` : raw;
      }
      const isLocalPhoto =
        Boolean(textPhotoUri) &&
        (textPhotoUri!.startsWith("file:") ||
          textPhotoUri!.startsWith("content:") ||
          textPhotoUri!.startsWith("ph://") ||
          textPhotoUri!.startsWith("assets-library:"));

      if (textEditingId) {
        await api.updateMemory(textEditingId, {
          title: textTitle.trim() || (textKind === "milestone" ? "Ngày gia đình" : undefined),
          body: textBody.trim(),
          tags: tags || undefined,
          occurred_at: textKind === "milestone" ? occurred_at : undefined,
          clear_occurred_at:
            textKind === "milestone" && !textOccurred.trim() ? true : undefined,
          clear_media: textClearPhoto || undefined,
        });
        if (textKind === "milestone" && isLocalPhoto && !textClearPhoto) {
          await api.attachMemoryMedia(textEditingId, {
            uri: textPhotoUri!,
            name: textPhotoName,
            mimeType: textPhotoMime,
          });
        }
      } else {
        const created = await api.createNoteMemory(spaceId, {
          kind: textKind,
          title: textTitle.trim() || undefined,
          body: textBody.trim(),
          tags: tags || undefined,
          occurred_at,
        });
        if (textKind === "milestone" && isLocalPhoto) {
          await api.attachMemoryMedia(created.id, {
            uri: textPhotoUri!,
            name: textPhotoName,
            mimeType: textPhotoMime,
          });
        }
      }
      setTextOpen(false);
      setTextEditingId(null);
      setTextPhotoUri(null);
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
        {person &&
        person.status === "remembered" &&
        person.heritage_entity_status === "ready" &&
        person.heritage_thread_id ? (
          <Pressable
            onPress={() => router.push(`/call/${person.heritage_thread_id}`)}
            hitSlop={8}
          >
            <Text style={styles.callLink}>Gọi bằng giọng</Text>
          </Pressable>
        ) : null}
        {person && person.status === "remembered" ? (
          <Pressable
            onPress={() =>
              router.push(`/stories/${spaceId}/${identityId}`)
            }
            hitSlop={8}
          >
            <Text style={styles.callLink}>Nghe đọc</Text>
          </Pressable>
        ) : null}
      </View>
      <LibrarySearchBar value={query} onChange={setQuery} />
      <KindFilterChips
        value={shelf}
        onChange={(next) => {
          setShelf(next);
          if (next !== "poems") setPoemAuth("all");
        }}
        counts={personShelfCounts}
        poemsLabel={poemsChipLabel}
        lifeLabel={PERSON_LIFE_LABEL}
      />
      <View style={styles.visibilityRow}>
        <View style={styles.visibilityCopy}>
          <Text style={styles.visibilityLabel}>Chỉ mình tôi</Text>
          {privateOnly ? (
            <Text style={styles.visibilityHint}>
              Ký ức bạn giữ riêng — người khác không thấy
            </Text>
          ) : (
            <Text style={styles.visibilityHint}>Đang xem ký ức cả nhà</Text>
          )}
        </View>
        <Switch
          value={privateOnly}
          onValueChange={setPrivateOnly}
          trackColor={{ false: colors.line, true: colors.brandSoft }}
          thumbColor="#fff"
        />
      </View>
      {shelf === "poems" &&
      poemParts.own.length > 0 &&
      poemParts.gift.length > 0 ? (
        <View style={styles.poemAuthRow}>
          {(
            [
              { id: "all" as const, label: "Tất cả" },
              {
                id: "own" as const,
                label: `Của ${
                  person?.relation_label?.trim() &&
                  person.relation_label.trim().toLowerCase() !== "tôi"
                    ? person.relation_label.trim()
                    : person?.display_name?.trim() || "bố"
                }`,
              },
              { id: "gift" as const, label: "Tặng" },
            ] as const
          )
            .filter((opt) => {
              if (opt.id === "own") return poemParts.own.length > 0;
              if (opt.id === "gift") return poemParts.gift.length > 0;
              return true;
            })
            .map((opt) => {
              const on = poemAuth === opt.id;
              return (
                <Pressable
                  key={opt.id}
                  style={[styles.poemAuthChip, on && styles.poemAuthChipOn]}
                  onPress={() => setPoemAuth(opt.id)}
                >
                  <Text
                    style={[
                      styles.poemAuthChipText,
                      on && styles.poemAuthChipTextOn,
                    ]}
                  >
                    {opt.label}
                  </Text>
                </Pressable>
              );
            })}
        </View>
      ) : null}

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
              : shelf === "life"
                ? "Chưa có mốc đời neo về người này. Bấm Thêm → Ngày gia đình và chọn người."
                : "Chưa có ký ức trên kệ này. Bấm Thêm để ghi lại."}
          </Text>
        }
        renderItem={({ item: row }) => {
          if (row.type === "section") {
            return (
              <View style={styles.sectionWrap}>
                <Text style={styles.section}>{row.title}</Text>
              </View>
            );
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
                <Text style={styles.candidateSource}>
                  Đề xuất: {c.created_at ? new Date(c.created_at).toLocaleDateString("vi-VN") : "—"}
                </Text>
                {c.source_body ? (
                  <Text style={styles.candidateSource} numberOfLines={2}>
                    «{c.source_body}»
                  </Text>
                ) : null}
                {c.source_message_id && c.thread_id ? (
                  <Pressable
                    onPress={() =>
                      router.push(
                        `/chat/${c.thread_id}?messageId=${c.source_message_id}`,
                      )
                    }
                    hitSlop={6}
                  >
                    <Text style={styles.candKeepText}>Xem câu gốc →</Text>
                  </Pressable>
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
              hideHeritageChips={item.kind !== "milestone"}
              photoUri={photoUris[item.id]}
              thumbUri={thumbUris[item.id]}
              thumbLoading={thumbLoading[item.id]}
              thumbError={thumbErrors[item.id]}
              playingVoice={playingId === item.id}
              saving={saving}
              onPress={() => setReading(item)}
              canEdit={canEditItem(item)}
              onEdit={() => openCaptionForEdit(item)}
              onDelete={() => confirmDelete(item)}
              onToggleVisibility={
                item.created_by === user?.id
                  ? () => toggleVisibility(item)
                  : undefined
              }
              onPlayVoice={() => playVoice(item)}
              onPlayVideo={() => playVideo(item)}
              reciteLabel={
                item.kind === "poem" && canRecite
                  ? reciteButtonLabel(person?.relation_label)
                  : undefined
              }
              reciting={item.kind === "poem" && recite.busyId === item.id}
              playingRecite={item.kind === "poem" && recite.playingId === item.id}
              onRecite={
                item.kind === "poem" && canRecite
                  ? () =>
                      void recite.play(
                        item.id,
                        typeof identityId === "string" ? identityId : person?.id,
                      )
                  : undefined
              }
              onRetryThumb={() => {
                thumbLoadedRef.current.delete(item.id);
                loadVideoThumbRef.current(item);
              }}
              onOpenSource={
                item.source_message_id && item.source_thread_id
                  ? () =>
                      router.push(
                        `/chat/${item.source_thread_id}?messageId=${item.source_message_id}`,
                      )
                  : undefined
              }
            />
          );
        }}
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <MemoryReadModal
        item={reading}
        visible={Boolean(reading)}
        onClose={() => {
          void recite.stop();
          setReading(null);
        }}
        photoUri={reading ? photoUris[reading.id] : undefined}
        canEdit={reading ? canEditItem(reading) : false}
        canRecite={canRecite && reading?.kind === "poem"}
        reciteLabel={reciteButtonLabel(person?.relation_label)}
        reciting={Boolean(reading && recite.busyId === reading.id)}
        playingRecite={Boolean(reading && recite.playingId === reading.id)}
        onRecite={
          reading
            ? () =>
                void recite.play(
                  reading.id,
                  typeof identityId === "string" ? identityId : person?.id,
                )
            : undefined
        }
        onEdit={
          reading
            ? () => {
                const item = reading;
                setReading(null);
                openCaptionForEdit(item);
              }
            : undefined
        }
        onOpenSource={
          reading?.source_message_id && reading?.source_thread_id
            ? () => {
                const threadId = reading.source_thread_id!;
                const messageId = reading.source_message_id!;
                setReading(null);
                router.push(`/chat/${threadId}?messageId=${messageId}`);
              }
            : undefined
        }
      />

      <AddMemorySheet
        visible={addOpen}
        onClose={() => setAddOpen(false)}
        onSelect={onAddSelect}
        onIngest={
          canIngest && spaceId && identityId && identityId !== UNTAGGED_PERSON_ID
            ? () =>
                router.push(
                  `/library/${spaceId}/ingest?identityId=${identityId}`,
                )
            : undefined
        }
      />

      <TextMemoryFormModal
        visible={textOpen}
        kind={textKind}
        title={textTitle}
        body={textBody}
        occurredAt={textOccurred}
        calendarKind={textCalendarKind}
        onChangeCalendarKind={setTextCalendarKind}
        identities={identities}
        selectedIdentityIds={textIdentityIds}
        userId={user?.id}
        busy={saving}
        editing={Boolean(textEditingId)}
        photoUri={textClearPhoto ? null : textPhotoUri}
        onChangeTitle={setTextTitle}
        onChangeBody={setTextBody}
        onChangeOccurredAt={setTextOccurred}
        onToggleIdentity={(id) =>
          setTextIdentityIds((prev) =>
            prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
          )
        }
        onPickPhoto={textKind === "milestone" ? () => void pickMilestonePhoto() : undefined}
        onClearPhoto={
          textKind === "milestone"
            ? () => {
                setTextPhotoUri(null);
                setTextClearPhoto(true);
              }
            : undefined
        }
        onCancel={() => {
          setTextOpen(false);
          setTextEditingId(null);
          setTextPhotoUri(null);
        }}
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

const styles = createThemedStyles((colors) => ({
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
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 4,
  },
  callLink: { fontSize: 15, fontWeight: "700", color: colors.brand },
  addBtn: {
    backgroundColor: colors.brand,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  addBtnText: { color: "#f4efe6", fontWeight: "700" },
  visibilityRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 8,
    paddingTop: 2,
  },
  visibilityCopy: { flex: 1, gap: 2 },
  visibilityLabel: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.ink,
  },
  visibilityHint: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.inkSoft,
  },
  list: { padding: 16, paddingTop: 4, paddingBottom: 48 },
  poemAuthRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  poemAuthChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
  },
  poemAuthChipOn: {
    borderColor: colors.brand,
    backgroundColor: colors.bgDeep,
  },
  poemAuthChipText: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.inkSoft,
  },
  poemAuthChipTextOn: { color: colors.brand },
  sectionWrap: {
    marginTop: 10,
    marginBottom: 8,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
  },
  section: {
    fontFamily: fonts.display,
    fontSize: 20,
    color: colors.ink,
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
}));
