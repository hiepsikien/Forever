import { ExtractJob, ExtractSegment, VoiceProfile } from "@forever/api-client";
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
  TextInput,
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
      return "Pool sẵn sàng duyệt";
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
  const [voices, setVoices] = useState<VoiceProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [selectedSpeaker, setSelectedSpeaker] = useState<string | null>(null);
  const [targetVoiceId, setTargetVoiceId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newRelation, setNewRelation] = useState("");
  const [newStatus, setNewStatus] = useState<"living" | "remembered">(
    "remembered",
  );
  const statusRef = useRef<string | null>(null);

  useLayoutEffect(() => {
    navigation.setOptions({ title: "Pool tách giọng" });
  }, [navigation]);

  useEffect(() => {
    return () => {
      void stopActivePlayback();
    };
  }, []);

  const load = useCallback(async () => {
    if (!spaceId || !jobId) return;
    try {
      const [j, v] = await Promise.all([
        api.getExtractJob(spaceId, jobId),
        api.listVoices(spaceId),
      ]);
      statusRef.current = j.status;
      setJob(j);
      setVoices(v.voices);
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

  // When speaker changes, prefer existing assignment / hub voiceId.
  useEffect(() => {
    if (!selectedSpeaker || !job) return;
    const mapped = job.speaker_assignments?.[selectedSpeaker];
    if (mapped) {
      setTargetVoiceId(mapped);
      return;
    }
    if (voiceId) setTargetVoiceId(voiceId);
  }, [job, selectedSpeaker, voiceId]);

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
    return [...map.entries()].sort((a, b) => b[1].totalMs - a[1].totalMs);
  }, [segments]);

  const visible = useMemo(() => {
    return segments
      .filter(
        (s) =>
          s.quality === "clean" &&
          (!selectedSpeaker || s.speaker_label === selectedSpeaker),
      )
      .sort((a, b) => (b.duration_ms || 0) - (a.duration_ms || 0));
  }, [segments, selectedSpeaker]);

  const totalSelectedSec = useMemo(() => {
    let ms = 0;
    for (const s of visible) {
      if (selectedIds.has(s.id)) ms += s.duration_ms || 0;
    }
    return Math.round(ms / 100) / 10;
  }, [selectedIds, visible]);

  const assignedLabel = useMemo(() => {
    if (!selectedSpeaker || !job?.speaker_assignments) return null;
    const vid = job.speaker_assignments[selectedSpeaker];
    if (!vid) return null;
    return voices.find((v) => v.id === vid)?.display_name ?? vid;
  }, [job, selectedSpeaker, voices]);

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

  const importSelected = async (opts?: {
    voiceProfileId?: string;
    createIdentity?: {
      display_name: string;
      relation_label?: string;
      status?: "living" | "remembered";
      consent?: boolean;
    };
  }) => {
    if (!spaceId || !jobId || !selectedSpeaker) {
      Alert.alert("Chọn speaker", "Chọn SPEAKER cần giữ.");
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
    const voiceProfileId = opts?.voiceProfileId ?? targetVoiceId ?? undefined;
    if (!voiceProfileId && !opts?.createIdentity) {
      Alert.alert(
        "Chọn hồ sơ đích",
        "Chọn Voice DNA có sẵn hoặc tạo hồ sơ mới.",
      );
      return;
    }
    setBusy(true);
    try {
      if (voiceProfileId && !opts?.createIdentity) {
        await api.assignExtractSpeaker(spaceId, jobId, {
          speakerLabel: selectedSpeaker,
          voiceProfileId,
        });
      }
      const res = await api.acceptExtractSegments(spaceId, jobId, {
        segmentIds: ids,
        speakerLabel: selectedSpeaker,
        voiceProfileId,
        createIdentity: opts?.createIdentity,
      });
      await load();
      setSelectedIds(new Set());
      setShowCreate(false);
      setTargetVoiceId(res.voice_profile_id);
      Alert.alert(
        "Đã import vào pool → Voice DNA",
        `${res.imported} đoạn (~${res.total_clean_seconds}s) → ${res.voice_display_name}.\nCó thể chọn SPEAKER khác và import tiếp.`,
        [
          {
            text: "Xem mẫu",
            onPress: () =>
              router.push(
                `/voice/${spaceId}/samples?voiceId=${res.voice_profile_id}` as never,
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

  const createAndImport = async () => {
    if (!newName.trim()) {
      Alert.alert("Thiếu tên", "Nhập tên người cần giữ.");
      return;
    }
    await importSelected({
      createIdentity: {
        display_name: newName.trim(),
        relation_label: newRelation.trim(),
        status: newStatus,
        consent: true,
      },
    });
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
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.root}
      keyboardShouldPersistTaps="handled"
    >
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
            Worker đang đổ vào pool chung. Sau đó bạn gán từng SPEAKER sang các
            Voice DNA riêng.
          </Text>
        </View>
      ) : null}
      {job.status === "failed" ? (
        <Text style={styles.error}>{job.error_message || "Job thất bại."}</Text>
      ) : null}

      {reviewing ? (
        <>
          <Text style={styles.kicker}>1. Chọn SPEAKER (dài → ngắn)</Text>
          <Text style={styles.body}>
            Nghe để biết ai. Không quan tâm → bỏ. Quan tâm → chọn hồ sơ đích rồi
            import.
          </Text>
          <View style={styles.chips}>
            {speakers.map(([label, info]) => {
              const active = selectedSpeaker === label;
              const sec = Math.round(info.totalMs / 100) / 10;
              const mapped = job.speaker_assignments?.[label];
              const mappedName = mapped
                ? voices.find((v) => v.id === mapped)?.display_name
                : null;
              return (
                <Pressable
                  key={label}
                  style={[styles.chip, active && styles.chipActive]}
                  onPress={() => {
                    setSelectedSpeaker(label);
                    setSelectedIds(new Set());
                    setShowCreate(false);
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
                    {mappedName ? ` → ${mappedName}` : ""}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.kicker}>2. Hồ sơ đích (Voice DNA)</Text>
          {assignedLabel ? (
            <Text style={styles.meta}>
              SPEAKER này đã gán: {assignedLabel}
            </Text>
          ) : null}
          <View style={styles.chips}>
            {voices.map((v) => {
              const active = targetVoiceId === v.id && !showCreate;
              return (
                <Pressable
                  key={v.id}
                  style={[styles.chip, active && styles.chipActive]}
                  onPress={() => {
                    setTargetVoiceId(v.id);
                    setShowCreate(false);
                  }}
                >
                  <Text
                    style={[styles.chipText, active && styles.chipTextActive]}
                  >
                    {v.display_name || v.id}
                  </Text>
                </Pressable>
              );
            })}
            <Pressable
              style={[styles.chip, showCreate && styles.chipActive]}
              onPress={() => {
                setShowCreate(true);
                setTargetVoiceId(null);
              }}
            >
              <Text
                style={[styles.chipText, showCreate && styles.chipTextActive]}
              >
                + Tạo hồ sơ
              </Text>
            </Pressable>
          </View>

          {showCreate ? (
            <View style={styles.createBox}>
              <TextInput
                style={styles.input}
                value={newName}
                onChangeText={setNewName}
                placeholder="Tên (vd. Hùng)"
                placeholderTextColor={colors.inkSoft}
              />
              <TextInput
                style={styles.input}
                value={newRelation}
                onChangeText={setNewRelation}
                placeholder="Quan hệ (vd. Bố)"
                placeholderTextColor={colors.inkSoft}
              />
              <View style={styles.chips}>
                <Pressable
                  style={[
                    styles.chip,
                    newStatus === "living" && styles.chipActive,
                  ]}
                  onPress={() => setNewStatus("living")}
                >
                  <Text
                    style={[
                      styles.chipText,
                      newStatus === "living" && styles.chipTextActive,
                    ]}
                  >
                    Đang sống
                  </Text>
                </Pressable>
                <Pressable
                  style={[
                    styles.chip,
                    newStatus === "remembered" && styles.chipActive,
                  ]}
                  onPress={() => setNewStatus("remembered")}
                >
                  <Text
                    style={[
                      styles.chipText,
                      newStatus === "remembered" && styles.chipTextActive,
                    ]}
                  >
                    Ký ức
                  </Text>
                </Pressable>
              </View>
            </View>
          ) : null}

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
                Chưa có đoạn clean cho speaker này.
              </Text>
            ) : null}
          </View>

          <Pressable
            style={[
              styles.btn,
              (busy || !selectedIds.size || (!targetVoiceId && !showCreate)) &&
                styles.disabled,
            ]}
            onPress={() =>
              showCreate ? createAndImport() : importSelected()
            }
            disabled={
              busy || !selectedIds.size || (!targetVoiceId && !showCreate)
            }
          >
            <Text style={styles.btnText}>
              {showCreate
                ? `Tạo hồ sơ & import (${selectedIds.size})`
                : `Import vào Voice DNA (${selectedIds.size})`}
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
              <Text style={styles.btnGhostText}>Đánh dấu xong pool</Text>
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
    minWidth: 100,
  },
  chipActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipText: { fontWeight: "700", color: colors.ink },
  chipSub: { fontSize: 12, color: colors.inkSoft, marginTop: 2 },
  chipTextActive: { color: "#fff" },
  createBox: { gap: 8 },
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
