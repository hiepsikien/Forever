import { ExtractJob, ExtractSegment } from "@forever/api-client";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { playLocalAudio, stopActivePlayback } from "@/lib/audio";
import { useAuth } from "@/lib/auth";
import { fetchAuthedMediaUri } from "@/lib/media";
import { colors, fonts } from "@/lib/theme";

function statusLabel(status: string): string {
  switch (status) {
    case "queued":
      return "Đang chờ worker…";
    case "running":
      return "Đang tách giọng…";
    case "needs_review":
      return "Sẵn sàng duyệt";
    case "failed":
      return "Lỗi";
    case "done":
      return "Hoàn tất";
    default:
      return status;
  }
}

export default function ExtractJobScreen() {
  const { spaceId, jobId, voiceId } = useLocalSearchParams<{
    spaceId: string;
    jobId: string;
    voiceId?: string;
  }>();
  const { api } = useAuth();
  const navigation = useNavigation();
  const router = useRouter();

  const [job, setJob] = useState<ExtractJob | null>(null);
  const [segments, setSegments] = useState<ExtractSegment[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [selectedSpeaker, setSelectedSpeaker] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [playingId, setPlayingId] = useState<string | null>(null);
  const statusRef = useRef<string | null>(null);

  useLayoutEffect(() => {
    navigation.setOptions({ title: "Duyệt đoạn tách" });
  }, [navigation]);

  useEffect(() => {
    return () => {
      void stopActivePlayback();
    };
  }, []);

  const load = useCallback(async () => {
    if (!spaceId || !jobId) return;
    try {
      const j = await api.getExtractJob(spaceId, jobId);
      statusRef.current = j.status;
      setJob(j);
      setSelectedSpeaker((prev) => prev ?? j.assigned_speaker_label ?? null);
      if (j.status === "needs_review" || j.status === "done") {
        const res = await api.listExtractSegments(spaceId, jobId, {
          quality: "all",
        });
        setSegments(res.segments);
        setSelectedSpeaker((prev) => {
          if (prev) return prev;
          const first = res.segments.find((s) => s.quality === "clean");
          return first?.speaker_label ?? null;
        });
      }
    } catch (e) {
      Alert.alert(
        "Lỗi",
        e instanceof Error ? e.message : "Không tải được job Extract.",
      );
    } finally {
      setLoading(false);
    }
  }, [api, jobId, spaceId]);

  useFocusEffect(
    useCallback(() => {
      void load();
      const t = setInterval(() => {
        const st = statusRef.current;
        if (st === "queued" || st === "running" || st == null) {
          void load();
        }
      }, 3000);
      return () => clearInterval(t);
    }, [load]),
  );

  const speakers = useMemo(() => {
    const map = new Map<string, { clean: number; totalMs: number }>();
    for (const s of segments) {
      const cur = map.get(s.speaker_label) || { clean: 0, totalMs: 0 };
      if (s.quality === "clean") {
        cur.clean += 1;
        cur.totalMs += s.duration_ms || 0;
      }
      map.set(s.speaker_label, cur);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [segments]);

  const visible = useMemo(() => {
    return segments.filter(
      (s) =>
        s.quality === "clean" &&
        (!selectedSpeaker || s.speaker_label === selectedSpeaker),
    );
  }, [segments, selectedSpeaker]);

  const totalSelectedSec = useMemo(() => {
    let ms = 0;
    for (const s of visible) {
      if (selectedIds.has(s.id)) ms += s.duration_ms || 0;
    }
    return Math.round(ms / 100) / 10;
  }, [selectedIds, visible]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllPending = () => {
    setSelectedIds(
      new Set(
        visible.filter((s) => s.review_status === "pending").map((s) => s.id),
      ),
    );
  };

  const play = async (seg: ExtractSegment) => {
    if (!spaceId) return;
    if (playingId === seg.id) {
      await stopActivePlayback();
      setPlayingId(null);
      return;
    }
    try {
      const url = api.extractSegmentMediaUrl(spaceId, seg.id);
      const uri = await fetchAuthedMediaUri(
        url,
        `extract-seg-${seg.id}`,
        "audio/wav",
      );
      setPlayingId(seg.id);
      await playLocalAudio(uri, () => setPlayingId(null));
    } catch (e) {
      setPlayingId(null);
      Alert.alert(
        "Không phát được",
        e instanceof Error ? e.message : "Lỗi audio.",
      );
    }
  };

  const assignAndImport = async () => {
    if (!spaceId || !jobId || !selectedSpeaker) {
      Alert.alert("Chọn speaker", "Chọn SPEAKER đúng người cần giữ.");
      return;
    }
    const ids = [...selectedIds];
    if (!ids.length) {
      Alert.alert(
        "Chưa chọn đoạn",
        "Tick các đoạn clean muốn đưa vào Voice DNA.",
      );
      return;
    }
    setBusy(true);
    try {
      await api.assignExtractSpeaker(spaceId, jobId, selectedSpeaker);
      const res = await api.acceptExtractSegments(spaceId, jobId, {
        segmentIds: ids,
      });
      await load();
      setSelectedIds(new Set());
      Alert.alert(
        "Đã import",
        `${res.imported} đoạn (~${res.total_clean_seconds}s) vào Voice DNA.\nNghe lại ở Mẫu đã ghi, rồi Clone khi đủ.`,
        [
          {
            text: "Xem mẫu",
            onPress: () =>
              router.push(
                `/voice/${spaceId}/samples?voiceId=${voiceId || job?.voice_profile_id}` as never,
              ),
          },
          { text: "Tiếp tục duyệt", style: "cancel" },
        ],
      );
    } catch (e) {
      Alert.alert(
        "Lỗi",
        e instanceof Error ? e.message : "Không import được segment.",
      );
    } finally {
      setBusy(false);
    }
  };

  if (loading && !job) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }

  if (!job) {
    return (
      <View style={styles.center}>
        <Text style={styles.body}>Không tìm thấy job.</Text>
      </View>
    );
  }

  const reviewing = job.status === "needs_review" || job.status === "done";

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.root}>
      <Text style={styles.title}>{statusLabel(job.status)}</Text>
      <Text style={styles.meta}>
        {job.original_filename || "Băng ghi"} · {job.num_speakers} người
        {job.clean_segment_count != null
          ? ` · ${job.clean_segment_count} đoạn clean`
          : ""}
      </Text>
      {job.status === "queued" || job.status === "running" ? (
        <View style={styles.info}>
          <ActivityIndicator color={colors.brand} />
          <Text style={styles.body}>
            Worker local đang chạy pipeline exclusive-only. Giữ màn này hoặc quay
            lại sau.
          </Text>
        </View>
      ) : null}
      {job.status === "failed" ? (
        <Text style={styles.error}>{job.error_message || "Job thất bại."}</Text>
      ) : null}

      {reviewing ? (
        <>
          <Text style={styles.kicker}>Chọn đúng người</Text>
          <Text style={styles.body}>
            Nghe vài đoạn mỗi SPEAKER. Chọn người cần (vd. bố), tick đoạn sạch,
            rồi import vào Voice DNA.
          </Text>
          <View style={styles.chips}>
            {speakers.map(([label, info]) => {
              const active = selectedSpeaker === label;
              const sec = Math.round(info.totalMs / 100) / 10;
              return (
                <Pressable
                  key={label}
                  style={[styles.chip, active && styles.chipActive]}
                  onPress={() => {
                    setSelectedSpeaker(label);
                    setSelectedIds(new Set());
                  }}
                >
                  <Text
                    style={[styles.chipText, active && styles.chipTextActive]}
                  >
                    {label}
                  </Text>
                  <Text
                    style={[styles.chipSub, active && styles.chipTextActive]}
                  >
                    {info.clean} clean · {sec}s
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.row}>
            <Pressable onPress={selectAllPending} hitSlop={8}>
              <Text style={styles.link}>Chọn hết clean đang chờ</Text>
            </Pressable>
            <Text style={styles.meta}>
              Đã chọn {selectedIds.size}
              {totalSelectedSec ? ` · ~${totalSelectedSec}s` : ""}
            </Text>
          </View>

          <View style={styles.list}>
            {visible.map((seg) => {
              const on = selectedIds.has(seg.id);
              const accepted = seg.review_status === "accepted";
              return (
                <View
                  key={seg.id}
                  style={[styles.item, accepted && styles.itemDone]}
                >
                  <Pressable
                    style={styles.itemMain}
                    onPress={() => !accepted && toggleSelect(seg.id)}
                    disabled={accepted}
                  >
                    <Text style={styles.check}>
                      {accepted ? "✓" : on ? "☑" : "☐"}
                    </Text>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.itemTitle}>
                        {seg.duration_label || `${seg.duration_ms}ms`} ·{" "}
                        {seg.t_start.toFixed(1)}–{seg.t_end.toFixed(1)}s
                      </Text>
                      <Text style={styles.itemSub}>
                        {seg.quality}
                        {seg.purity != null ? ` · purity ${seg.purity}` : ""}
                        {accepted ? " · đã import" : ""}
                      </Text>
                    </View>
                  </Pressable>
                  <Pressable
                    style={styles.playBtn}
                    onPress={() => play(seg)}
                    hitSlop={8}
                  >
                    <Text style={styles.playText}>
                      {playingId === seg.id ? "Dừng" : "Nghe"}
                    </Text>
                  </Pressable>
                </View>
              );
            })}
            {!visible.length ? (
              <Text style={styles.body}>
                Chưa có đoạn clean cho speaker này. Thử băng khác hoặc nới
                min_duration.
              </Text>
            ) : null}
          </View>

          <Pressable
            style={[
              styles.btn,
              (busy || !selectedIds.size) && styles.disabled,
            ]}
            onPress={assignAndImport}
            disabled={busy || !selectedIds.size}
          >
            <Text style={styles.btnText}>
              Import vào Voice DNA ({selectedIds.size})
            </Text>
          </Pressable>

          {job.status === "needs_review" ? (
            <Pressable
              style={styles.btnGhost}
              disabled={busy}
              onPress={async () => {
                setBusy(true);
                try {
                  await api.finishExtractJob(spaceId!, jobId!);
                  await load();
                } catch (e) {
                  Alert.alert(
                    "Lỗi",
                    e instanceof Error ? e.message : "Không kết thúc job.",
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Text style={styles.btnGhostText}>Đánh dấu xong job</Text>
            </Pressable>
          ) : null}
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  root: { padding: 20, gap: 12, paddingBottom: 48 },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bg,
  },
  title: { fontFamily: fonts.display, fontSize: 24, color: colors.ink },
  meta: { fontSize: 13, color: colors.inkSoft },
  body: { fontSize: 15, lineHeight: 22, color: colors.inkSoft },
  error: { color: colors.danger, fontSize: 15, lineHeight: 22 },
  info: {
    flexDirection: "row",
    gap: 12,
    alignItems: "center",
    padding: 14,
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
  },
  kicker: {
    marginTop: 8,
    fontSize: 12,
    fontWeight: "700",
    color: colors.inkSoft,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minWidth: 110,
  },
  chipActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipText: { fontWeight: "700", color: colors.ink },
  chipSub: { fontSize: 12, color: colors.inkSoft, marginTop: 2 },
  chipTextActive: { color: "#fff" },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  link: { color: colors.brand, fontWeight: "700" },
  list: { gap: 8 },
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
  },
  itemDone: { opacity: 0.65 },
  itemMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10 },
  check: { fontSize: 18, color: colors.brand, width: 22 },
  itemTitle: { fontSize: 15, fontWeight: "600", color: colors.ink },
  itemSub: { fontSize: 12, color: colors.inkSoft, marginTop: 2 },
  playBtn: { paddingHorizontal: 10, paddingVertical: 6 },
  playText: { color: colors.brand, fontWeight: "700" },
  btn: {
    backgroundColor: colors.brand,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 4,
  },
  btnText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  btnGhost: {
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.line,
  },
  btnGhostText: { color: colors.inkSoft, fontWeight: "600" },
  disabled: { opacity: 0.45 },
});
