import {
  AiUsageSummary,
  FamilySpace,
  IdentityProfile,
  SpaceRole,
  SpaceSettings,
  StewardshipStatus,
} from "@forever/api-client";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useLayoutEffect, useState } from "react";
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
import { useSpaceScreenOptions } from "@/lib/spaceHeader";
import { colors, fonts } from "@/lib/theme";

type SettingsTab = "account" | "space" | "ai";

const ROLE_CHOICES: Array<{ role: SpaceRole; label: string; help: string }> = [
  { role: "owner", label: "Quản trị", help: "Mời và gỡ người, giữ Voice DNA." },
  {
    role: "moderator",
    label: "Biên tập",
    help: "Duyệt điều nghe được và sửa trang kỷ niệm.",
  },
  { role: "member", label: "Thành viên", help: "Trò chuyện, thêm ký ức, nghe giọng." },
];

function roleLabel(role: string | undefined): string {
  return ROLE_CHOICES.find((r) => r.role === role)?.label ?? "Thành viên";
}

export default function SettingsScreen() {
  const { spaceId } = useLocalSearchParams<{ spaceId: string }>();
  const { api, user, signOut } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState<SettingsTab>("account");
  const [space, setSpace] = useState<FamilySpace | null>(null);
  const [settings, setSettings] = useState<SpaceSettings | null>(null);
  const [stewardship, setStewardship] = useState<StewardshipStatus | null>(null);
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [allIdentities, setAllIdentities] = useState<IdentityProfile[]>([]);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [adminBusy, setAdminBusy] = useState(false);
  const [linkingIdentityId, setLinkingIdentityId] = useState<string | null>(null);
  const [aiUsage, setAiUsage] = useState<AiUsageSummary | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const [usageDays, setUsageDays] = useState(30);

  useSpaceScreenOptions({
    spaceId,
    title: "Cài đặt",
    showSettings: false,
    backTitle: "Nhà",
  });

  const load = useCallback(async () => {
    if (!spaceId) return;
    setLoading(true);
    try {
      const [spaceRes, settingsRes, stewardRes, identityRes] = await Promise.all([
        api.getSpace(spaceId),
        api.getSpaceSettings(spaceId),
        api.getStewardship(spaceId),
        api.listIdentities(spaceId, true),
      ]);
      setSpace(spaceRes);
      setSettings(settingsRes);
      setStewardship(stewardRes);
      setAllIdentities(identityRes.identities);
    } catch (e) {
      Alert.alert("Lỗi", e instanceof Error ? e.message : "Không tải cài đặt.");
    } finally {
      setLoading(false);
    }
  }, [api, spaceId]);

  const loadUsage = useCallback(async () => {
    if (!spaceId) return;
    setUsageLoading(true);
    try {
      const res = await api.getAiUsage(spaceId, usageDays);
      setAiUsage(res);
    } catch (e) {
      Alert.alert("Lỗi", e instanceof Error ? e.message : "Không tải chi phí AI.");
    } finally {
      setUsageLoading(false);
    }
  }, [api, spaceId, usageDays]);

  useLayoutEffect(() => {
    load();
  }, [load]);

  useLayoutEffect(() => {
    if (tab === "ai" && settings?.can_edit) {
      void loadUsage();
    }
  }, [tab, settings?.can_edit, loadUsage]);

  const makeInvite = async () => {
    if (!spaceId) return;
    try {
      const invite = await api.createInvite(spaceId);
      setInviteCode(invite.code);
    } catch (e) {
      Alert.alert("Lỗi", e instanceof Error ? e.message : "Không tạo mã được.");
    }
  };

  const revokeInvite = async () => {
    if (!spaceId || !inviteCode) return;
    try {
      await api.revokeInvite(spaceId, inviteCode);
      setInviteCode(null);
      Alert.alert("Đã thu hồi", "Mã mời này không dùng được nữa.");
    } catch (e) {
      Alert.alert("Lỗi", e instanceof Error ? e.message : "Không thu hồi được.");
    }
  };

  const confirmRemoveMember = (member: { id: string; name: string }) => {
    if (!spaceId) return;
    Alert.alert(
      `Gỡ ${member.name}?`,
      "Họ mất quyền vào nhà này. Tin nhắn và ký ức họ đã đóng góp vẫn được giữ nguyên.",
      [
        { text: "Huỷ", style: "cancel" },
        {
          text: "Gỡ",
          style: "destructive",
          onPress: async () => {
            try {
              await api.removeMember(spaceId, member.id);
              await load();
            } catch (e) {
              Alert.alert(
                "Lỗi",
                e instanceof Error ? e.message : "Không gỡ được.",
              );
            }
          },
        },
      ],
    );
  };

  const changeRole = async (
    member: { id: string; name: string },
    role: SpaceRole,
  ) => {
    if (!spaceId) return;
    setAdminBusy(true);
    try {
      await api.setMemberRole(spaceId, member.id, role);
      await load();
    } catch (e) {
      Alert.alert("Lỗi", e instanceof Error ? e.message : "Không đổi được vai trò.");
    } finally {
      setAdminBusy(false);
    }
  };

  const linkAccount = async (identity: IdentityProfile, memberUserId: string) => {
    if (!spaceId) return;
    setAdminBusy(true);
    try {
      await api.linkIdentityUser(spaceId, identity.id, memberUserId);
      setLinkingIdentityId(null);
      await load();
    } catch (e) {
      Alert.alert("Lỗi", e instanceof Error ? e.message : "Không ghép được.");
    } finally {
      setAdminBusy(false);
    }
  };

  const confirmUnlink = (identity: IdentityProfile) => {
    if (!spaceId) return;
    Alert.alert(
      `Gỡ tài khoản khỏi ${identity.display_name}?`,
      "Hồ sơ và mọi ký ức giữ nguyên. Người đó thôi tự quản lý Voice DNA của hồ sơ này.",
      [
        { text: "Huỷ", style: "cancel" },
        {
          text: "Gỡ",
          style: "destructive",
          onPress: async () => {
            setAdminBusy(true);
            try {
              await api.unlinkIdentityUser(spaceId, identity.id);
              await load();
            } catch (e) {
              Alert.alert(
                "Lỗi",
                e instanceof Error ? e.message : "Không gỡ được.",
              );
            } finally {
              setAdminBusy(false);
            }
          },
        },
      ],
    );
  };

  const nominateMember = () => {
    if (!spaceId || !space?.members?.length) return;
    const candidates = space.members.filter((m) => m.id !== user?.id);
    if (!candidates.length) {
      Alert.alert(
        "Chưa có thành viên khác",
        "Mời người thân vào trước khi chỉ định kế nhiệm.",
      );
      return;
    }
    Alert.alert(
      "Chỉ định người giữ nhà kế nhiệm",
      "Chọn thành viên sẽ nhận quyền steward khi bạn trao / mất khả năng quản trị.",
      [
        ...candidates.map((m) => ({
          text: `${m.name}${m.handle ? ` (@${m.handle})` : ""}`,
          onPress: async () => {
            try {
              await api.nominateSuccessor(spaceId, m.id, "Chỉ định kế nhiệm Forever");
              await load();
              Alert.alert(
                "Đã đề cử",
                `${m.name} cần chấp nhận trên thiết bị của họ.`,
              );
            } catch (e) {
              Alert.alert("Lỗi", e instanceof Error ? e.message : "Không đề cử được.");
            }
          },
        })),
        { text: "Huỷ", style: "cancel" },
      ],
    );
  };

  const runArchive = async (
    identity: IdentityProfile,
    action: "archive" | "unarchive",
  ) => {
    if (!spaceId || archiveBusy) return;
    setArchiveBusy(true);
    try {
      if (action === "archive") {
        await api.archiveIdentity(spaceId, identity.id);
      } else {
        await api.unarchiveIdentity(spaceId, identity.id);
      }
      await load();
    } catch (e) {
      Alert.alert("Lỗi", e instanceof Error ? e.message : "Không thực hiện được.");
    } finally {
      setArchiveBusy(false);
    }
  };

  const confirmArchive = (identity: IdentityProfile) => {
    Alert.alert(
      `Lưu trữ ${identity.display_name}?`,
      "Hồ sơ sẽ ẩn khỏi Thư viện và Voice DNA. Không có gì bị xoá — bạn khôi phục lại bất cứ lúc nào.",
      [
        { text: "Huỷ", style: "cancel" },
        {
          text: "Lưu trữ",
          onPress: () => void runArchive(identity, "archive"),
        },
      ],
    );
  };

  const saveKey = async () => {
    if (!spaceId || saving) return;
    if (!settings?.can_edit) {
      Alert.alert("Không đủ quyền", "Chỉ Steward hoặc Owner mới đổi API key.");
      return;
    }
    setSaving(true);
    try {
      const res = await api.updateSpaceSettings(spaceId, {
        elevenlabs_api_key: apiKey.trim() || null,
      });
      setSettings(res);
      setApiKey("");
      Alert.alert(
        "Đã lưu",
        res.elevenlabs_api_key_set
          ? "ElevenLabs API key đã cập nhật."
          : "Đã xóa API key khỏi không gian này.",
      );
    } catch (e) {
      Alert.alert("Lỗi", e instanceof Error ? e.message : "Không lưu được.");
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

  const succession = stewardship?.succession;
  const iAmNominee = succession?.nominee?.id === user?.id;
  const isOwner = space?.role === "owner";
  const canArchive = isOwner || Boolean(stewardship?.is_steward);
  // Same tier the API gates role changes and account linking behind.
  const canAdmin = canArchive;
  // Mirrors `require_moderator_or_above` — who may tend the Identity Lock.
  const canEditLock =
    space?.role === "owner" ||
    space?.role === "moderator" ||
    Boolean(stewardship?.is_steward);
  const archivedIdentities = allIdentities.filter((i) => i.archived_at);
  const archivableIdentities = allIdentities.filter(
    (i) => !i.archived_at && !i.linked_user_id,
  );
  const editableIdentities = allIdentities.filter((i) => !i.archived_at);
  const members = space?.members ?? [];
  const memberById = new Map(members.map((m) => [m.id, m]));
  const linkableIdentities = allIdentities.filter(
    (i) => !i.archived_at && i.status === "living",
  );

  function formatUsd(value: number): string {
    if (value < 0.01 && value > 0) return "< $0.01";
    return `$${value.toFixed(2)}`;
  }

  return (
    <ScrollView contentContainerStyle={styles.root}>
      <View style={styles.tabs}>
        <Pressable
          style={[styles.tab, tab === "account" && styles.tabActive]}
          onPress={() => setTab("account")}
        >
          <Text style={[styles.tabText, tab === "account" && styles.tabTextActive]}>
            Tài khoản
          </Text>
        </Pressable>
        <Pressable
          style={[styles.tab, tab === "space" && styles.tabActive]}
          onPress={() => setTab("space")}
        >
          <Text style={[styles.tabText, tab === "space" && styles.tabTextActive]}>
            Nhà
          </Text>
        </Pressable>
        {settings?.can_edit ? (
          <Pressable
            style={[styles.tab, tab === "ai" && styles.tabActive]}
            onPress={() => setTab("ai")}
          >
            <Text style={[styles.tabText, tab === "ai" && styles.tabTextActive]}>
              Chi phí AI
            </Text>
          </Pressable>
        ) : null}
      </View>

      {tab === "account" ? (
        <>
          <Text style={styles.section}>Đăng nhập</Text>
          <View style={styles.card}>
            <Text style={styles.label}>Tên</Text>
            <Text style={styles.value}>{user?.name ?? "—"}</Text>
            <Text style={[styles.label, { marginTop: 12 }]}>Email</Text>
            <Text style={styles.value}>{user?.email ?? "—"}</Text>
            {user?.handle ? (
              <>
                <Text style={[styles.label, { marginTop: 12 }]}>Handle</Text>
                <Text style={styles.value}>@{user.handle}</Text>
              </>
            ) : null}
          </View>
          <Pressable
            style={styles.btnGhost}
            onPress={() => {
              Alert.alert("Thoát?", "Bạn sẽ đăng xuất khỏi Forever.", [
                { text: "Huỷ", style: "cancel" },
                {
                  text: "Thoát",
                  style: "destructive",
                  onPress: () => void signOut(),
                },
              ]);
            }}
          >
            <Text style={styles.btnGhostText}>Thoát</Text>
          </Pressable>
          <Text style={styles.section}>Về Forever</Text>
          <Pressable
            style={styles.philosophyLink}
            onPress={() => router.push("/settings/philosophy")}
          >
            <View style={styles.philosophyLinkMain}>
              <Text style={styles.philosophyLinkTitle}>Triết lý Forever</Text>
              <Text style={styles.philosophyLinkSub}>
                Vì sao app này tồn tại, và cam kết với gia đình bạn
              </Text>
            </View>
            <Text style={styles.philosophyChevron}>›</Text>
          </Pressable>
        </>
      ) : tab === "ai" ? (
        <>
          <Text style={styles.section}>Chi phí AI</Text>
          <Text style={styles.help}>
            Ước tính từ số lần gọi Gemini (LLM, STT) và TTS (ElevenLabs/MiniMax).
            Không phải hoá đơn thật.
          </Text>
          <View style={styles.row}>
            {[7, 30, 90].map((d) => (
              <Pressable
                key={d}
                style={[styles.chip, usageDays === d && styles.chipActive]}
                onPress={() => setUsageDays(d)}
              >
                <Text style={[styles.chipText, usageDays === d && styles.chipTextActive]}>
                  {d} ngày
                </Text>
              </Pressable>
            ))}
          </View>
          {usageLoading ? (
            <ActivityIndicator color={colors.brand} style={{ marginVertical: 24 }} />
          ) : aiUsage ? (
            <>
              <View style={styles.card}>
                <Text style={styles.label}>Tổng ước tính</Text>
                <Text style={styles.usageTotal}>
                  {formatUsd(aiUsage.totals.estimated_usd)}
                </Text>
                <Text style={styles.metaLine}>
                  {aiUsage.totals.calls} lần gọi · {aiUsage.period_days} ngày qua
                </Text>
              </View>

              {(aiUsage.totals.by_modality ?? []).length > 0 ? (
                <>
                  <Text style={styles.section}>Theo loại AI</Text>
                  <View style={styles.card}>
                    {aiUsage.totals.by_modality.map((row) => (
                      <View key={row.operation || row.label} style={styles.usageRow}>
                        <Text style={styles.usageRowLabel}>{row.label}</Text>
                        <Text style={styles.usageRowValue}>
                          {formatUsd(row.estimated_usd)} · {row.calls} lần
                        </Text>
                        {row.operation === "tts" && row.output_chars ? (
                          <Text style={styles.metaLine}>
                            {row.output_chars.toLocaleString()} ký tự
                          </Text>
                        ) : row.input_tokens || row.output_tokens ? (
                          <Text style={styles.metaLine}>
                            {row.input_tokens.toLocaleString()} token vào ·{" "}
                            {row.output_tokens.toLocaleString()} token ra
                          </Text>
                        ) : null}
                      </View>
                    ))}
                  </View>
                </>
              ) : null}

              {aiUsage.totals.by_service.length > 0 ? (
                <>
                  <Text style={styles.section}>Theo nhà cung cấp</Text>
                  <View style={styles.card}>
                    {aiUsage.totals.by_service.map((row) => (
                      <View key={row.service} style={styles.usageRow}>
                        <Text style={styles.usageRowLabel}>{row.label}</Text>
                        <Text style={styles.usageRowValue}>
                          {formatUsd(row.estimated_usd)} · {row.calls} lần
                        </Text>
                        {row.input_tokens || row.output_tokens ? (
                          <Text style={styles.metaLine}>
                            {row.input_tokens.toLocaleString()} token vào ·{" "}
                            {row.output_tokens.toLocaleString()} token ra
                          </Text>
                        ) : row.output_chars ? (
                          <Text style={styles.metaLine}>
                            {row.output_chars.toLocaleString()} ký tự TTS
                          </Text>
                        ) : null}
                      </View>
                    ))}
                  </View>
                </>
              ) : null}

              {aiUsage.totals.by_operation.length > 0 ? (
                <>
                  <Text style={styles.section}>Theo loại việc</Text>
                  <View style={styles.card}>
                    {aiUsage.totals.by_operation.map((row) => (
                      <View key={row.operation} style={styles.usageRow}>
                        <Text style={styles.usageRowLabel}>{row.label}</Text>
                        <Text style={styles.usageRowValue}>
                          {formatUsd(row.estimated_usd)} · {row.calls} lần
                        </Text>
                      </View>
                    ))}
                  </View>
                </>
              ) : null}

              {aiUsage.daily.length > 0 ? (
                <>
                  <Text style={styles.section}>Theo ngày</Text>
                  <View style={styles.card}>
                    {[...aiUsage.daily].reverse().slice(0, 14).map((day) => (
                      <View key={day.date} style={styles.usageRow}>
                        <Text style={styles.usageRowLabel}>{day.date}</Text>
                        <Text style={styles.usageRowValue}>
                          {formatUsd(day.estimated_usd)} · {day.calls} lần
                        </Text>
                      </View>
                    ))}
                  </View>
                </>
              ) : null}

              {aiUsage.totals.calls === 0 ? (
                <Text style={styles.help}>
                  Chưa có dữ liệu trong khoảng thời gian này. Thử chat giọng hoặc
                  gọi Bố — số liệu sẽ xuất hiện sau vài lượt.
                </Text>
              ) : null}

              <Text style={styles.footnote}>{aiUsage.disclaimer}</Text>
            </>
          ) : (
            <Text style={styles.help}>Chưa có dữ liệu chi phí.</Text>
          )}
        </>
      ) : (
        <>
      <Text style={styles.section}>Không gian</Text>
      <View style={styles.card}>
        <Text style={styles.value}>{space?.name ?? "—"}</Text>
        <Text style={styles.metaLine}>
          {space?.member_count ?? 0} thành viên
          {space?.role === "owner" ? " · Bạn quản trị" : ""}
        </Text>
        {stewardship?.steward ? (
          <Text style={styles.metaLine}>Steward: {stewardship.steward.name}</Text>
        ) : null}
      </View>

      {isOwner ? (
        <>
          <Text style={styles.section}>Mời gia đình</Text>
          <View style={styles.card}>
            <Text style={styles.help}>
              Tạo mã mời để con cháu tham gia không gian này (hết hạn sau 14 ngày).
            </Text>
            <Pressable style={styles.btnSecondary} onPress={makeInvite}>
              <Text style={styles.btnSecondaryText}>
                {inviteCode ? `Mã mời: ${inviteCode}` : "Tạo mã mời"}
              </Text>
            </Pressable>
            {inviteCode ? (
              <Pressable style={styles.smallBtnGhost} onPress={revokeInvite}>
                <Text style={styles.smallBtnGhostText}>Thu hồi mã này</Text>
              </Pressable>
            ) : null}
          </View>

        </>
      ) : null}

      {canAdmin ? (
        <>
          <Text style={styles.section}>Thành viên và vai trò</Text>
          <Text style={styles.help}>
            Biên tập viên duyệt điều nghe được từ phòng chung và sửa trang kỷ niệm.
            Điều ai đó nói riêng với người đã mất vẫn chỉ mình họ duyệt.
          </Text>
          <View style={styles.card}>
            {members.map((member) => {
              const isSteward = member.id === stewardship?.steward?.id;
              const isMe = member.id === user?.id;
              const locked = isSteward || isMe;
              return (
                <View key={member.id} style={styles.memberBlock}>
                  <View style={styles.archiveRow}>
                    <View style={styles.archiveRowMain}>
                      <Text style={styles.value}>{member.name}</Text>
                      <Text style={styles.metaLine}>
                        {member.email}
                        {isSteward ? " · Steward" : ""}
                        {isMe ? " · Bạn" : ""}
                      </Text>
                    </View>
                    {isOwner && !locked ? (
                      <Pressable
                        style={styles.smallBtnGhost}
                        onPress={() => confirmRemoveMember(member)}
                      >
                        <Text style={styles.smallBtnGhostText}>Gỡ</Text>
                      </Pressable>
                    ) : null}
                  </View>
                  {locked ? (
                    <Text style={styles.metaLine}>
                      {roleLabel(member.role)}
                      {isSteward
                        ? " · Người giữ nhà luôn là Quản trị"
                        : " · Không tự đổi vai trò của mình"}
                    </Text>
                  ) : (
                    <View style={styles.chipRow}>
                      {ROLE_CHOICES.map((choice) => {
                        const active = member.role === choice.role;
                        return (
                          <Pressable
                            key={choice.role}
                            style={[styles.chip, active && styles.chipActive]}
                            disabled={adminBusy || active}
                            onPress={() => void changeRole(member, choice.role)}
                          >
                            <Text
                              style={[
                                styles.chipText,
                                active && styles.chipTextActive,
                              ]}
                            >
                              {choice.label}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  )}
                </View>
              );
            })}
          </View>

          <Text style={styles.section}>Ghép tài khoản với hồ sơ</Text>
          <Text style={styles.help}>
            Nói cho Forever biết hồ sơ nào là người đang đăng nhập. Người được ghép
            sẽ tự thu và clone giọng của chính mình, không cần nhờ ai.
          </Text>
          <View style={styles.card}>
            {linkableIdentities.length ? (
              linkableIdentities.map((identity) => {
                const linked = identity.linked_user_id
                  ? memberById.get(identity.linked_user_id)
                  : undefined;
                const picking = linkingIdentityId === identity.id;
                const unlinked = members.filter(
                  (m) =>
                    !allIdentities.some(
                      (i) => i.id !== identity.id && i.linked_user_id === m.id,
                    ),
                );
                return (
                  <View key={identity.id} style={styles.memberBlock}>
                    <View style={styles.archiveRow}>
                      <View style={styles.archiveRowMain}>
                        <Text style={styles.value}>{identity.display_name}</Text>
                        <Text style={styles.metaLine}>
                          {identity.linked_user_id
                            ? `Đã ghép: ${linked?.name ?? "tài khoản đã rời nhà"}`
                            : identity.relation_label || "Chưa ghép tài khoản"}
                        </Text>
                      </View>
                      {identity.linked_user_id ? (
                        <Pressable
                          style={[
                            styles.smallBtnGhost,
                            adminBusy && styles.btnDisabled,
                          ]}
                          disabled={adminBusy}
                          onPress={() => confirmUnlink(identity)}
                        >
                          <Text style={styles.smallBtnGhostText}>Gỡ</Text>
                        </Pressable>
                      ) : (
                        <Pressable
                          style={[styles.smallBtn, adminBusy && styles.btnDisabled]}
                          disabled={adminBusy}
                          onPress={() =>
                            setLinkingIdentityId(picking ? null : identity.id)
                          }
                        >
                          <Text style={styles.smallBtnText}>
                            {picking ? "Đóng" : "Ghép"}
                          </Text>
                        </Pressable>
                      )}
                    </View>
                    {picking ? (
                      <View style={styles.chipRow}>
                        {unlinked.length ? (
                          unlinked.map((member) => (
                            <Pressable
                              key={member.id}
                              style={[styles.chip, adminBusy && styles.btnDisabled]}
                              disabled={adminBusy}
                              onPress={() => void linkAccount(identity, member.id)}
                            >
                              <Text style={styles.chipText}>{member.name}</Text>
                            </Pressable>
                          ))
                        ) : (
                          <Text style={styles.body}>
                            Mọi tài khoản đều đã ghép với một hồ sơ khác.
                          </Text>
                        )}
                      </View>
                    ) : null}
                  </View>
                );
              })
            ) : (
              <Text style={styles.body}>
                Chưa có hồ sơ người đang sống nào để ghép.
              </Text>
            )}
          </View>
        </>
      ) : null}

      {canEditLock ? (
        <>
          <Text style={styles.section}>Bản sắc</Text>
          <Text style={styles.help}>
            Khóa nhân dạng đằng sau giọng nói — giá trị sống, khẩu khí, cách xưng hô.
            Chỉ mở từ đây, không từ thư viện.
          </Text>
          <View style={styles.card}>
            {editableIdentities.length ? (
              editableIdentities.map((identity) => (
                <View key={identity.id} style={styles.archiveRow}>
                  <View style={styles.archiveRowMain}>
                    <Text style={styles.value}>{identity.display_name}</Text>
                    <Text style={styles.metaLine}>
                      {identity.relation_label ||
                        (identity.status === "remembered" ? "Ký ức" : "Đang sống")}
                      {identity.profile_reviewed_at ? " · Đã duyệt" : " · Chưa duyệt"}
                    </Text>
                  </View>
                  <Pressable
                    style={styles.smallBtn}
                    onPress={() =>
                      router.push(`/profile/${spaceId}/${identity.id}` as never)
                    }
                  >
                    <Text style={styles.smallBtnText}>Sửa</Text>
                  </Pressable>
                </View>
              ))
            ) : (
              <Text style={styles.body}>Chưa có hồ sơ nào để chỉnh.</Text>
            )}
          </View>
        </>
      ) : null}

      <Text style={styles.section}>Trường tồn · Steward</Text>
      <View style={styles.card}>
        {succession ? (
          <Text style={styles.body}>
            Đề cử: {succession.nominee.name}
            {succession.nominee.handle ? ` (@${succession.nominee.handle})` : ""} ·{" "}
            {succession.status}
          </Text>
        ) : (
          <Text style={styles.body}>
            Chưa có người kế nhiệm. Steward hiện tại giữ quyền quản trị không gian
            này.
          </Text>
        )}
        <View style={styles.row}>
          {stewardship?.is_steward ? (
            <>
              <Pressable style={styles.smallBtn} onPress={nominateMember}>
                <Text style={styles.smallBtnText}>Chỉ định kế nhiệm</Text>
              </Pressable>
              {succession && ["pending", "accepted"].includes(succession.status) ? (
                <Pressable
                  style={styles.smallBtnGhost}
                  onPress={async () => {
                    if (!spaceId) return;
                    await api.revokeSuccession(spaceId);
                    await load();
                  }}
                >
                  <Text style={styles.smallBtnGhostText}>Thu hồi</Text>
                </Pressable>
              ) : null}
            </>
          ) : null}
          {iAmNominee && succession?.status === "pending" ? (
            <>
              <Pressable
                style={styles.smallBtn}
                onPress={async () => {
                  if (!spaceId) return;
                  await api.acceptSuccession(spaceId);
                  await load();
                }}
              >
                <Text style={styles.smallBtnText}>Nhận kế nhiệm</Text>
              </Pressable>
              <Pressable
                style={styles.smallBtnGhost}
                onPress={async () => {
                  if (!spaceId) return;
                  await api.declineSuccession(spaceId);
                  await load();
                }}
              >
                <Text style={styles.smallBtnGhostText}>Từ chối</Text>
              </Pressable>
            </>
          ) : null}
          {succession?.status === "accepted" &&
          (iAmNominee || stewardship?.is_steward) ? (
            <Pressable
              style={styles.smallBtn}
              onPress={async () => {
                if (!spaceId) return;
                await api.activateSuccession(spaceId);
                await load();
                Alert.alert(
                  "Đã chuyển giao",
                  "Quyền steward / owner đã trao cho người kế nhiệm.",
                );
              }}
            >
              <Text style={styles.smallBtnText}>Kích hoạt chuyển giao</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      {canArchive ? (
        <>
          <Text style={styles.section}>Lưu trữ hồ sơ</Text>
          <Text style={styles.help}>
            Hồ sơ lưu trữ biến mất khỏi Thư viện và Voice DNA nhưng vẫn giữ nguyên
            ký ức, mẫu giọng và bản clone. Khôi phục lúc nào cũng được.
          </Text>
          <View style={styles.card}>
            <Text style={styles.label}>Đang hiện</Text>
            {archivableIdentities.length ? (
              archivableIdentities.map((identity) => (
                <View key={identity.id} style={styles.archiveRow}>
                  <View style={styles.archiveRowMain}>
                    <Text style={styles.value}>{identity.display_name}</Text>
                    <Text style={styles.metaLine}>
                      {identity.relation_label || "Chưa đặt quan hệ"}
                      {identity.status === "remembered" ? " · Ký ức" : ""}
                    </Text>
                  </View>
                  <Pressable
                    style={[styles.smallBtnGhost, archiveBusy && styles.btnDisabled]}
                    onPress={() => confirmArchive(identity)}
                    disabled={archiveBusy}
                  >
                    <Text style={styles.smallBtnGhostText}>Lưu trữ</Text>
                  </Pressable>
                </View>
              ))
            ) : (
              <Text style={styles.body}>
                Không có hồ sơ nào để lưu trữ.
              </Text>
            )}

            <Text style={[styles.label, { marginTop: 16 }]}>Đã lưu trữ</Text>
            {archivedIdentities.length ? (
              archivedIdentities.map((identity) => (
                <View key={identity.id} style={styles.archiveRow}>
                  <View style={styles.archiveRowMain}>
                    <Text style={styles.value}>{identity.display_name}</Text>
                    <Text style={styles.metaLine}>
                      {identity.relation_label || "Chưa đặt quan hệ"}
                    </Text>
                  </View>
                  <Pressable
                    style={[styles.smallBtn, archiveBusy && styles.btnDisabled]}
                    onPress={() => void runArchive(identity, "unarchive")}
                    disabled={archiveBusy}
                  >
                    <Text style={styles.smallBtnText}>Khôi phục</Text>
                  </Pressable>
                </View>
              ))
            ) : (
              <Text style={styles.body}>Chưa có hồ sơ nào được lưu trữ.</Text>
            )}
          </View>
        </>
      ) : null}

      <Text style={styles.section}>Voice DNA · ElevenLabs</Text>
      <Text style={styles.help}>
        Key dùng để clone giọng và TTS trong không gian này. Chỉ Steward / Owner
        được sửa. Key không hiện lại đầy đủ sau khi lưu.
      </Text>

      <View style={styles.card}>
        <Text style={styles.label}>Trạng thái</Text>
        <Text style={styles.value}>
          {settings?.elevenlabs_api_key_set
            ? `Đã cấu hình${settings.elevenlabs_api_key_hint ? ` ${settings.elevenlabs_api_key_hint}` : ""}`
            : "Chưa có API key"}
        </Text>

        {settings?.can_edit ? (
          <>
            <Text style={[styles.label, { marginTop: 16 }]}>API key mới</Text>
            <TextInput
              style={styles.input}
              value={apiKey}
              onChangeText={setApiKey}
              placeholder="sk_… (để trống rồi Lưu để xóa)"
              placeholderTextColor={colors.inkSoft}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
            />
            <Pressable
              style={[styles.btn, saving && styles.btnDisabled]}
              onPress={saveKey}
              disabled={saving}
            >
              <Text style={styles.btnText}>
                {saving ? "Đang lưu…" : "Lưu API key"}
              </Text>
            </Pressable>
          </>
        ) : (
          <Text style={styles.locked}>
            Bạn chỉ xem được trạng thái. Nhờ Steward nhập key nếu cần Voice DNA.
          </Text>
        )}
      </View>

      <Text style={styles.footnote}>
        Lấy key tại elevenlabs.io → Profile → API Keys. Gói Starter trở lên để
        Instant Voice Clone qua API.
      </Text>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bg,
  },
  root: { padding: 20, gap: 12, paddingBottom: 40, backgroundColor: colors.bg },
  tabs: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 8,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: "center",
    backgroundColor: colors.card,
  },
  tabActive: {
    borderColor: colors.brand,
    backgroundColor: "rgba(45, 74, 62, 0.08)",
  },
  tabText: { fontSize: 14, fontWeight: "600", color: colors.inkSoft },
  tabTextActive: { color: colors.brand },
  section: {
    fontFamily: fonts.display,
    fontSize: 22,
    color: colors.ink,
    marginBottom: 4,
    marginTop: 4,
  },
  help: { fontSize: 14, lineHeight: 20, color: colors.inkSoft, marginBottom: 4 },
  card: {
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.line,
    gap: 8,
  },
  label: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.inkSoft,
    textTransform: "uppercase",
  },
  value: { fontSize: 16, fontWeight: "600", color: colors.ink },
  metaLine: { fontSize: 14, color: colors.inkSoft, lineHeight: 20 },
  body: { fontSize: 14, color: colors.inkSoft, lineHeight: 20 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  smallBtn: {
    backgroundColor: colors.brand,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  smallBtnText: { color: "#f4efe6", fontWeight: "600", fontSize: 13 },
  smallBtnGhost: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: colors.line,
  },
  smallBtnGhostText: { color: colors.brand, fontWeight: "600", fontSize: 13 },
  archiveRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  archiveRowMain: { flex: 1, gap: 2 },
  memberBlock: { paddingBottom: 8 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingTop: 4 },
  chip: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: "#fff",
  },
  chipActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipText: { fontSize: 13, fontWeight: "600", color: colors.inkSoft },
  chipTextActive: { color: "#f4efe6" },
  btnSecondary: {
    alignSelf: "flex-start",
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: colors.brand,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginTop: 4,
  },
  btnSecondaryText: { color: colors.brand, fontWeight: "700", fontSize: 14 },
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
  btn: {
    marginTop: 8,
    backgroundColor: colors.brand,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  btnGhost: {
    marginTop: 4,
    borderWidth: 1,
    borderColor: colors.brand,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  btnGhostText: { color: colors.brand, fontWeight: "700", fontSize: 15 },
  locked: { marginTop: 8, fontSize: 14, color: colors.inkSoft, lineHeight: 20 },
  footnote: { fontSize: 12, color: colors.inkSoft, lineHeight: 18, marginTop: 4 },
  philosophyLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 16,
  },
  philosophyLinkMain: { flex: 1, gap: 4 },
  philosophyLinkTitle: {
    fontFamily: fonts.display,
    fontSize: 18,
    color: colors.ink,
  },
  philosophyLinkSub: { fontSize: 14, lineHeight: 20, color: colors.inkSoft },
  philosophyChevron: {
    fontSize: 24,
    fontWeight: "600",
    color: colors.inkSoft,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
  },
  chipActive: {
    borderColor: colors.brand,
    backgroundColor: "rgba(45, 74, 62, 0.08)",
  },
  chipText: { fontSize: 13, fontWeight: "600", color: colors.inkSoft },
  chipTextActive: { color: colors.brand },
  usageTotal: {
    fontFamily: fonts.display,
    fontSize: 32,
    color: colors.ink,
    marginTop: 4,
  },
  usageRow: {
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    gap: 2,
  },
  usageRowLabel: { fontSize: 15, fontWeight: "600", color: colors.ink },
  usageRowValue: { fontSize: 14, color: colors.inkSoft },
});
