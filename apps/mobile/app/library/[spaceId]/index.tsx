import { IdentityProfile, MemoryCandidate, MemoryItem } from "@forever/api-client";
import * as ImagePicker from "expo-image-picker";
import { router, useLocalSearchParams, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
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
import { LibrarySearchBar } from "@/components/library/LibrarySearchBar";
import { PersonHubRowView } from "@/components/library/PersonHubRow";
import { TextMemoryFormModal, TextMemoryKind } from "@/components/library/TextMemoryFormModal";
import { MemoryCaptionModal } from "@/components/MemoryCaptionModal";
import { useAuth } from "@/lib/auth";
import {
  buildPersonHubRows,
  matchesSearch,
  UNTAGGED_PERSON_ID,
} from "@/lib/libraryShelves";
import { titleFromFileName } from "@/lib/memoryDisplay";
import { mergeMemoryTags, parseHeritageIdentityIds } from "@/lib/memoryTags";
import { guessVideoMime, pickVideoMemoryFile } from "@/lib/mediaPick";
import { useSpaceScreenOptions } from "@/lib/spaceHeader";
import { colors } from "@/lib/theme";

const MAX_VIDEO_BYTES = 200 * 1024 * 1024;

type PendingUpload = {
  kind: "video" | "photo";
  uri: string;
  name: string;
  mimeType: string;
};

export default function LibraryHubScreen() {
  const { spaceId } = useLocalSearchParams<{ spaceId: string }>();
  const { api, user } = useAuth();
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [identities, setIdentities] = useState<IdentityProfile[]>([]);
  const [candidates, setCandidates] = useState<MemoryCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);

  const [addOpen, setAddOpen] = useState(false);
  const [textOpen, setTextOpen] = useState(false);
  const [textKind, setTextKind] = useState<TextMemoryKind>("note");
  const [textTitle, setTextTitle] = useState("");
  const [textBody, setTextBody] = useState("");
  const [textOccurred, setTextOccurred] = useState("");
  const [textIdentityIds, setTextIdentityIds] = useState<string[]>([]);
  const [textPhotoUri, setTextPhotoUri] = useState<string | null>(null);
  const [textPhotoName, setTextPhotoName] = useState("milestone.jpg");
  const [textPhotoMime, setTextPhotoMime] = useState("image/jpeg");

  const [captionOpen, setCaptionOpen] = useState(false);
  const [captionTitle, setCaptionTitle] = useState("");
  const [captionBody, setCaptionBody] = useState("");
  const [pendingUpload, setPendingUpload] = useState<PendingUpload | null>(null);
  const [captionIdentityIds, setCaptionIdentityIds] = useState<string[]>([]);
  const [captionKind, setCaptionKind] = useState<"video" | "photo" | "voice">("photo");

  useSpaceScreenOptions({
    spaceId,
    title: "Thư viện ký ức",
    backTitle: "Nhà",
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
      setError(e instanceof Error ? e.message : "Không tải được thư viện.");
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

  const rows = useMemo(() => {
    const all = buildPersonHubRows(memories, identities, candidates, user?.id);
    if (!query.trim()) return all;
    // When searching from hub, keep people who still have a matching memory.
    return all.filter((row) => {
      if (row.identityId === UNTAGGED_PERSON_ID) {
        return memories.some(
          (m) =>
            parseHeritageIdentityIds(m.tags).length === 0 && matchesSearch(m, query),
        );
      }
      return memories.some(
        (m) =>
          parseHeritageIdentityIds(m.tags).includes(row.identityId) &&
          matchesSearch(m, query),
      );
    });
  }, [memories, identities, candidates, user?.id, query]);

  const openPerson = (identityId: string) => {
    if (!spaceId) return;
    const identity = identities.find((i) => i.id === identityId);
    if (identity?.status === "living") {
      router.push(`/people/${spaceId}/${identityId}`);
      return;
    }
    router.push(`/library/${spaceId}/person/${identityId}`);
  };

  const livingPeople = useMemo(
    () =>
      identities.filter(
        (i) => !i.archived_at && i.status === "living",
      ),
    [identities],
  );

  const openTextForm = (kind: TextMemoryKind) => {
    setTextKind(kind);
    setTextTitle("");
    setTextBody("");
    setTextOccurred("");
    setTextIdentityIds([]);
    setTextPhotoUri(null);
    setTextOpen(true);
  };

  const pickMilestonePhoto = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Cần quyền", "Cho phép truy cập ảnh để gắn vào mốc đời.");
      return;
    }
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.85,
    });
    if (picked.canceled || !picked.assets[0]) return;
    const asset = picked.assets[0];
    setTextPhotoUri(asset.uri);
    setTextPhotoName(asset.fileName ?? "milestone.jpg");
    setTextPhotoMime(asset.mimeType ?? "image/jpeg");
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
    setCaptionKind("photo");
    setCaptionTitle(titleFromFileName(asset.fileName ?? "photo.jpg"));
    setCaptionBody("");
    setCaptionIdentityIds([]);
    setCaptionOpen(true);
  };

  const pickVideo = async () => {
    if (!spaceId) return;
    try {
      const asset = await pickVideoMemoryFile();
      if (!asset) return;
      if (asset.size != null && asset.size > MAX_VIDEO_BYTES) return;
      const name = asset.name ?? "video.mts";
      setPendingUpload({
        kind: "video",
        uri: asset.uri,
        name,
        mimeType: guessVideoMime(name, asset.mimeType),
      });
      setCaptionKind("video");
      setCaptionTitle(titleFromFileName(name));
      setCaptionBody("");
      setCaptionIdentityIds([]);
      setCaptionOpen(true);
    } catch {
      // ignore
    }
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
      const created = await api.createNoteMemory(spaceId, {
        kind: textKind,
        title: textTitle.trim() || undefined,
        body: textBody.trim(),
        tags: tags || undefined,
        occurred_at,
      });
      if (textKind === "milestone" && textPhotoUri) {
        await api.attachMemoryMedia(created.id, {
          uri: textPhotoUri,
          name: textPhotoName,
          mimeType: textPhotoMime,
        });
      }
      setTextOpen(false);
      setTextPhotoUri(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không lưu được.");
    } finally {
      setSaving(false);
    }
  };

  const saveCaption = async () => {
    if (!spaceId || !pendingUpload || saving) return;
    const title = captionTitle.trim();
    if (!title) return;
    setSaving(true);
    try {
      const tags = mergeMemoryTags("", captionIdentityIds);
      await api.uploadMemory(spaceId, {
        kind: pendingUpload.kind,
        uri: pendingUpload.uri,
        name: pendingUpload.name,
        mimeType: pendingUpload.mimeType,
        title,
        body: captionBody.trim(),
        tags: tags || undefined,
      });
      setCaptionOpen(false);
      setPendingUpload(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không lưu được.");
    } finally {
      setSaving(false);
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
      <View style={styles.top}>
        <Text style={styles.lead}>
          Ký ức xếp theo người — chọn một hàng để đọc dòng đời, thơ, hiện vật.
        </Text>
        <Pressable style={styles.addBtn} onPress={() => setAddOpen(true)}>
          <Text style={styles.addBtnText}>Thêm</Text>
        </Pressable>
        <Pressable
          style={styles.ingestBtn}
          onPress={() => spaceId && router.push(`/library/${spaceId}/ingest`)}
        >
          <Text style={styles.ingestBtnText}>Nhập tài liệu</Text>
        </Pressable>
      </View>

      <LibrarySearchBar value={query} onChange={setQuery} />

      {livingPeople.length > 0 ? (
        <View style={styles.livingBlock}>
          <Text style={styles.livingLabel}>Người đang sống</Text>
          {livingPeople.map((person) => (
            <Pressable
              key={person.id}
              style={styles.livingRow}
              onPress={() => openPerson(person.id)}
            >
              <Text style={styles.livingName}>
                {person.linked_user_id === user?.id
                  ? "Tôi"
                  : person.display_name}
              </Text>
              {person.relation_label && person.relation_label !== "tôi" ? (
                <Text style={styles.livingRelation}>{person.relation_label}</Text>
              ) : null}
              <Text style={styles.livingCta}>Xem →</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <FlatList
        data={rows}
        keyExtractor={(row) => row.identityId}
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
        ListHeaderComponent={
          <Text style={styles.livingLabel}>Người được nhớ</Text>
        }
        ListEmptyComponent={
          <Text style={styles.empty}>Chưa có người hoặc ký ức trong không gian này.</Text>
        }
        renderItem={({ item }) => (
          <PersonHubRowView row={item} onPress={() => openPerson(item.identityId)} />
        )}
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

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
        photoUri={textPhotoUri}
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
          textKind === "milestone" ? () => setTextPhotoUri(null) : undefined
        }
        onCancel={() => {
          setTextOpen(false);
          setTextPhotoUri(null);
        }}
        onSave={saveText}
      />

      <MemoryCaptionModal
        visible={captionOpen}
        mode="upload"
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
        }}
        onSave={saveCaption}
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
  top: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  lead: {
    flex: 1,
    color: colors.inkSoft,
    lineHeight: 20,
    fontSize: 14,
  },
  livingBlock: {
    paddingHorizontal: 16,
    paddingTop: 8,
    gap: 8,
    marginBottom: 4,
  },
  livingLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.inkSoft,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginBottom: 4,
  },
  livingRow: {
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    paddingVertical: 12,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  livingName: {
    flex: 1,
    fontSize: 16,
    fontWeight: "700",
    color: colors.ink,
  },
  livingRelation: { fontSize: 13, color: colors.inkSoft },
  livingCta: { fontSize: 13, fontWeight: "600", color: colors.brand },
  addBtn: {
    backgroundColor: colors.brand,
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  addBtnText: { color: "#f4efe6", fontWeight: "700" },
  ingestBtn: {
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: colors.brand,
    backgroundColor: colors.card,
  },
  ingestBtnText: { color: colors.brand, fontWeight: "700", fontSize: 13 },
  list: { padding: 16, paddingTop: 8, paddingBottom: 40 },
  empty: { color: colors.inkSoft, lineHeight: 22, paddingTop: 24 },
  error: { color: colors.danger, padding: 16 },
});
