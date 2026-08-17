import {
  ExtractJob,
  IdentityProfile,
  SpaceSettings,
  VoiceProfile,
} from "@forever/api-client";
import { useFocusEffect } from "@react-navigation/native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
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

import { useAuth } from "@/lib/auth";
import { identityChipLabel, LIVING_RELATIONS_TO_REMEMBERED, relationToRememberedPrompt } from "@/lib/identityDisplay";
import { useSpaceScreenOptions } from "@/lib/spaceHeader";
import { colors, fonts } from "@/lib/theme";

type WorkflowStep = 0 | 1 | 2 | 3;

const STEP_LABELS = ["Thu thập", "Duyệt", "Clone", "Nói"] as const;

function extractJobStatusVi(status: string): string {
  switch (status) {
    case "queued":
      return "Đang chờ worker";
    case "running":
      return "Đang tách giọng";
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

export default function VoiceDnaScreen() {
  const { spaceId, identityId: identityIdParam } = useLocalSearchParams<{
    spaceId: string;
    identityId?: string;
  }>();
  const { api, user } = useAuth();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [settings, setSettings] = useState<SpaceSettings | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [voices, setVoices] = useState<VoiceProfile[]>([]);
  const [identities, setIdentities] = useState<IdentityProfile[]>([]);
  const [selectedIdentityId, setSelectedIdentityId] = useState<string | null>(
    null,
  );
  const [consent, setConsent] = useState(false);
  const [newName, setNewName] = useState("");
  const [newRelation, setNewRelation] = useState("Bố");
  const [newStatus, setNewStatus] = useState<"living" | "remembered">("living");
  const [showAdd, setShowAdd] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [extractJobs, setExtractJobs] = useState<ExtractJob[]>([]);
  const [showTools, setShowTools] = useState(false);
  const loadGen = useRef(0);
  const extractPollRef = useRef(false);

  useSpaceScreenOptions({ spaceId, title: "Voice DNA", backTitle: "Nhà" });

  const load = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!spaceId) return;
      const silent = opts?.silent === true;
      const gen = ++loadGen.current;
      if (silent) setRefreshing(true);
      else setLoading(true);
      try {
        const [s, v, i, space] = await Promise.all([
          api.getSpaceSettings(spaceId),
          api.listVoices(spaceId),
          api.listIdentities(spaceId),
          api.getSpace(spaceId),
        ]);
        // Drop stale responses from overlapping loads.
        if (gen !== loadGen.current) return;
        setSettings(s);
        setVoices(v.voices);
        setIdentities(i.identities);
        setCanManage(
          s.can_edit === true ||
            space.role === "owner" ||
            space.steward_user_id === user?.id,
        );
        setSelectedIdentityId((prev) => {
          if (
            identityIdParam &&
            i.identities.some((x) => x.id === identityIdParam)
          ) {
            return identityIdParam;
          }
          if (prev && i.identities.some((x) => x.id === prev)) return prev;
          const me = i.identities.find((x) => x.linked_user_id === user?.id);
          return me?.id ?? i.identities[0]?.id ?? null;
        });
        const manage =
          s.can_edit === true ||
          space.role === "owner" ||
          space.steward_user_id === user?.id;
        if (manage) {
          const ej = await api.listExtractJobs(spaceId);
          if (gen !== loadGen.current) return;
          setExtractJobs(ej.jobs);
          extractPollRef.current = ej.jobs.some(
            (j) => j.status === "queued" || j.status === "running",
          );
        } else {
          setExtractJobs([]);
          extractPollRef.current = false;
        }
      } catch (e) {
        if (gen === loadGen.current) {
          Alert.alert(
            "Lỗi",
            e instanceof Error ? e.message : "Không tải Voice DNA.",
          );
        }
      } finally {
        if (gen === loadGen.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [api, identityIdParam, spaceId, user?.id],
  );

  useFocusEffect(
    useCallback(() => {
      // Soft refresh when returning from child screens — keep UI mounted.
      void load({ silent: true });
      const t = setInterval(() => {
        if (extractPollRef.current) void load({ silent: true });
      }, 8000);
      return () => clearInterval(t);
    }, [load]),
  );

  const visibleExtractJobs = useMemo(
    () =>
      extractJobs.filter(
        (j) =>
          j.status === "queued" ||
          j.status === "running" ||
          j.status === "needs_review" ||
          j.status === "failed",
      ),
    [extractJobs],
  );

  const selectedIdentity = useMemo(
    () => identities.find((x) => x.id === selectedIdentityId) ?? null,
    [identities, selectedIdentityId],
  );
  const activeVoice = useMemo(() => {
    if (!selectedIdentity) return undefined;
    if (selectedIdentity.voice_profile_id) {
      return voices.find((v) => v.id === selectedIdentity.voice_profile_id);
    }
    return voices.find((v) => v.identity_profile_id === selectedIdentity.id);
  }, [selectedIdentity, voices]);

  const chipLabel = (item: IdentityProfile) => {
    const label = identityChipLabel(item, user?.id);
    // Voice DNA lists the living and the remembered side by side, so mark the
    // ones being remembered when no relation already says who they are.
    if (item.status === "remembered" && label === item.display_name) {
      return `${item.display_name} · Ký ức`;
    }
    return label;
  };

  const displayIdentities = identities;
  const rememberedAnchor =
    identities.find(
      (i) => i.status === "remembered" && !i.archived_at,
    ) ?? null;

  const editingLinkedSelf =
    showEdit && selectedIdentity?.linked_user_id === user?.id;

  const isHeritageProfile = selectedIdentity?.status === "remembered";
  const personShort = selectedIdentity
    ? selectedIdentity.linked_user_id === user?.id
      ? "bạn"
      : selectedIdentity.display_name
    : "người này";

  const processedCount = activeVoice?.processed_count ?? 0;
  const unprocessedCount = activeVoice?.unprocessed_count ?? 0;
  const archivedCount = activeVoice?.archived_count ?? 0;

  const workflowStep = useMemo((): WorkflowStep => {
    if (!activeVoice) return 0;
    const totalSamples = unprocessedCount + processedCount;
    if (totalSamples < 1) return 0;
    if (processedCount < 1) return 1;
    if (activeVoice.status !== "ready") return 2;
    return 3;
  }, [activeVoice, unprocessedCount, processedCount]);

  const stepDone = useMemo(
    () => [
      !!activeVoice && unprocessedCount + processedCount > 0,
      processedCount >= 1,
      activeVoice?.status === "ready",
      activeVoice?.status === "ready",
    ],
    [activeVoice, unprocessedCount, processedCount],
  );

  const statusSummary = useMemo(() => {
    if (!selectedIdentity) return "Chọn hồ sơ để bắt đầu";
    if (!activeVoice) return "Chưa tạo Voice DNA";
    if (processedCount < 1 && unprocessedCount < 1) {
      return isHeritageProfile
        ? "Chưa có mẫu — tải hoặc ghi âm cũ"
        : "Chưa có mẫu — ghi thử một đoạn";
    }
    if (processedCount < 1 && unprocessedCount > 0) {
      return `${unprocessedCount} mẫu chờ duyệt`;
    }
    if (activeVoice.status === "failed") {
      return `Clone lần trước thất bại · ${processedCount} mẫu sẵn sàng`;
    }
    if (activeVoice.status === "draft" && processedCount >= 1) {
      return `Có bản clone cũ · cần clone lại · ${processedCount} mẫu`;
    }
    if (activeVoice.status === "ready") {
      return `Giọng sẵn sàng · ${processedCount} mẫu`;
    }
    return `${processedCount} mẫu sẵn sàng — chọn để clone`;
  }, [
    selectedIdentity,
    activeVoice,
    isHeritageProfile,
    unprocessedCount,
    processedCount,
  ]);

  const createVoice = async () => {
    if (!spaceId || !selectedIdentity || !consent || busy) return;
    const isSelf = selectedIdentity.linked_user_id === user?.id;
    const isHeritage = selectedIdentity.status === "remembered";
    if (!isSelf && !canManage) {
      Alert.alert(
        "Không đủ quyền",
        isHeritage
          ? "Hồ sơ Ký ức chỉ Owner / Steward tạo và quản lý Voice DNA."
          : "Chỉ Owner / Steward tạo Voice DNA cho người khác.",
      );
      return;
    }
    setBusy(true);
    try {
      if (isSelf) {
        await api.createSelfVoice(spaceId, true);
      } else {
        await api.createVoiceForIdentity(spaceId, selectedIdentity.id, true);
      }
      setConsent(false);
      await load({ silent: true });
    } catch (e) {
      Alert.alert("Lỗi", e instanceof Error ? e.message : "Không tạo được.");
    } finally {
      setBusy(false);
    }
  };

  const addIdentity = async () => {
    if (!spaceId || !newName.trim() || busy) return;
    if (!canManage) {
      Alert.alert("Không đủ quyền", "Chỉ Owner / Steward thêm hồ sơ.");
      return;
    }
    setBusy(true);
    try {
      const row = await api.createIdentity(spaceId, {
        display_name: newName.trim(),
        relation_label: newRelation.trim(),
        status: newStatus,
      });
      setNewName("");
      setShowAdd(false);
      setSelectedIdentityId(row.id);
      setConsent(false);
      await load({ silent: true });
    } catch (e) {
      Alert.alert("Lỗi", e instanceof Error ? e.message : "Không tạo hồ sơ.");
    } finally {
      setBusy(false);
    }
  };

  const openAddForm = () => {
    setShowEdit(false);
    setNewName("");
    setNewRelation("Con");
    setNewStatus("living");
    setShowAdd(true);
  };

  const openEdit = () => {
    if (!selectedIdentity || !canManage) return;
    setShowAdd(false);
    setNewName(selectedIdentity.display_name);
    setNewRelation(selectedIdentity.relation_label || "");
    setNewStatus(
      selectedIdentity.status === "remembered" ? "remembered" : "living",
    );
    setShowEdit(true);
  };

  const saveEdit = async () => {
    if (!spaceId || !selectedIdentity || !newName.trim() || busy) return;
    if (!canManage) {
      Alert.alert("Không đủ quyền", "Chỉ Owner / Steward sửa hồ sơ.");
      return;
    }
    setBusy(true);
    try {
      await api.updateIdentity(spaceId, selectedIdentity.id, {
        display_name: newName.trim(),
        relation_label: newRelation.trim(),
        status: newStatus,
      });
      setShowEdit(false);
      await load({ silent: true });
    } catch (e) {
      Alert.alert("Lỗi", e instanceof Error ? e.message : "Không lưu được.");
    } finally {
      setBusy(false);
    }
  };

  const clone = () => {
    if (!activeVoice || busy) return;
    if (!settings?.elevenlabs_api_key_set) {
      Alert.alert(
        "Thiếu API key",
        "Đặt ELEVENLABS_API_KEY trong apps/api/.env rồi restart API.",
      );
      return;
    }
    if (processedCount < 1) {
      Alert.alert(
        "Chưa có mẫu sẵn clone",
        unprocessedCount > 0
          ? `Có ${unprocessedCount} mẫu chưa duyệt. Vào Mẫu giọng → chọn đoạn sạch → Duyệt.`
          : isHeritageProfile
            ? "Tải ít nhất một file audio trước khi clone."
            : "Ghi ít nhất một mẫu trước khi clone.",
      );
      return;
    }
    router.push(
      `/voice/${spaceId}/clone?voiceId=${activeVoice.id}` as never,
    );
  };

  const go = (path: string) => {
    if (!spaceId) return;
    if (path === "renders") {
      router.push(`/voice/${spaceId}/renders` as never);
      return;
    }
    if (path === "clones") {
      const q = activeVoice
        ? `?voiceId=${activeVoice.id}`
        : selectedIdentityId
          ? `?identityId=${selectedIdentityId}`
          : "";
      router.push(`/voice/${spaceId}/clones${q}` as never);
      return;
    }
    if (!activeVoice) {
      Alert.alert("Chưa có Voice DNA", "Tạo Voice DNA cho hồ sơ này trước.");
      return;
    }
    router.push(`/voice/${spaceId}/${path}?voiceId=${activeVoice.id}` as never);
  };

  const goSamples = (
    stage: "unprocessed" | "processed" | "archived" = "unprocessed",
  ) => {
    if (!spaceId || !activeVoice) return;
    router.push(
      `/voice/${spaceId}/samples?voiceId=${activeVoice.id}&stage=${stage}` as never,
    );
  };

  const ready = activeVoice?.status === "ready";
  const cloneFailed = activeVoice?.status === "failed";
  const canClone = !!activeVoice && processedCount >= 1;

  /**
   * May this person collect, review and clone *this* voice?
   *
   * Mirrors `_can_mutate_voice` on the API. Getting it wrong here only shows a
   * button that 403s, which is how mẹ used to meet this screen: every control
   * visible, none of them hers. Speaking and listening are open to the family
   * and stay outside this gate.
   */
  const isOwnVoice =
    (!!user?.id && selectedIdentity?.linked_user_id === user.id) ||
    (!!user?.id && activeVoice?.subject_user_id === user.id);
  const canBuildVoice = canManage || isOwnVoice;

  const primaryAction = useMemo(() => {
    if (!selectedIdentity) return null;
    if (!canBuildVoice) {
      // Nothing to build here, but a ready voice is still theirs to speak with.
      return ready
        ? {
            label: "Tạo câu nói",
            subtext: `Nghe thử giọng ${personShort} từ câu chữ`,
            onPress: () => go("speak"),
            kind: "nav" as const,
          }
        : {
            label: "",
            subtext: `Giọng của ${personShort} do người giữ nhà thu và dựng. Khi xong, bạn sẽ nói được bằng giọng ấy.`,
            kind: "readonly" as const,
          };
    }
    if (!activeVoice) {
      return {
        label: "Tạo Voice DNA",
        subtext: isHeritageProfile
          ? `Bắt đầu thu giọng ký ức cho ${personShort}`
          : `Bắt đầu thu giọng cho ${personShort}`,
        kind: "create" as const,
      };
    }
    if (processedCount < 1 && unprocessedCount < 1) {
      return {
        label: isHeritageProfile ? "Tải file" : "Ghi mẫu giọng",
        subtext: isHeritageProfile
          ? "Chọn ghi âm hoặc video từ điện thoại"
          : "Đọc theo đoạn AI gợi ý — khoảng 30 giây",
        onPress: () => go(isHeritageProfile ? "upload" : "record"),
        kind: "nav" as const,
      };
    }
    if (processedCount < 1 && unprocessedCount > 0) {
      return {
        label: "Duyệt mẫu",
        subtext: `${unprocessedCount} đoạn chờ — chọn đoạn sạch để clone`,
        onPress: () => goSamples("unprocessed"),
        kind: "nav" as const,
      };
    }
    if (!ready) {
      return {
        label: cloneFailed ? "Thử clone lại" : "Clone giọng",
        subtext: cloneFailed
          ? `Lần trước không thành công · chọn lại mẫu`
          : `${processedCount} mẫu sẵn sàng — chọn bộ để clone`,
        onPress: clone,
        disabled: !canClone || busy,
        kind: "clone" as const,
      };
    }
    return {
      label: "Tạo câu nói",
      subtext: `Nghe thử giọng ${personShort} từ câu chữ`,
      onPress: () => go("speak"),
      kind: "nav" as const,
    };
  }, [
    selectedIdentity,
    activeVoice,
    canBuildVoice,
    isHeritageProfile,
    personShort,
    processedCount,
    unprocessedCount,
    ready,
    cloneFailed,
    canClone,
    busy,
  ]);

  const goStep = (step: WorkflowStep) => {
    if (!activeVoice) return;
    switch (step) {
      case 0:
        go(isHeritageProfile ? "upload" : "record");
        break;
      case 1:
        goSamples("unprocessed");
        break;
      case 2:
        if (canClone && !ready) clone();
        else if (ready) go("clones");
        else goSamples("processed");
        break;
      case 3:
        go("speak");
        break;
    }
  };

  if (loading && identities.length === 0) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={styles.sticky}>
        <View style={styles.stickyTop}>
          <Text style={styles.stickyKicker}>Voice DNA</Text>
          <View style={styles.stickyLinks}>
            {canManage ? (
              <Pressable
                onPress={openEdit}
                disabled={!selectedIdentity}
                hitSlop={8}
              >
                <Text
                  style={[
                    styles.link,
                    !selectedIdentity && styles.linkMuted,
                  ]}
                >
                  Sửa hồ sơ
                </Text>
              </Pressable>
            ) : (
              <Text style={styles.linkMuted}>Chỉ xem</Text>
            )}
            {canManage && !settings?.elevenlabs_api_key_set ? (
              <Pressable
                onPress={() => spaceId && router.push(`/settings/${spaceId}`)}
                hitSlop={8}
              >
                <Text style={styles.linkWarn}>Thiếu API key</Text>
              </Pressable>
            ) : null}
          </View>
        </View>

        {displayIdentities.length ? (
          <View style={styles.chipsWrap}>
            {displayIdentities.map((item) => {
              const active = selectedIdentityId === item.id;
              return (
                <Pressable
                  key={item.id}
                  style={[styles.chip, active && styles.chipActive]}
                  onPress={() => {
                    setSelectedIdentityId(item.id);
                    setConsent(false);
                    setShowEdit(false);
                    setShowAdd(false);
                  }}
                >
                  <Text
                    style={[styles.chipText, active && styles.chipTextActive]}
                  >
                    {chipLabel(item)}
                  </Text>
                </Pressable>
              );
            })}
            {canManage ? (
              <Pressable style={styles.chipAdd} onPress={openAddForm} hitSlop={4}>
                <Text style={styles.chipAddText}>+ Thêm</Text>
              </Pressable>
            ) : null}
          </View>
        ) : canManage ? (
          <Pressable style={styles.addBanner} onPress={openAddForm}>
            <Text style={styles.addBannerTitle}>Thêm hồ sơ đầu tiên</Text>
            <Text style={styles.addBannerSub}>
              Bố, Mẹ, chị/em… — một Space, nhiều người.
            </Text>
          </Pressable>
        ) : (
          <Text style={styles.meta}>
            Chưa có hồ sơ. Nhờ người quản lý nhà (Owner/Steward) thêm.
          </Text>
        )}

        {activeVoice && canBuildVoice ? (
          <View style={styles.stepper}>
            {STEP_LABELS.map((label, idx) => {
              const step = idx as WorkflowStep;
              const done = stepDone[idx];
              const active = workflowStep === step;
              const reachable = !!activeVoice;
              return (
                <Pressable
                  key={label}
                  style={styles.stepItem}
                  onPress={() => reachable && goStep(step)}
                  disabled={!reachable}
                >
                  <View
                    style={[
                      styles.stepDot,
                      done && styles.stepDotDone,
                      active && styles.stepDotActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.stepDotText,
                        (done || active) && styles.stepDotTextActive,
                      ]}
                    >
                      {done && !active ? "✓" : idx + 1}
                    </Text>
                  </View>
                  <Text
                    style={[
                      styles.stepLabel,
                      active && styles.stepLabelActive,
                      done && !active && styles.stepLabelDone,
                    ]}
                  >
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        <View style={styles.statusRow}>
          <Text
            style={[
              styles.statusLine,
              cloneFailed && styles.statusWarn,
            ]}
          >
            {statusSummary}
          </Text>
          {refreshing ? (
            <ActivityIndicator size="small" color={colors.inkSoft} />
          ) : null}
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.root}
        keyboardShouldPersistTaps="handled"
      >
        {!canManage ? (
          <View style={styles.infoCard}>
            <Text style={styles.infoTitle}>Chỉ có hồ sơ "Tôi"?</Text>
            <Text style={styles.infoBody}>
              Thêm Bố, Mẹ hoặc người thân khác cần quyền quản lý nhà (Owner hoặc
              Steward). Nhờ người tạo Space đăng nhập để thêm hồ sơ.
            </Text>
          </View>
        ) : null}

        {canManage && visibleExtractJobs.length ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Pool tách giọng</Text>
            <Text style={styles.meta}>
              Job chạy trên máy chủ — bạn có thể quay lại Voice DNA để xem tiến
              độ.
            </Text>
            {visibleExtractJobs.map((job) => {
              const active =
                job.status === "queued" || job.status === "running";
              return (
                <Pressable
                  key={job.id}
                  style={styles.extractRow}
                  onPress={() =>
                    router.push(
                      `/voice/${spaceId}/extract/${job.id}` as never,
                    )
                  }
                >
                  <View style={styles.extractRowMain}>
                    <Text style={styles.extractRowTitle} numberOfLines={1}>
                      {job.original_filename || "Băng ghi"} ·{" "}
                      {job.num_speakers} người
                    </Text>
                    <Text style={styles.extractRowSub}>
                      {extractJobStatusVi(job.status)}
                      {job.status === "needs_review" && job.clean_segment_count
                        ? ` · ${job.clean_segment_count} đoạn clean`
                        : ""}
                      {job.status === "failed" && job.error_message
                        ? ` — ${job.error_message}`
                        : ""}
                    </Text>
                  </View>
                  {active ? (
                    <ActivityIndicator size="small" color={colors.brand} />
                  ) : (
                    <Text style={styles.extractChevron}>›</Text>
                  )}
                </Pressable>
              );
            })}
          </View>
        ) : null}

        {showAdd || showEdit ? (
          <View style={styles.card}>
            <Text style={styles.formTitle}>
              {showEdit ? "Sửa hồ sơ" : "Thêm người"}
            </Text>
            <TextInput
              style={styles.input}
              value={newName}
              onChangeText={setNewName}
              placeholder="Tên (vd. Nguyễn Đình Anh)"
              placeholderTextColor={colors.inkSoft}
            />
            <Text style={styles.formHint}>
              {newStatus === "remembered"
                ? "Cả nhà gọi người đã mất là gì — Bố, Ông… Không phải vai trò với tài khoản quản trị."
                : `${relationToRememberedPrompt(rememberedAnchor)}. Không phải với chủ nhà. Bạn đời = Vợ. Con cái = Con. Đừng dùng Anh/Chị/Mẹ.`}
            </Text>
            {newStatus === "living" ? (
              <View style={styles.presetRow}>
                {LIVING_RELATIONS_TO_REMEMBERED.map((rel) => {
                  const active = newRelation === rel;
                  return (
                    <Pressable
                      key={rel}
                      style={[styles.chip, active && styles.chipActive]}
                      onPress={() => setNewRelation(rel)}
                    >
                      <Text
                        style={[
                          styles.chipText,
                          active && styles.chipTextActive,
                        ]}
                      >
                        {rel}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : (
              <TextInput
                style={styles.input}
                value={newRelation}
                onChangeText={setNewRelation}
                placeholder="Cả nhà gọi là — vd. Bố"
                placeholderTextColor={colors.inkSoft}
              />
            )}
            <View style={styles.presetRow}>
              <Pressable
                style={[styles.chip, newStatus === "living" && styles.chipActive]}
                onPress={() => {
                  setNewStatus("living");
                  if (newRelation === "Bố" || newRelation === "Ông") {
                    setNewRelation("Con");
                  }
                }}
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
                  editingLinkedSelf && styles.chipDisabled,
                ]}
                onPress={() => {
                  if (editingLinkedSelf) return;
                  setNewStatus("remembered");
                  if (
                    (LIVING_RELATIONS_TO_REMEMBERED as readonly string[]).includes(
                      newRelation,
                    )
                  ) {
                    setNewRelation("Bố");
                  }
                }}
                disabled={editingLinkedSelf}
              >
                <Text
                  style={[
                    styles.chipText,
                    newStatus === "remembered" && styles.chipTextActive,
                    editingLinkedSelf && styles.chipTextDisabled,
                  ]}
                >
                  Ký ức
                </Text>
              </Pressable>
            </View>
            {editingLinkedSelf ? (
              <Text style={styles.formHint}>
                Hồ sơ Tôi luôn là Đang sống — Ký ức dùng cho người thân (Bố, Mẹ…).
              </Text>
            ) : newStatus === "remembered" ? (
              <Text style={styles.formHint}>
                Ký ức: người đã mất hoặc giọng lưu trữ — cần quyền Owner/Steward và
                đồng ý ký ức khi tạo Voice DNA.
              </Text>
            ) : null}
            <View style={styles.rowActions}>
              <Pressable
                style={[styles.btnGhost, styles.rowBtn]}
                onPress={() => {
                  setShowAdd(false);
                  setShowEdit(false);
                }}
                disabled={busy}
              >
                <Text style={styles.btnGhostText}>Huỷ</Text>
              </Pressable>
              <Pressable
                style={[
                  styles.btn,
                  styles.rowBtn,
                  (!newName.trim() || busy) && styles.disabled,
                ]}
                onPress={showEdit ? saveEdit : addIdentity}
                disabled={!newName.trim() || busy}
              >
                <Text style={styles.btnText}>
                  {showEdit ? "Lưu" : "Tạo hồ sơ"}
                </Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {!selectedIdentity ? null : !activeVoice && canBuildVoice ? (
          <View style={styles.heroCard}>
            <Text style={styles.heroTitle}>Bước tiếp theo</Text>
            <Text style={styles.heroSub}>
              {primaryAction?.subtext ?? "Tạo Voice DNA để bắt đầu"}
            </Text>
            <Pressable
              style={styles.checkRow}
              onPress={() => setConsent((v) => !v)}
            >
              <Text style={styles.checkBox}>{consent ? "☑" : "☐"}</Text>
              <Text style={styles.checkText}>
                {selectedIdentity.linked_user_id === user?.id
                  ? settings?.consent_self ||
                    "Tôi cho phép Forever tạo bản sao giọng của tôi."
                  : settings?.consent_heritage ||
                    "Tôi xác nhận quyền thu thập và dùng tư liệu giọng của người này."}
              </Text>
            </Pressable>
            <Pressable
              style={[styles.btn, (!consent || busy) && styles.disabled]}
              onPress={createVoice}
              disabled={!consent || busy}
            >
              <Text style={styles.btnText}>Tạo Voice DNA</Text>
            </Pressable>
          </View>
        ) : primaryAction ? (
          <>
            <View style={styles.heroCard}>
              <Text style={styles.heroTitle}>
                {primaryAction.kind === "readonly" ? "Giọng này" : "Bước tiếp theo"}
              </Text>
              <Text style={styles.heroSub}>{primaryAction.subtext}</Text>
              {primaryAction.kind === "create" ||
              primaryAction.kind === "readonly" ? null : (
                <Pressable
                  style={[
                    styles.btn,
                    primaryAction.disabled && styles.disabled,
                  ]}
                  onPress={primaryAction.onPress}
                  disabled={primaryAction.disabled}
                >
                  <Text style={styles.btnText}>{primaryAction.label}</Text>
                </Pressable>
              )}
              {canBuildVoice && activeVoice && unprocessedCount + processedCount > 0 ? (
                <Pressable
                  style={styles.heroLink}
                  onPress={() => goSamples("unprocessed")}
                  hitSlop={6}
                >
                  <Text style={styles.historyLink}>
                    Mẫu giọng
                    {unprocessedCount > 0
                      ? ` · ${unprocessedCount} chờ duyệt`
                      : processedCount > 0
                        ? ` · ${processedCount} sẵn sàng`
                        : ""}
                  </Text>
                </Pressable>
              ) : null}
            </View>

            {activeVoice ? (
              <Pressable
                style={styles.toolsToggle}
                onPress={() => setShowTools((v) => !v)}
              >
                <Text style={styles.toolsToggleText}>
                  {showTools ? "Ẩn thêm & lịch sử" : "Thêm & lịch sử"}
                </Text>
                <Text style={styles.toolsChevron}>{showTools ? "▾" : "▸"}</Text>
              </Pressable>
            ) : null}

            {showTools && activeVoice ? (
              <View style={styles.group}>
                {canBuildVoice ? (
                  <>
                <Text style={styles.kicker}>Thêm mẫu</Text>
                {isHeritageProfile ? (
                  <>
                    <Pressable style={styles.action} onPress={() => go("upload")}>
                      <Text style={styles.actionTitle}>Tải file</Text>
                      <Text style={styles.actionSub}>
                        Thêm đoạn mới cho người này
                      </Text>
                    </Pressable>
                    {canManage ? (
                      <Pressable
                        style={styles.action}
                        onPress={() => {
                          if (!activeVoice || !spaceId) return;
                          router.push(
                            `/voice/${spaceId}/extract/new?voiceId=${activeVoice.id}` as never,
                          );
                        }}
                      >
                        <Text style={styles.actionTitle}>
                          Tách giọng từ băng dài
                        </Text>
                        <Text style={styles.actionSub}>
                          Một băng dài → nhiều người trong nhà
                        </Text>
                      </Pressable>
                    ) : null}
                  </>
                ) : (
                  <Pressable style={styles.action} onPress={() => go("record")}>
                    <Text style={styles.actionTitle}>Ghi mẫu</Text>
                    <Text style={styles.actionSub}>
                      Thêm đoạn mới cho người này
                    </Text>
                  </Pressable>
                )}

                <Text style={styles.kicker}>Lịch sử & chỉnh lại</Text>
                {ready ? (
                  <Pressable
                    style={styles.action}
                    onPress={clone}
                    disabled={!canClone || busy}
                  >
                    <Text style={styles.actionTitle}>Clone lại</Text>
                    <Text style={styles.actionSub}>
                      Làm bản giọng mới từ mẫu đã chọn
                    </Text>
                  </Pressable>
                ) : null}
                <Pressable style={styles.action} onPress={() => go("clones")}>
                  <Text style={styles.actionTitle}>Các bản clone</Text>
                  <Text style={styles.actionSub}>
                    Chọn bản mặc định hoặc xoá bản cũ
                  </Text>
                </Pressable>
                  </>
                ) : null}
                <Pressable style={styles.action} onPress={() => go("renders")}>
                  <Text style={styles.actionTitle}>Câu đã tạo</Text>
                  <Text style={styles.actionSub}>
                    Nghe / chia sẻ các lần TTS trước
                  </Text>
                </Pressable>
                {canBuildVoice && archivedCount > 0 ? (
                  <Pressable
                    style={styles.action}
                    onPress={() => goSamples("archived")}
                  >
                    <Text style={styles.actionTitle}>Mẫu không dùng</Text>
                    <Text style={styles.actionSub}>
                      {archivedCount} mẫu đã loại — khôi phục nếu cần
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bg,
  },
  sticky: {
    backgroundColor: colors.bg,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
    gap: 8,
  },
  stickyTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  stickyKicker: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.inkSoft,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  stickyLinks: { flexDirection: "row", alignItems: "center", gap: 14 },
  link: { fontSize: 14, fontWeight: "700", color: colors.brand },
  linkMuted: { fontSize: 13, fontWeight: "600", color: colors.inkSoft },
  linkWarn: { fontSize: 13, fontWeight: "700", color: "#9a4b2e" },
  chipsWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  stepper: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 4,
    paddingTop: 2,
  },
  stepItem: { flex: 1, alignItems: "center", gap: 4 },
  stepDot: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1.5,
    borderColor: colors.line,
    backgroundColor: colors.card,
    alignItems: "center",
    justifyContent: "center",
  },
  stepDotActive: {
    borderColor: colors.brand,
    backgroundColor: colors.brand,
  },
  stepDotDone: {
    borderColor: colors.brand,
    backgroundColor: "rgba(45, 74, 62, 0.12)",
  },
  stepDotText: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.inkSoft,
  },
  stepDotTextActive: { color: "#fff" },
  stepLabel: {
    fontSize: 10,
    fontWeight: "600",
    color: colors.inkSoft,
    textAlign: "center",
  },
  stepLabelActive: { color: colors.brand, fontWeight: "700" },
  stepLabelDone: { color: colors.ink },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  statusLine: {
    flex: 1,
    fontSize: 14,
    fontWeight: "600",
    color: colors.ink,
    lineHeight: 19,
  },
  statusWarn: { color: "#9a4b2e" },
  heroCard: {
    backgroundColor: colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 16,
    gap: 10,
  },
  heroTitle: {
    fontFamily: fonts.display,
    fontSize: 20,
    color: colors.ink,
  },
  heroSub: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.inkSoft,
  },
  heroLink: { alignSelf: "flex-start" },
  toolsToggle: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
    paddingHorizontal: 4,
  },
  toolsToggleText: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.inkSoft,
  },
  toolsChevron: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.inkSoft,
  },
  scroll: { flex: 1 },
  root: { padding: 20, gap: 12, paddingBottom: 40 },
  kicker: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.inkSoft,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginTop: 4,
  },
  group: { gap: 8 },
  card: {
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 14,
    gap: 10,
  },
  cardTitle: { fontFamily: fonts.display, fontSize: 18, color: colors.ink },
  meta: { fontSize: 13, color: colors.inkSoft, lineHeight: 18 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
  },
  chipActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipDisabled: { opacity: 0.45 },
  chipText: { fontSize: 13, color: colors.ink, fontWeight: "600" },
  chipTextActive: { color: "#fff" },
  chipTextDisabled: { color: colors.inkSoft },
  chipAdd: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: colors.brand,
    borderStyle: "dashed",
    backgroundColor: "rgba(45, 74, 62, 0.06)",
  },
  chipAddText: { fontSize: 13, color: colors.brand, fontWeight: "700" },
  addBanner: {
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.brand,
    padding: 14,
    gap: 6,
  },
  addBannerTitle: { fontSize: 16, fontWeight: "700", color: colors.ink },
  addBannerSub: { fontSize: 13, lineHeight: 18, color: colors.inkSoft },
  infoCard: {
    backgroundColor: "#f7f1e6",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(196, 165, 116, 0.45)",
    padding: 14,
    gap: 6,
  },
  infoTitle: { fontSize: 15, fontWeight: "700", color: colors.ink },
  infoBody: { fontSize: 13, lineHeight: 18, color: colors.inkSoft },
  formTitle: { fontSize: 14, fontWeight: "700", color: colors.ink },
  formHint: { fontSize: 12, lineHeight: 17, color: colors.inkSoft },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.ink,
    backgroundColor: "#fff",
  },
  presetRow: { flexDirection: "row", gap: 8 },
  rowActions: { flexDirection: "row", gap: 10 },
  rowBtn: { flex: 1 },
  checkRow: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  checkBox: { fontSize: 18, color: colors.brand, lineHeight: 22 },
  checkText: { flex: 1, fontSize: 14, lineHeight: 20, color: colors.ink },
  action: {
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    paddingVertical: 14,
    paddingHorizontal: 14,
    gap: 4,
  },
  actionDisabled: { opacity: 0.5 },
  actionTitle: { fontSize: 16, fontWeight: "700", color: colors.ink },
  actionSub: { fontSize: 13, color: colors.inkSoft, lineHeight: 18 },
  cloneBlock: {
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 14,
    gap: 8,
  },
  cloneHint: { fontSize: 13, color: colors.inkSoft, lineHeight: 18 },
  historyLink: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.brand,
    paddingVertical: 2,
  },
  btn: {
    backgroundColor: colors.brand,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  btnText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  btnGhost: {
    borderWidth: 1,
    borderColor: colors.brand,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  btnGhostText: { color: colors.brand, fontWeight: "700", fontSize: 14 },
  disabled: { opacity: 0.5 },
  extractRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  extractRowMain: { flex: 1, gap: 2 },
  extractRowTitle: { fontSize: 15, fontWeight: "700", color: colors.ink },
  extractRowSub: { fontSize: 13, lineHeight: 18, color: colors.inkSoft },
  extractChevron: {
    fontSize: 22,
    fontWeight: "600",
    color: colors.inkSoft,
    paddingHorizontal: 4,
  },
});
