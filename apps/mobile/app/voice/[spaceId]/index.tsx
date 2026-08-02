import {
  IdentityProfile,
  SpaceSettings,
  VoiceProfile,
} from "@forever/api-client";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
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
import { colors, fonts } from "@/lib/theme";

function statusVi(status: string): string {
  switch (status) {
    case "ready":
      return "Sẵn sàng";
    case "draft":
      return "Nháp";
    case "failed":
      return "Lỗi clone";
    case "paused":
      return "Tạm dừng";
    default:
      return status;
  }
}

export default function VoiceDnaScreen() {
  const { spaceId } = useLocalSearchParams<{ spaceId: string }>();
  const { api, user } = useAuth();
  const navigation = useNavigation();
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
  const loadGen = useRef(0);

  useLayoutEffect(() => {
    navigation.setOptions({ title: "Voice DNA" });
  }, [navigation]);

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
          if (prev && i.identities.some((x) => x.id === prev)) return prev;
          const me = i.identities.find((x) => x.linked_user_id === user?.id);
          return me?.id ?? i.identities[0]?.id ?? null;
        });
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
    [api, spaceId, user?.id],
  );

  useFocusEffect(
    useCallback(() => {
      // Soft refresh when returning from child screens — keep UI mounted.
      void load({ silent: true });
    }, [load]),
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
    if (item.linked_user_id === user?.id) return "Tôi";
    const name = item.relation_label || item.display_name;
    if (item.status === "remembered") return `${name} · Ký ức`;
    return name;
  };

  const editingLinkedSelf =
    showEdit && selectedIdentity?.linked_user_id === user?.id;

  const personTitle = selectedIdentity
    ? selectedIdentity.linked_user_id === user?.id
      ? "Tôi"
      : selectedIdentity.relation_label
        ? `${selectedIdentity.display_name} · ${selectedIdentity.relation_label}`
        : selectedIdentity.display_name
    : "Chưa chọn hồ sơ";

  const nextStep = useMemo(() => {
    if (!selectedIdentity) return "Thêm hoặc chọn hồ sơ người.";
    if (!activeVoice) return "Tạo Voice DNA cho hồ sơ này để bắt đầu ghi mẫu.";
    if (activeVoice.sample_count < 1) return "Tiếp theo: ghi ít nhất một mẫu giọng.";
    if (activeVoice.status !== "ready") return "Tiếp theo: Clone để dùng tạo giọng.";
    return "Có thể tạo giọng từ text. Clone lại nếu vừa đổi mẫu.";
  }, [selectedIdentity, activeVoice]);

  const statusSummary = useMemo(() => {
    if (!activeVoice) return "Chưa có Voice DNA";
    return `${statusVi(activeVoice.status)} · ${activeVoice.sample_count} mẫu ghi`;
  }, [activeVoice]);

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
    setNewRelation("Bố");
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

  const clone = async () => {
    if (!activeVoice || busy) return;
    if (!settings?.elevenlabs_api_key_set) {
      Alert.alert(
        "Thiếu API key",
        "Đặt ELEVENLABS_API_KEY trong apps/api/.env rồi restart API.",
      );
      return;
    }
    if (activeVoice.sample_count < 1) {
      Alert.alert("Chưa có mẫu", "Ghi ít nhất một mẫu trước khi clone.");
      return;
    }
    setBusy(true);
    try {
      const res = await api.cloneVoice(activeVoice.id, {
        remove_background_noise: true,
      });
      await load({ silent: true });
      Alert.alert(
        res.status === "ready" ? "Voice DNA sẵn sàng" : "Clone xong",
        res.status === "ready"
          ? "Bạn có thể tạo giọng từ text."
          : res.error_message || res.status,
      );
    } catch (e) {
      await load({ silent: true });
      Alert.alert("Clone thất bại", e instanceof Error ? e.message : "Lỗi ElevenLabs.");
    } finally {
      setBusy(false);
    }
  };

  const go = (path: string) => {
    if (!spaceId) return;
    if (path === "renders") {
      const q = activeVoice ? `?voiceId=${activeVoice.id}` : "";
      router.push(`/voice/${spaceId}/renders${q}` as never);
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

  if (loading && identities.length === 0) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }

  const ready = activeVoice?.status === "ready";
  const canClone = !!activeVoice && activeVoice.sample_count >= 1;

  return (
    <View style={styles.screen}>
      <View style={styles.sticky}>
        <View style={styles.stickyTop}>
          <Text style={styles.personTitle} numberOfLines={1}>
            {personTitle}
          </Text>
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
            <Pressable
              onPress={() => spaceId && router.push(`/settings/${spaceId}`)}
              hitSlop={8}
            >
              <Text style={styles.linkMuted}>
                Key {settings?.elevenlabs_api_key_set ? "OK" : "thiếu"}
              </Text>
            </Pressable>
          </View>
        </View>

        {identities.length ? (
          <View style={styles.chipsWrap}>
            {identities.map((item) => {
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

        <View style={styles.statusRow}>
          <Text style={styles.statusLine}>{statusSummary}</Text>
          {refreshing ? (
            <ActivityIndicator size="small" color={colors.inkSoft} />
          ) : null}
        </View>
        <Text style={styles.nextStep}>{nextStep}</Text>
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

        {showAdd || showEdit ? (
          <View style={styles.card}>
            <Text style={styles.formTitle}>
              {showEdit ? "Sửa hồ sơ" : "Thêm người"}
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
            <View style={styles.presetRow}>
              <Pressable
                style={[styles.chip, newStatus === "living" && styles.chipActive]}
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
                  editingLinkedSelf && styles.chipDisabled,
                ]}
                onPress={() => {
                  if (editingLinkedSelf) return;
                  setNewStatus("remembered");
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

        {!selectedIdentity ? null : !activeVoice ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Tạo Voice DNA</Text>
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
        ) : (
          <>
            <Text style={styles.kicker}>Thu thập & Clone</Text>
            <View style={styles.group}>
              <Pressable style={styles.action} onPress={() => go("record")}>
                <Text style={styles.actionTitle}>Ghi mẫu</Text>
                <Text style={styles.actionSub}>
                  AI đoạn đọc → ghi → nghe → lưu
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
                  <Text style={styles.actionTitle}>Giọng từ ký ức</Text>
                  <Text style={styles.actionSub}>
                    Upload băng cũ → tách solo → duyệt tay → Voice DNA
                  </Text>
                </Pressable>
              ) : null}
              <Pressable style={styles.action} onPress={() => go("samples")}>
                <Text style={styles.actionTitle}>Mẫu đã ghi</Text>
                <Text style={styles.actionSub}>
                  Nghe lại, điểm chất lượng, ghi chú
                </Text>
              </Pressable>

              <View style={styles.cloneBlock}>
                <Pressable
                  style={[styles.btn, (!canClone || busy) && styles.disabled]}
                  onPress={clone}
                  disabled={!canClone || busy}
                >
                  <Text style={styles.btnText}>
                    {ready ? "Clone lại" : "Clone Voice DNA"}
                  </Text>
                </Pressable>
                <Text style={styles.cloneHint}>
                  {!canClone
                    ? "Cần ≥ 1 mẫu ghi trước khi clone."
                    : ready
                      ? "Đã clone. Làm lại nếu vừa đổi mẫu."
                      : "Clone để mở bước tạo giọng từ text."}
                </Text>
                <Pressable onPress={() => go("clones")} hitSlop={6}>
                  <Text style={styles.historyLink}>Xem lịch sử clone</Text>
                </Pressable>
              </View>
            </View>

            <Text style={styles.kicker}>Tạo giọng</Text>
            <View style={styles.group}>
              <Pressable
                style={[styles.action, !ready && styles.actionDisabled]}
                onPress={() => {
                  if (!ready) {
                    Alert.alert(
                      "Chưa clone",
                      "Cần Clone Voice DNA trước khi tạo giọng từ text.",
                    );
                    return;
                  }
                  go("speak");
                }}
              >
                <Text style={styles.actionTitle}>Tạo giọng từ text</Text>
                <Text style={styles.actionSub}>
                  {ready
                    ? "Chọn bản clone + model → nghe thử → lưu"
                    : "Cần clone xong mới dùng được"}
                </Text>
              </Pressable>
              <Pressable style={styles.action} onPress={() => go("renders")}>
                <Text style={styles.actionTitle}>Bản TTS đã tạo</Text>
                <Text style={styles.actionSub}>
                  Lịch sử các lần tạo từ text
                </Text>
              </Pressable>
            </View>
          </>
        )}
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
  personTitle: {
    flex: 1,
    fontFamily: fonts.display,
    fontSize: 22,
    color: colors.ink,
  },
  stickyLinks: { flexDirection: "row", alignItems: "center", gap: 14 },
  link: { fontSize: 14, fontWeight: "700", color: colors.brand },
  linkMuted: { fontSize: 13, fontWeight: "600", color: colors.inkSoft },
  chipsWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  statusLine: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.ink,
  },
  nextStep: {
    fontSize: 13,
    lineHeight: 18,
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
});
