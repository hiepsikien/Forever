import { ExtractJob, ExtractSegment, IdentityProfile, VoiceProfile } from "@forever/api-client";
import { useFocusEffect } from "@react-navigation/native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { useSpaceScreenOptions } from "@/lib/spaceHeader";
import { colors, fonts } from "@/lib/theme";

function identityChipLabel(
  ident: IdentityProfile,
  userId?: string | null,
): string {
  if (ident.linked_user_id && ident.linked_user_id === userId) return "Tôi";
  if (ident.relation_label) {
    return `${ident.display_name} · ${ident.relation_label}`;
  }
  return ident.display_name;
}

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
  const { api, user } = useAuth();
  const router = useRouter();

  const [job, setJob] = useState<ExtractJob | null>(null);
  const [segments, setSegments] = useState<ExtractSegment[]>([]);
  const [voices, setVoices] = useState<VoiceProfile[]>([]);
  const [identities, setIdentities] = useState<IdentityProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [selectedSpeaker, setSelectedSpeaker] = useState<string | null>(null);
  const [targetVoiceId, setTargetVoiceId] = useState<string | null>(null);
  const [targetIdentityId, setTargetIdentityId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newRelation, setNewRelation] = useState("");
  const [newStatus, setNewStatus] = useState<"living" | "remembered">(
    "remembered",
  );
  const statusRef = useRef<string | null>(null);
  const loadGen = useRef(0);
  const hasLoadedRef = useRef(false);
  const userPickedTargetRef = useRef(false);
  const mediaCacheRef = useRef<Map<string, string>>(new Map());
  const playLockRef = useRef(false);
  const [playBusyId, setPlayBusyId] = useState<string | null>(null);

  useSpaceScreenOptions({
    spaceId,
    title: "Pool tách giọng",
    backTitle: "Nhà",
  });

  useEffect(() => {
    return () => {
      void stopActivePlayback();
    };
  }, []);

  const applySegments = useCallback((segList: ExtractSegment[]) => {
    setSegments(segList);
    setSelectedSpeaker((prev) => {
      if (prev && segList.some((s) => s.speaker_label === prev)) return prev;
      const first = segList.find((s) => s.quality === "clean");
      return first?.speaker_label ?? null;
    });
  }, []);

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!spaceId || !jobId) return;
    const silent = opts?.silent === true;
    const gen = ++loadGen.current;
    if (!silent) setLoading(true);
    try {
      const [j, v, i] = await Promise.all([
        api.getExtractJob(spaceId, jobId),
        api.listVoices(spaceId),
        api.listIdentities(spaceId),
      ]);

      let segList: ExtractSegment[] = [];
      if (j.status === "needs_review" || j.status === "done") {
        if (j.segments?.length) {
          segList = j.segments;
        } else {
          const res = await api.listExtractSegments(spaceId, jobId, {
            quality: "all",
          });
          segList = res.segments;
        }
      }

      // Commit together — avoid job metadata without segment rows (race).
      if (gen !== loadGen.current) return;
      statusRef.current = j.status;
      setJob(j);
      setVoices(v.voices);
      setIdentities(i.identities);
      if (segList.length) {
        applySegments(segList);
      } else {
        setSegments([]);
      }
      hasLoadedRef.current = true;
    } catch (e) {
      if (gen === loadGen.current) {
        Alert.alert(
          "Lỗi",
          e instanceof Error ? e.message : "Không tải được job Extract.",
        );
      }
    } finally {
      if (gen === loadGen.current) {
        setLoading(false);
      }
    }
  }, [api, applySegments, jobId, spaceId]);

  useFocusEffect(
    useCallback(() => {
      void load({ silent: hasLoadedRef.current });
      const t = setInterval(() => {
        const st = statusRef.current;
        if (st === "queued" || st === "running" || st == null) {
          void load({ silent: true });
        }
      }, 3000);
      return () => clearInterval(t);
    }, [load]),
  );

  // Default target voice when speaker changes — don't override manual picks.
  useEffect(() => {
    if (!selectedSpeaker || !job) return;
    const mapped = job.speaker_assignments?.[selectedSpeaker];
    if (mapped) {
      setTargetVoiceId(mapped);
      const ident = identities.find((x) => x.voice_profile_id === mapped);
      setTargetIdentityId(ident?.id ?? null);
      userPickedTargetRef.current = true;
      return;
    }
    if (userPickedTargetRef.current) return;
    if (voiceId) {
      setTargetVoiceId(voiceId);
      const ident = identities.find((x) => x.voice_profile_id === voiceId);
      setTargetIdentityId(ident?.id ?? null);
    }
  }, [identities, job, selectedSpeaker, voiceId]);

  const canImport =
    Boolean(selectedSpeaker) &&
    selectedIds.size > 0 &&
    Boolean(targetVoiceId || targetIdentityId);

  const displayNameForVoiceId = useCallback(
    (voiceIdValue: string | null | undefined) => {
      if (!voiceIdValue) return null;
      const ident = identities.find((x) => x.voice_profile_id === voiceIdValue);
      if (ident) return identityChipLabel(ident, user?.id);
      return voices.find((v) => v.id === voiceIdValue)?.display_name ?? voiceIdValue;
    },
    [identities, user?.id, voices],
  );

  const resolveTargetVoiceId = async (): Promise<string | undefined> => {
    if (targetVoiceId) return targetVoiceId;
    if (!targetIdentityId || !spaceId) return undefined;
    const ident = identities.find((x) => x.id === targetIdentityId);
    if (!ident) return undefined;
    if (ident.voice_profile_id) {
      setTargetVoiceId(ident.voice_profile_id);
      return ident.voice_profile_id;
    }
    const voice = await api.createVoiceForIdentity(
      spaceId,
      targetIdentityId,
      true,
    );
    setTargetVoiceId(voice.id);
    return voice.id;
  };

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
    return displayNameForVoiceId(vid);
  }, [displayNameForVoiceId, job, selectedSpeaker]);

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
    if (!spaceId || playLockRef.current) return;
    if (playingId === seg.id) {
      await stopActivePlayback();
      setPlayingId(null);
      return;
    }
    playLockRef.current = true;
    setPlayBusyId(seg.id);
    try {
      let uri = mediaCacheRef.current.get(seg.id);
      if (!uri) {
        const url = api.extractSegmentMediaUrl(spaceId, seg.id);
        uri = await fetchAuthedMediaUri(
          url,
          `extract-seg-${seg.id}`,
          "audio/wav",
        );
        mediaCacheRef.current.set(seg.id, uri);
      }
      await stopActivePlayback();
      setPlayingId(seg.id);
      setPlayBusyId(null);
      await playLocalAudio(uri, () => setPlayingId(null));
    } catch (e) {
      setPlayingId(null);
      Alert.alert(
        "Không phát được",
        e instanceof Error ? e.message : "Lỗi audio.",
      );
    } finally {
      playLockRef.current = false;
      setPlayBusyId(null);
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
    setBusy(true);
    try {
      const voiceProfileId =
        opts?.voiceProfileId ??
        (opts?.createIdentity ? undefined : await resolveTargetVoiceId());
      if (!voiceProfileId && !opts?.createIdentity) {
        Alert.alert(
          "Chọn hồ sơ đích",
          "Chọn hồ sơ có sẵn hoặc tạo hồ sơ mới.",
        );
        return;
      }
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
      await load({ silent: true });
      setSelectedIds(new Set());
      setShowCreate(false);
      setTargetVoiceId(res.voice_profile_id);
      const ident = identities.find(
        (x) => x.voice_profile_id === res.voice_profile_id,
      );
      if (ident) setTargetIdentityId(ident.id);
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

  const saveNewProfile = async () => {
    if (!spaceId || !jobId || !selectedSpeaker) {
      Alert.alert("Chọn speaker", "Chọn SPEAKER trước khi lưu hồ sơ.");
      return;
    }
    if (!newName.trim()) {
      Alert.alert("Thiếu tên", "Nhập tên người cần giữ.");
      return;
    }
    setBusy(true);
    try {
      const res = await api.assignExtractSpeaker(spaceId, jobId, {
        speakerLabel: selectedSpeaker,
        createIdentity: {
          display_name: newName.trim(),
          relation_label: newRelation.trim(),
          status: newStatus,
          consent: true,
        },
      });
      await load({ silent: true });
      setShowCreate(false);
      setNewName("");
      setNewRelation("");
      setNewStatus("remembered");
      const vid = res.assigned_voice?.id;
      if (vid) {
        setTargetVoiceId(vid);
        const newIdentId = res.assigned_voice?.identity_profile_id;
        if (newIdentId) {
          setTargetIdentityId(newIdentId);
        } else {
          const ident = identities.find((x) => x.voice_profile_id === vid);
          setTargetIdentityId(ident?.id ?? null);
        }
      }
      Alert.alert(
        "Đã lưu hồ sơ",
        `${selectedSpeaker} → ${res.assigned_voice?.display_name ?? newName.trim()}.\nChọn đoạn clean rồi bấm Import.`,
      );
    } catch (e) {
      Alert.alert(
        "Lỗi",
        e instanceof Error ? e.message : "Không lưu được hồ sơ.",
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
            Job chạy trên máy chủ — bạn có thể quay lại Voice DNA; pool vẫn
            được xử lý. Cần bật extract-worker trên máy dev.
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
            {!speakers.length && (job.clean_segment_count ?? 0) > 0 ? (
              <View style={styles.emptyPool}>
                <Text style={styles.body}>
                  Có {job.clean_segment_count} đoạn clean nhưng danh sách chưa
                  tải được.
                </Text>
                <Pressable
                  style={styles.btnGhost}
                  onPress={() => void load({ silent: false })}
                  disabled={busy}
                >
                  <Text style={styles.btnGhostText}>Tải lại pool</Text>
                </Pressable>
              </View>
            ) : null}
            {speakers.map(([label, info]) => {
              const active = selectedSpeaker === label;
              const sec = Math.round(info.totalMs / 100) / 10;
              const mapped = job.speaker_assignments?.[label];
              const mappedName = mapped ? displayNameForVoiceId(mapped) : null;
              return (
                <Pressable
                  key={label}
                  style={[styles.chip, active && styles.chipActive]}
                  onPress={() => {
                    setSelectedSpeaker(label);
                    setSelectedIds(new Set());
                    setShowCreate(false);
                    userPickedTargetRef.current = false;
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

          <Text style={styles.kicker}>2. Hồ sơ đích</Text>
          <Text style={styles.body}>
            Tất cả hồ sơ trong nhà ({identities.length}). Chưa có Voice DNA sẽ
            được tạo khi Import.
          </Text>
          {assignedLabel ? (
            <Text style={styles.meta}>
              SPEAKER này đã gán: {assignedLabel}
            </Text>
          ) : null}
          <View style={styles.chips}>
            {identities.map((ident) => {
              const active = targetIdentityId === ident.id && !showCreate;
              const hasVoice = Boolean(ident.voice_profile_id);
              return (
                <Pressable
                  key={ident.id}
                  style={[styles.chip, active && styles.chipActive]}
                  onPress={() => {
                    userPickedTargetRef.current = true;
                    setTargetIdentityId(ident.id);
                    setTargetVoiceId(ident.voice_profile_id ?? null);
                    setShowCreate(false);
                  }}
                >
                  <Text
                    style={[styles.chipText, active && styles.chipTextActive]}
                  >
                    {identityChipLabel(ident, user?.id)}
                  </Text>
                  {!hasVoice ? (
                    <Text
                      style={[styles.chipSub, active && styles.chipTextActive]}
                    >
                      Chưa có Voice DNA
                    </Text>
                  ) : null}
                </Pressable>
              );
            })}
            <Pressable
              style={[styles.chip, showCreate && styles.chipActive]}
              onPress={() => {
                setShowCreate(true);
                setTargetVoiceId(null);
                setTargetIdentityId(null);
                userPickedTargetRef.current = true;
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
              <Text style={styles.createHint}>
                Lưu hồ sơ trước, sau đó chọn đoạn và Import bên dưới.
              </Text>
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
              <View style={styles.rowActions}>
                <Pressable
                  style={[styles.btnGhost, styles.rowBtn]}
                  onPress={() => {
                    setShowCreate(false);
                    setNewName("");
                    setNewRelation("");
                    setNewStatus("remembered");
                  }}
                  disabled={busy}
                >
                  <Text style={styles.btnGhostText}>Huỷ</Text>
                </Pressable>
                <Pressable
                  style={[
                    styles.btn,
                    styles.rowBtn,
                    (busy || !newName.trim() || !selectedSpeaker) &&
                      styles.disabled,
                  ]}
                  onPress={saveNewProfile}
                  disabled={busy || !newName.trim() || !selectedSpeaker}
                >
                  <Text style={styles.btnText}>Lưu hồ sơ</Text>
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
                    onPress={() => void play(seg)}
                    disabled={Boolean(playBusyId && playBusyId !== seg.id)}
                    hitSlop={8}
                  >
                    <Text style={styles.playText}>
                      {playBusyId === seg.id
                        ? "Tải…"
                        : playingId === seg.id
                          ? "Dừng"
                          : "Nghe"}
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

          {!canImport ? (
            <Text style={styles.meta}>
              {!selectedSpeaker
                ? "Chọn SPEAKER trước."
                : !selectedIds.size
                  ? "Tick ít nhất một đoạn clean."
                  : "Chọn hồ sơ đích bên trên."}
            </Text>
          ) : null}

          <Pressable
            style={[styles.btn, (!canImport || busy) && styles.disabled]}
            onPress={() => void importSelected()}
            disabled={!canImport || busy}
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
                  await load({ silent: true });
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
  emptyPool: {
    width: "100%",
    gap: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
  },
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
  createHint: { fontSize: 13, lineHeight: 18, color: colors.inkSoft },
  rowActions: { flexDirection: "row", gap: 10, marginTop: 4 },
  rowBtn: { flex: 1 },
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
