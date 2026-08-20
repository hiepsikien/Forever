import { StoryChunkSummary, StoryWorkSummary } from "@forever/api-client";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";

import { playLocalAudio, stopActivePlayback } from "@/lib/audio";
import { useAuth } from "@/lib/auth";
import { fetchAuthedMediaUri } from "@/lib/media";
import { useSpaceScreenOptions } from "@/lib/spaceHeader";
import { colors, fonts, createThemedStyles } from "@/lib/theme";

export default function StoryWorkChunksScreen() {
  const { spaceId, identityId, workSlug } = useLocalSearchParams<{
    spaceId: string;
    identityId: string;
    workSlug: string;
  }>();
  const { api } = useAuth();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [work, setWork] = useState<StoryWorkSummary | null>(null);
  const [chunks, setChunks] = useState<StoryChunkSummary[]>([]);
  const [filter, setFilter] = useState<"all" | "recorded" | "unrecorded">("all");
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importForm, setImportForm] = useState<"verse" | "prose">("prose");
  const [importing, setImporting] = useState(false);

  useSpaceScreenOptions({
    spaceId,
    title: work?.title || "Tác phẩm",
    backTitle: "Kệ",
  });

  const load = useCallback(async () => {
    if (!spaceId || !identityId || !workSlug) return;
    setLoading(true);
    try {
      const [res, spaceRes, stewardRes] = await Promise.all([
        api.listStoryChunks(spaceId, identityId, workSlug, filter),
        api.getSpace(spaceId).catch(() => null),
        api.getStewardship(spaceId).catch(() => null),
      ]);
      setWork(res.work);
      setChunks(res.chunks);
      setCanManage(
        spaceRes?.role === "owner" || Boolean(stewardRes?.is_steward),
      );
      if (res.work.category === "sutra") {
        setImportForm("prose");
      } else if (res.work.category === "classic" && res.work.chunk_count === 0) {
        // Truyện thơ Nôm chưa nhập — mặc định lục bát; đã có chữ thì giữ lựa chọn.
        setImportForm((prev) => prev);
      } else if (
        ["kieu", "luc_van_tien"].includes(res.work.slug) ||
        res.work.category === "classic"
      ) {
        setImportForm("verse");
      }
    } catch (e) {
      Alert.alert("Lỗi", e instanceof Error ? e.message : "Không tải đoạn.");
    } finally {
      setLoading(false);
    }
  }, [api, filter, identityId, spaceId, workSlug]);

  useEffect(() => {
    void load();
    return () => {
      void stopActivePlayback();
    };
  }, [load]);

  const play = async (chunk: StoryChunkSummary) => {
    if (!chunk.recording_id) return;
    try {
      if (playingId === chunk.recording_id) {
        await stopActivePlayback();
        setPlayingId(null);
        return;
      }
      const uri = await fetchAuthedMediaUri(
        api.storyRecordingMediaUrl(chunk.recording_id),
        chunk.recording_id,
        "audio/mp4",
      );
      setPlayingId(chunk.recording_id);
      await playLocalAudio(uri, () => setPlayingId(null));
    } catch (e) {
      setPlayingId(null);
      Alert.alert("Lỗi", e instanceof Error ? e.message : "Không phát được.");
    }
  };

  const submitImport = async () => {
    if (!spaceId || !workSlug || importing) return;
    const text = importText.trim();
    if (text.length < 40) {
      Alert.alert("Thiếu chữ", "Dán ít nhất vài đoạn để cắt thành bài đọc.");
      return;
    }
    const run = async () => {
      setImporting(true);
      try {
        const res = await api.importStoryWorkText(spaceId, workSlug, {
          text,
          form: importForm,
        });
        setImportOpen(false);
        setImportText("");
        Alert.alert("Đã nhập", `${res.chunk_count} đoạn sẵn sàng để thu.`);
        await load();
      } catch (e) {
        Alert.alert("Lỗi", e instanceof Error ? e.message : "Không nhập được.");
      } finally {
        setImporting(false);
      }
    };
    if ((work?.chunk_count ?? 0) > 0) {
      Alert.alert(
        "Thay chữ hiện có?",
        "Sẽ xoá mọi đoạn và bản ghi âm gắn với tác phẩm này.",
        [
          { text: "Thôi", style: "cancel" },
          { text: "Thay", style: "destructive", onPress: () => void run() },
        ],
      );
      return;
    }
    await run();
  };

  const emptyNeedsText = !loading && chunks.length === 0 && (work?.chunk_count ?? 0) === 0;

  return (
    <View style={styles.root}>
      <View style={styles.filters}>
        {(
          [
            ["all", "Tất cả"],
            ["recorded", "Đã ghi"],
            ["unrecorded", "Chưa ghi"],
          ] as const
        ).map(([id, label]) => (
          <Pressable
            key={id}
            style={[styles.chip, filter === id && styles.chipOn]}
            onPress={() => setFilter(id)}
          >
            <Text style={[styles.chipText, filter === id && styles.chipTextOn]}>
              {label}
            </Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.actions}>
        <Pressable
          style={styles.link}
          disabled={(work?.chunk_count ?? 0) === 0}
          onPress={() =>
            router.push(
              `/stories/${spaceId}/${identityId}/record?work=${workSlug}`,
            )
          }
        >
          <Text
            style={[
              styles.linkText,
              (work?.chunk_count ?? 0) === 0 && styles.linkMuted,
            ]}
          >
            Thu đoạn chưa ghi
          </Text>
        </Pressable>
        <Pressable
          style={styles.link}
          onPress={() =>
            router.push(
              `/stories/${spaceId}/${identityId}/listen?work=${workSlug}`,
            )
          }
        >
          <Text style={styles.linkText}>Nghe ngẫu nhiên</Text>
        </Pressable>
      </View>
      {canManage ? (
        <Pressable style={styles.importBtn} onPress={() => setImportOpen(true)}>
          <Text style={styles.importBtnText}>
            {(work?.chunk_count ?? 0) === 0 ? "Nhập chữ để thu" : "Thay chữ"}
          </Text>
        </Pressable>
      ) : null}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.brand} />
        </View>
      ) : (
        <FlatList
          data={chunks}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <Text style={styles.empty}>
              {emptyNeedsText
                ? "Chưa có chữ trong kho. Steward dán bản quốc ngữ từ sách nhà (thơ hoặc kể) để cắt thành đoạn đọc."
                : "Không có đoạn trong bộ lọc này."}
            </Text>
          }
          renderItem={({ item }) => (
            <View style={styles.row}>
              <View style={styles.rowText}>
                <Text style={styles.rowTitle}>{item.label}</Text>
                <Text style={styles.rowMeta}>
                  {item.recorded
                    ? "Đã ghi · chạm để nghe"
                    : `Chưa ghi · ~${item.approx_seconds}s`}
                </Text>
              </View>
              {item.recorded ? (
                <Pressable onPress={() => play(item)} hitSlop={8}>
                  <Text style={styles.play}>
                    {playingId === item.recording_id ? "Dừng" : "Nghe"}
                  </Text>
                </Pressable>
              ) : (
                <Pressable
                  onPress={() =>
                    router.push(
                      `/stories/${spaceId}/${identityId}/record?work=${workSlug}`,
                    )
                  }
                  hitSlop={8}
                >
                  <Text style={styles.play}>Thu</Text>
                </Pressable>
              )}
            </View>
          )}
        />
      )}

      <Modal
        visible={importOpen}
        animationType="slide"
        onRequestClose={() => setImportOpen(false)}
      >
        <View style={styles.modalRoot}>
          <Text style={styles.modalTitle}>Nhập chữ — {work?.title}</Text>
          <Text style={styles.modalHint}>
            Dán toàn văn quốc ngữ. Chọn thể: thơ lục bát (mỗi dòng một câu) hoặc
            văn xuôi kể chuyện.
          </Text>
          <View style={styles.formRow}>
            {(
              [
                ["verse", "Thơ / lục bát"],
                ["prose", "Văn xuôi"],
              ] as const
            ).map(([id, label]) => (
              <Pressable
                key={id}
                style={[styles.chip, importForm === id && styles.chipOn]}
                onPress={() => setImportForm(id)}
              >
                <Text
                  style={[
                    styles.chipText,
                    importForm === id && styles.chipTextOn,
                  ]}
                >
                  {label}
                </Text>
              </Pressable>
            ))}
          </View>
          <TextInput
            style={styles.input}
            multiline
            textAlignVertical="top"
            placeholder="Dán chữ vào đây…"
            placeholderTextColor={colors.muted}
            value={importText}
            onChangeText={setImportText}
          />
          <View style={styles.modalActions}>
            <Pressable
              style={styles.secondaryBtn}
              onPress={() => setImportOpen(false)}
            >
              <Text style={styles.secondaryBtnText}>Huỷ</Text>
            </Pressable>
            <Pressable
              style={styles.primaryBtn}
              disabled={importing}
              onPress={() => void submitImport()}
            >
              {importing ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryBtnText}>Cắt đoạn</Text>
              )}
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = createThemedStyles(() => ({
  root: { flex: 1, backgroundColor: colors.bg },
  filters: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.line,
  },
  chipOn: {
    backgroundColor: colors.brandSoft,
    borderColor: colors.brandSoft,
  },
  chipText: {
    fontFamily: fonts.sans,
    fontSize: 13,
    color: colors.muted,
  },
  chipTextOn: { color: colors.brand, fontFamily: fonts.sansSemi },
  actions: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  link: { paddingVertical: 4 },
  linkText: {
    fontFamily: fonts.sansSemi,
    fontSize: 14,
    color: colors.brand,
  },
  linkMuted: { opacity: 0.35 },
  importBtn: {
    marginHorizontal: 16,
    marginBottom: 8,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: "center",
    backgroundColor: colors.brandSoft,
  },
  importBtnText: {
    fontFamily: fonts.sansSemi,
    fontSize: 14,
    color: colors.brand,
  },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  list: { paddingHorizontal: 16, paddingBottom: 40 },
  empty: {
    fontFamily: fonts.sans,
    fontSize: 14,
    lineHeight: 22,
    color: colors.muted,
    padding: 24,
    textAlign: "center",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    gap: 12,
  },
  rowText: { flex: 1 },
  rowTitle: {
    fontFamily: fonts.sansSemi,
    fontSize: 15,
    color: colors.ink,
  },
  rowMeta: {
    fontFamily: fonts.sans,
    fontSize: 13,
    color: colors.muted,
    marginTop: 2,
  },
  play: {
    fontFamily: fonts.sansSemi,
    fontSize: 14,
    color: colors.brand,
  },
  modalRoot: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingTop: 56,
    paddingHorizontal: 16,
    paddingBottom: 24,
    gap: 10,
  },
  modalTitle: {
    fontFamily: fonts.serif,
    fontSize: 22,
    color: colors.ink,
  },
  modalHint: {
    fontFamily: fonts.sans,
    fontSize: 14,
    lineHeight: 20,
    color: colors.muted,
  },
  formRow: { flexDirection: "row", gap: 8 },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    padding: 12,
    fontFamily: fonts.serif,
    fontSize: 16,
    lineHeight: 24,
    color: colors.ink,
  },
  modalActions: { flexDirection: "row", gap: 10 },
  primaryBtn: {
    flex: 1,
    backgroundColor: colors.brand,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  primaryBtnText: {
    fontFamily: fonts.sansSemi,
    color: "#fff",
    fontSize: 16,
  },
  secondaryBtn: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 18,
    alignItems: "center",
  },
  secondaryBtnText: {
    fontFamily: fonts.sansSemi,
    color: colors.ink,
    fontSize: 16,
  },
}));
