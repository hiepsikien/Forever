import {
  AiUsageSummary,
  FamilySpace,
  IdentityProfile,
  SpaceRole,
  SpaceSettings,
  StewardshipStatus,
} from "@forever/api-client";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useLayoutEffect, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";

import { useAuth } from "@/lib/auth";
import {
  isLoginMirror,
  LIVING_RELATIONS_TO_REMEMBERED,
  relationRelativeLine,
  relationToRememberedPrompt,
} from "@/lib/identityDisplay";
import { useSpaceScreenOptions } from "@/lib/spaceHeader";
import { colors, fonts } from "@/lib/theme";

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

function familyProfileForUser(
  identities: IdentityProfile[],
  userId: string,
): IdentityProfile | undefined {
  return identities.find(
    (i) =>
      !i.archived_at && i.linked_user_id === userId && !isLoginMirror(i),
  );
}

function formatUsd(value: number): string {
  if (value < 0.01 && value > 0) return "< $0.01";
  return `$${value.toFixed(2)}`;
}

function Disclosure({
  title,
  subtitle,
  open,
  onToggle,
  children,
}: {
  title: string;
  subtitle?: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <View style={styles.disclosureCard}>
      <Pressable
        onPress={onToggle}
        style={styles.disclosureHead}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
      >
        <View style={styles.disclosureMain}>
          <Text style={styles.disclosureTitle}>{title}</Text>
          {subtitle ? (
            <Text style={styles.disclosureSub}>{subtitle}</Text>
          ) : null}
        </View>
        <Text style={styles.disclosureChevron}>{open ? "▲" : "▼"}</Text>
      </Pressable>
      {open ? <View style={styles.disclosureBody}>{children}</View> : null}
    </View>
  );
}

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statCell}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
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
  const [linkingMemberId, setLinkingMemberId] = useState<string | null>(null);
  const [mirrorsOpen, setMirrorsOpen] = useState(false);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [successionOpen, setSuccessionOpen] = useState(false);
  const [aiUsage, setAiUsage] = useState<AiUsageSummary | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const [usageDays, setUsageDays] = useState(30);
  const [pipelineBusyKey, setPipelineBusyKey] = useState<string | null>(null);
  const [costOpen, setCostOpen] = useState(false);
  const [costTablesOpen, setCostTablesOpen] = useState(false);
  const [modelsOpen, setModelsOpen] = useState(false);
  const [voiceKeyOpen, setVoiceKeyOpen] = useState(false);
  const [addingLivingFor, setAddingLivingFor] = useState<string | null>(null);
  const [newLivingName, setNewLivingName] = useState("");
  const [newLivingRelation, setNewLivingRelation] = useState("Con");

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
      Alert.alert("Lỗi", e instanceof Error ? e.message : "Không tải số liệu AI.");
    } finally {
      setUsageLoading(false);
    }
  }, [api, spaceId, usageDays]);

  const togglePipelineFlag = async (key: string, enabled: boolean) => {
    if (!spaceId || !settings?.can_edit || pipelineBusyKey) return;
    setPipelineBusyKey(key);
    try {
      const res = await api.updateSpaceSettings(spaceId, {
        heritage_pipeline: { flags: { [key]: enabled } },
      });
      setSettings(res);
    } catch (e) {
      Alert.alert(
        "Lỗi",
        e instanceof Error ? e.message : "Không lưu được cờ luồng AI.",
      );
    } finally {
      setPipelineBusyKey(null);
    }
  };

  const resetPipelineFlag = async (key: string) => {
    if (!spaceId || !settings?.can_edit || pipelineBusyKey) return;
    setPipelineBusyKey(key);
    try {
      const res = await api.updateSpaceSettings(spaceId, {
        heritage_pipeline: { flags: { [key]: null } },
      });
      setSettings(res);
    } catch (e) {
      Alert.alert(
        "Lỗi",
        e instanceof Error ? e.message : "Không đặt lại được.",
      );
    } finally {
      setPipelineBusyKey(null);
    }
  };

  const setPipelineModel = async (key: string, model: string) => {
    if (!spaceId || !settings?.can_edit || pipelineBusyKey) return;
    setPipelineBusyKey(`model:${key}`);
    try {
      const res = await api.updateSpaceSettings(spaceId, {
        heritage_pipeline: { models: { [key]: model } },
      });
      setSettings(res);
    } catch (e) {
      Alert.alert(
        "Lỗi",
        e instanceof Error ? e.message : "Không đổi được model.",
      );
    } finally {
      setPipelineBusyKey(null);
    }
  };

  const resetPipelineModel = async (key: string) => {
    if (!spaceId || !settings?.can_edit || pipelineBusyKey) return;
    setPipelineBusyKey(`model:${key}`);
    try {
      const res = await api.updateSpaceSettings(spaceId, {
        heritage_pipeline: { models: { [key]: null } },
      });
      setSettings(res);
    } catch (e) {
      Alert.alert(
        "Lỗi",
        e instanceof Error ? e.message : "Không đặt lại được.",
      );
    } finally {
      setPipelineBusyKey(null);
    }
  };

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
    const occupying = allIdentities.find(
      (i) => i.linked_user_id === memberUserId && i.id !== identity.id,
    );
    const memberName =
      space?.members.find((m) => m.id === memberUserId)?.name ?? "tài khoản này";
    const doLink = async () => {
      setAdminBusy(true);
      try {
        if (occupying) {
          await api.unlinkIdentityUser(spaceId, occupying.id);
        }
        await api.linkIdentityUser(spaceId, identity.id, memberUserId);
        setLinkingMemberId(null);
        await load();
      } catch (e) {
        Alert.alert("Lỗi", e instanceof Error ? e.message : "Không ghép được.");
      } finally {
        setAdminBusy(false);
      }
    };
    if (!occupying) {
      await doLink();
      return;
    }
    const body = isLoginMirror(occupying)
      ? `${memberName} đang gắn với gương đăng nhập «${occupying.display_name}» — Forever tự tạo khi vào nhà, không phải hồ sơ gia đình. Gỡ gương đó rồi ghép với «${identity.display_name}». Voice DNA trên gương cũ không tự chuyển sang.`
      : `${memberName} đang gắn với hồ sơ «${occupying.display_name}». Gỡ rồi ghép với «${identity.display_name}». Voice DNA trên hồ sơ cũ không tự chuyển sang.`;
    Alert.alert(`Ghép với ${identity.display_name}?`, body, [
      { text: "Huỷ", style: "cancel" },
      { text: "Ghép", onPress: () => void doLink() },
    ]);
  };

  const createLivingProfile = async (attachToMemberId?: string) => {
    if (!spaceId) return;
    const name = newLivingName.trim();
    if (!name) {
      Alert.alert("Thiếu tên", "Đặt tên người, ví dụ Nguyễn Đình Anh.");
      return;
    }
    setAdminBusy(true);
    try {
      const row = await api.createIdentity(spaceId, {
        display_name: name,
        relation_label: newLivingRelation.trim(),
        status: "living",
      });
      setNewLivingName("");
      setAddingLivingFor(null);
      await load();
      if (attachToMemberId) {
        await linkAccount(row, attachToMemberId);
      }
    } catch (e) {
      Alert.alert("Lỗi", e instanceof Error ? e.message : "Không tạo hồ sơ.");
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
  const familyIdentities = allIdentities.filter(
    (i) => !i.archived_at && !isLoginMirror(i),
  );
  const mirrorIdentities = allIdentities.filter(
    (i) => !i.archived_at && isLoginMirror(i),
  );
  const livingFamilyIdentities = familyIdentities.filter(
    (i) => i.status === "living",
  );
  const rememberedAnchor =
    familyIdentities.find((i) => i.status === "remembered") ?? null;
  const members = space?.members ?? [];
  const memberById = new Map(members.map((m) => [m.id, m]));
  const successionPendingForMe =
    iAmNominee && succession?.status === "pending";

  const livingForm = (attachToMemberId?: string) => (
    <View style={styles.livingForm}>
      <Text style={styles.help}>
        {relationToRememberedPrompt(rememberedAnchor)}. Không phải với tài khoản
        quản trị. Bạn đời = Vợ. Con cái = Con. Đừng dùng Anh/Chị/Mẹ — mỗi người
        nhìn một kiểu.
      </Text>
      <TextInput
        style={styles.input}
        value={newLivingName}
        onChangeText={setNewLivingName}
        placeholder="Tên — ví dụ Nguyễn Đình Anh"
        placeholderTextColor={colors.inkSoft}
      />
      <View style={styles.chipRow}>
        {LIVING_RELATIONS_TO_REMEMBERED.map((rel) => {
          const active = newLivingRelation === rel;
          return (
            <Pressable
              key={rel}
              style={[styles.chip, active && styles.chipActive]}
              onPress={() => setNewLivingRelation(rel)}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>
                {rel}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <View style={styles.chipRow}>
        <Pressable
          style={[styles.smallBtn, adminBusy && styles.btnDisabled]}
          disabled={adminBusy}
          onPress={() => void createLivingProfile(attachToMemberId)}
        >
          <Text style={styles.smallBtnText}>
            {attachToMemberId ? "Tạo và gắn" : "Tạo hồ sơ"}
          </Text>
        </Pressable>
        <Pressable
          style={styles.smallBtnGhost}
          onPress={() => {
            setAddingLivingFor(null);
            setNewLivingName("");
          }}
        >
          <Text style={styles.smallBtnGhostText}>Huỷ</Text>
        </Pressable>
      </View>
    </View>
  );

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
              AI
            </Text>
          </Pressable>
        ) : null}
      </View>

      {tab === "account" ? (
        <>
          <View style={styles.card}>
            <Text style={styles.accountName}>{user?.name ?? "—"}</Text>
            {user?.email ? (
              <Text style={styles.accountMeta}>{user.email}</Text>
            ) : null}
            <Pressable
              onPress={() => {
                Alert.alert(
                  "Đăng xuất?",
                  "Bạn sẽ cần email và mật khẩu để vào lại Forever.",
                  [
                    { text: "Huỷ", style: "cancel" },
                    {
                      text: "Đăng xuất",
                      style: "destructive",
                      onPress: () => void signOut(),
                    },
                  ],
                );
              }}
              hitSlop={8}
              style={styles.signOutHit}
            >
              <Text style={styles.signOutText}>Đăng xuất</Text>
            </Pressable>
          </View>
          <Pressable
            style={styles.philosophyLink}
            onPress={() => router.navigate("/")}
          >
            <View style={styles.philosophyLinkMain}>
              <Text style={styles.philosophyLinkTitle}>Mái nhà Forever</Text>
              <Text style={styles.philosophyLinkSub}>
                Chọn nhà, tạo nhà mới, hoặc nhập mã mời
              </Text>
            </View>
            <Text style={styles.philosophyChevron}>›</Text>
          </Pressable>
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
          <Text style={styles.section}>Nhà dùng</Text>
          <Text style={styles.help}>
            Lượt người sống nói với ký ức trên API này. Không khóa ai — thấy nhiều
            thì gọi người thật.
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
            <ActivityIndicator color={colors.brand} style={{ marginVertical: 16 }} />
          ) : aiUsage ? (
            <>
              <View style={styles.statGrid}>
                <StatCell
                  label="Lượt nói"
                  value={String(aiUsage.presence?.user_turns ?? 0)}
                />
                <StatCell
                  label="Gọi giọng"
                  value={String(aiUsage.presence?.voice_turns ?? 0)}
                />
                <StatCell
                  label="Nhớ thương"
                  value={String(aiUsage.presence?.grief_replies ?? 0)}
                />
                <StatCell
                  label="Ước tính"
                  value={formatUsd(aiUsage.totals.estimated_usd)}
                />
              </View>
              {aiUsage.presence?.notice ? (
                <Text style={styles.presenceNotice}>{aiUsage.presence.notice}</Text>
              ) : null}
              {(aiUsage.presence?.members ?? []).length > 0 ? (
                <View style={styles.card}>
                  {aiUsage.presence!.members.map((row) => (
                    <View key={row.user_id} style={styles.memberUsageRow}>
                      <Text style={styles.usageRowLabel}>{row.name}</Text>
                      <Text style={styles.usageRowValue}>
                        {row.user_turns} lượt · {row.voice_turns} gọi
                      </Text>
                    </View>
                  ))}
                </View>
              ) : null}

              <Disclosure
                title="Chi phí chi tiết"
                subtitle={`${aiUsage.totals.calls} lần gọi API · không phải hoá đơn`}
                open={costOpen}
                onToggle={() => setCostOpen((v) => !v)}
              >
                {(aiUsage.totals.by_modality ?? []).length > 0 ? (
                  <View style={styles.nestedBlock}>
                    <Text style={styles.nestedLabel}>Theo loại</Text>
                    {aiUsage.totals.by_modality.map((row) => (
                      <View
                        key={row.operation || row.label}
                        style={styles.memberUsageRow}
                      >
                        <Text style={styles.usageRowLabel}>{row.label}</Text>
                        <Text style={styles.usageRowValue}>
                          {formatUsd(row.estimated_usd)} · {row.calls} lần
                        </Text>
                      </View>
                    ))}
                  </View>
                ) : null}
                {aiUsage.totals.by_service.length > 0 ? (
                  <View style={styles.nestedBlock}>
                    <Text style={styles.nestedLabel}>Theo nhà cung cấp</Text>
                    {aiUsage.totals.by_service.map((row) => (
                      <View key={row.service} style={styles.memberUsageRow}>
                        <Text style={styles.usageRowLabel}>{row.label}</Text>
                        <Text style={styles.usageRowValue}>
                          {formatUsd(row.estimated_usd)} · {row.calls} lần
                        </Text>
                      </View>
                    ))}
                  </View>
                ) : null}
                <Pressable
                  onPress={() => setCostTablesOpen((v) => !v)}
                  style={styles.innerToggle}
                >
                  <Text style={styles.pipelineReset}>
                    {costTablesOpen ? "Ẩn bảng kỹ thuật" : "Bảng kỹ thuật →"}
                  </Text>
                </Pressable>
                {costTablesOpen ? (
                  <>
                    {aiUsage.totals.by_operation.length > 0 ? (
                      <View style={styles.nestedBlock}>
                        <Text style={styles.nestedLabel}>Theo việc</Text>
                        {aiUsage.totals.by_operation.map((row) => (
                          <View key={row.operation} style={styles.memberUsageRow}>
                            <Text style={styles.usageRowLabel}>{row.label}</Text>
                            <Text style={styles.usageRowValue}>
                              {formatUsd(row.estimated_usd)} · {row.calls} lần
                            </Text>
                          </View>
                        ))}
                      </View>
                    ) : null}
                    {aiUsage.daily.length > 0 ? (
                      <View style={styles.nestedBlock}>
                        <Text style={styles.nestedLabel}>Theo ngày</Text>
                        {[...aiUsage.daily].reverse().slice(0, 14).map((day) => (
                          <View key={day.date} style={styles.memberUsageRow}>
                            <Text style={styles.usageRowLabel}>{day.date}</Text>
                            <Text style={styles.usageRowValue}>
                              {formatUsd(day.estimated_usd)} · {day.calls} lần
                            </Text>
                          </View>
                        ))}
                      </View>
                    ) : null}
                    {aiUsage.totals.by_modality.map((row) =>
                      row.input_tokens || row.output_tokens || row.output_chars ? (
                        <Text key={`tok-${row.operation}`} style={styles.footnote}>
                          {row.label}:{" "}
                          {row.operation === "tts" && row.output_chars
                            ? `${row.output_chars.toLocaleString()} ký tự`
                            : `${(row.input_tokens || 0).toLocaleString()} token vào · ${(row.output_tokens || 0).toLocaleString()} token ra`}
                        </Text>
                      ) : null,
                    )}
                  </>
                ) : null}
                {aiUsage.totals.calls === 0 ? (
                  <Text style={styles.help}>
                    Chưa có lần gọi AI trong khoảng này.
                  </Text>
                ) : null}
                <Text style={styles.footnote}>{aiUsage.disclaimer}</Text>
              </Disclosure>
            </>
          ) : (
            <Text style={styles.help}>Chưa có số liệu.</Text>
          )}

          <Text style={[styles.section, { marginTop: 24 }]}>Luồng ký ức</Text>
          <Text style={styles.help}>
            Bật/tắt từng bước khi ký ức trả lời. Chỉ nhà này.
          </Text>
          <View style={styles.card}>
            {(settings?.heritage_pipeline?.flags ?? []).map((flag, index, arr) => {
              const busy = pipelineBusyKey === flag.key;
              return (
                <View
                  key={flag.key}
                  style={[
                    styles.pipelineRow,
                    index < arr.length - 1 && styles.pipelineRowBorder,
                  ]}
                >
                  <View style={styles.pipelineMain}>
                    <Text style={styles.pipelineLabel}>{flag.label}</Text>
                    <Text style={styles.pipelineHelp} numberOfLines={2}>
                      {flag.help}
                    </Text>
                    {flag.overridden ? (
                      <Pressable
                        onPress={() => void resetPipelineFlag(flag.key)}
                        disabled={busy}
                        hitSlop={6}
                      >
                        <Text style={styles.pipelineReset}>Theo server →</Text>
                      </Pressable>
                    ) : null}
                  </View>
                  <Switch
                    value={flag.enabled}
                    onValueChange={(v) => void togglePipelineFlag(flag.key, v)}
                    disabled={busy || !settings?.can_edit}
                    trackColor={{
                      false: colors.line,
                      true: "rgba(45, 74, 62, 0.45)",
                    }}
                    thumbColor={flag.enabled ? colors.brand : "#f4efe6"}
                  />
                </View>
              );
            })}
          </View>

          <View style={{ marginTop: 16 }}>
            <Disclosure
              title="Model Gemini"
              subtitle="Chỉ khi cần đổi Lite / Flash cho từng bước"
              open={modelsOpen}
              onToggle={() => setModelsOpen((v) => !v)}
            >
              {(settings?.heritage_pipeline?.models ?? []).map((row, index, arr) => {
                const busy = pipelineBusyKey === `model:${row.key}`;
                const choices = settings?.heritage_pipeline?.model_choices ?? [];
                return (
                  <View
                    key={row.key}
                    style={[
                      styles.pipelineRow,
                      { flexDirection: "column", alignItems: "stretch" },
                      index < arr.length - 1 && styles.pipelineRowBorder,
                    ]}
                  >
                    <Text style={styles.pipelineLabel}>{row.label}</Text>
                    <Text style={styles.pipelineHelp}>{row.help}</Text>
                    <View style={styles.chipRow}>
                      {choices.map((choice) => {
                        const active = row.model === choice.id;
                        return (
                          <Pressable
                            key={choice.id}
                            style={[styles.chip, active && styles.chipActive]}
                            disabled={busy || !settings?.can_edit}
                            onPress={() => void setPipelineModel(row.key, choice.id)}
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
                    {row.overridden ? (
                      <Pressable
                        onPress={() => void resetPipelineModel(row.key)}
                        disabled={busy}
                        hitSlop={6}
                      >
                        <Text style={styles.pipelineReset}>Theo server →</Text>
                      </Pressable>
                    ) : null}
                  </View>
                );
              })}
              {settings?.heritage_pipeline?.note ? (
                <Text style={styles.footnote}>{settings.heritage_pipeline.note}</Text>
              ) : null}
            </Disclosure>
          </View>

          <View style={{ marginTop: 16 }}>
            <Disclosure
              title="Key ElevenLabs"
              subtitle={
                settings?.elevenlabs_api_key_set
                  ? `Đã có key${settings.elevenlabs_api_key_hint ? ` ${settings.elevenlabs_api_key_hint}` : ""}`
                  : "Cần để clone giọng và TTS"
              }
              open={voiceKeyOpen}
              onToggle={() => setVoiceKeyOpen((v) => !v)}
            >
              <Text style={styles.help}>
                Chỉ Steward / Quản trị sửa. Key không hiện lại đầy đủ sau khi lưu.
              </Text>
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
              <Text style={styles.footnote}>
                Lấy key tại elevenlabs.io → Profile → API Keys. Gói Starter trở lên
                để Instant Voice Clone qua API.
              </Text>
            </Disclosure>
          </View>
        </>
      ) : (
        <>
          <Text style={styles.section}>Nhà này</Text>
          <View style={styles.card}>
            <Text style={styles.value}>{space?.name ?? "—"}</Text>
            <Text style={styles.metaLine}>
              {members.length} tài khoản · Bạn: {roleLabel(space?.role)}
              {stewardship?.steward
                ? ` · Người giữ nhà: ${stewardship.steward.name}`
                : ""}
            </Text>
            {isOwner ? (
              <>
                <Text style={styles.help}>
                  Mã mời hết hạn sau 14 ngày. Người mới vào nhà chưa gắn với hồ sơ
                  Thư viện — ghép ở danh sách tài khoản bên dưới.
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
              </>
            ) : null}
          </View>

          {canAdmin ? (
            <>
              <Text style={styles.section}>Tài khoản vào nhà</Text>
              <Text style={styles.help}>
                Tài khoản đăng nhập khác hồ sơ người. Hồ sơ sống ghi quan hệ với
                người đã mất (Vợ, Con, Cháu) — không với chủ nhà.
              </Text>
              <View style={styles.card}>
                {members.map((member) => {
                  const isSteward = member.id === stewardship?.steward?.id;
                  const isMe = member.id === user?.id;
                  const locked = isSteward || isMe;
                  const family = familyProfileForUser(allIdentities, member.id);
                  const picking = linkingMemberId === member.id;
                  return (
                    <View key={member.id} style={styles.memberBlock}>
                      <View style={styles.archiveRow}>
                        <View style={styles.archiveRowMain}>
                          <Text style={styles.value}>{member.name}</Text>
                          <Text style={styles.metaLine}>
                            {member.email}
                            {isSteward ? " · Người giữ nhà" : ""}
                            {isMe ? " · Bạn" : ""}
                          </Text>
                          <Text style={styles.metaLine}>
                            {family
                              ? `Hồ sơ: ${family.display_name}${
                                  relationRelativeLine(family, rememberedAnchor)
                                    ? ` · ${relationRelativeLine(family, rememberedAnchor)}`
                                    : ""
                                }`
                              : "Chưa gắn hồ sơ gia đình"}
                          </Text>
                        </View>
                        {isOwner && !locked ? (
                          <Pressable
                            style={styles.smallBtnGhost}
                            onPress={() => confirmRemoveMember(member)}
                          >
                            <Text style={styles.smallBtnGhostText}>Gỡ khỏi nhà</Text>
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
                      <View style={styles.chipRow}>
                        <Pressable
                          style={[styles.smallBtn, adminBusy && styles.btnDisabled]}
                          disabled={adminBusy}
                          onPress={() => {
                            if (picking) {
                              setLinkingMemberId(null);
                              setAddingLivingFor(null);
                              return;
                            }
                            setLinkingMemberId(member.id);
                            if (!livingFamilyIdentities.length) {
                              setAddingLivingFor(member.id);
                            }
                          }}
                        >
                          <Text style={styles.smallBtnText}>
                            {picking ? "Đóng" : family ? "Đổi hồ sơ" : "Gắn hồ sơ"}
                          </Text>
                        </Pressable>
                        {family ? (
                          <Pressable
                            style={[
                              styles.smallBtnGhost,
                              adminBusy && styles.btnDisabled,
                            ]}
                            disabled={adminBusy}
                            onPress={() => confirmUnlink(family)}
                          >
                            <Text style={styles.smallBtnGhostText}>Bỏ gắn</Text>
                          </Pressable>
                        ) : null}
                      </View>
                      {picking ? (
                        <View style={{ gap: 8 }}>
                          <View style={styles.chipRow}>
                            {livingFamilyIdentities.map((ident) => {
                              const takenByOther = Boolean(
                                ident.linked_user_id &&
                                  ident.linked_user_id !== member.id,
                              );
                              const takenName = takenByOther
                                ? memberById.get(ident.linked_user_id ?? "")?.name
                                : undefined;
                              const selected = family?.id === ident.id;
                              return (
                                <Pressable
                                  key={ident.id}
                                  style={[
                                    styles.chip,
                                    selected && styles.chipActive,
                                    (adminBusy || takenByOther) && styles.btnDisabled,
                                  ]}
                                  disabled={adminBusy || takenByOther || selected}
                                  onPress={() => void linkAccount(ident, member.id)}
                                >
                                  <Text
                                    style={[
                                      styles.chipText,
                                      selected && styles.chipTextActive,
                                    ]}
                                  >
                                    {ident.display_name}
                                    {takenName ? ` · ${takenName}` : ""}
                                  </Text>
                                </Pressable>
                              );
                            })}
                            <Pressable
                              style={[
                                styles.chip,
                                addingLivingFor === member.id && styles.chipActive,
                              ]}
                              onPress={() =>
                                setAddingLivingFor(
                                  addingLivingFor === member.id ? null : member.id,
                                )
                              }
                            >
                              <Text
                                style={[
                                  styles.chipText,
                                  addingLivingFor === member.id &&
                                    styles.chipTextActive,
                                ]}
                              >
                                + Người sống
                              </Text>
                            </Pressable>
                          </View>
                          {addingLivingFor === member.id
                            ? livingForm(member.id)
                            : !livingFamilyIdentities.length ? (
                                <Text style={styles.body}>
                                  Chưa có hồ sơ người sống. Tạo với quan hệ Vợ /
                                  Con / Cháu của người đã mất, rồi gắn.
                                </Text>
                              ) : null}
                        </View>
                      ) : null}
                    </View>
                  );
                })}
              </View>
            </>
          ) : canEditLock ? null : (
            <Text style={styles.help}>
              Thành viên trò chuyện và thêm ký ức. Mời người, gắn hồ sơ và vai trò
              do Quản trị / người giữ nhà lo.
            </Text>
          )}

          {canEditLock || canArchive ? (
            <>
              <Text style={styles.section}>Hồ sơ Thư viện</Text>
              <Text style={styles.help}>
                Người gia đình nhớ họ. Người đang sống: quan hệ với người đã mất
                (Vợ, Con, Cháu). Người đã mất: cách cả nhà gọi (Bố). Không neo
                theo tài khoản quản trị.
              </Text>
              <View style={styles.card}>
                {familyIdentities.length ? (
                  familyIdentities.map((identity) => {
                    const linked = identity.linked_user_id
                      ? memberById.get(identity.linked_user_id)
                      : undefined;
                    return (
                      <View key={identity.id} style={styles.archiveRow}>
                        <View style={styles.archiveRowMain}>
                          <Text style={styles.value}>{identity.display_name}</Text>
                          <Text style={styles.metaLine}>
                            {identity.status === "remembered"
                              ? "Người đã mất"
                              : "Đang sống"}
                            {relationRelativeLine(identity, rememberedAnchor)
                              ? ` · ${relationRelativeLine(identity, rememberedAnchor)}`
                              : ""}
                            {canEditLock
                              ? identity.profile_reviewed_at
                                ? " · Bản sắc đã duyệt"
                                : " · Bản sắc chưa duyệt"
                              : ""}
                            {linked ? ` · Tài khoản ${linked.name}` : ""}
                          </Text>
                        </View>
                        {canEditLock ? (
                          <Pressable
                            style={styles.smallBtn}
                            onPress={() =>
                              router.push(
                                `/profile/${spaceId}/${identity.id}` as never,
                              )
                            }
                          >
                            <Text style={styles.smallBtnText}>Bản sắc</Text>
                          </Pressable>
                        ) : null}
                        {canArchive && !identity.linked_user_id ? (
                          <Pressable
                            style={[
                              styles.smallBtnGhost,
                              archiveBusy && styles.btnDisabled,
                            ]}
                            onPress={() => confirmArchive(identity)}
                            disabled={archiveBusy}
                          >
                            <Text style={styles.smallBtnGhostText}>Lưu trữ</Text>
                          </Pressable>
                        ) : null}
                      </View>
                    );
                  })
                ) : (
                  <Text style={styles.body}>
                    Chưa có hồ sơ gia đình. Thêm người đang sống bên dưới; người đã
                    mất thêm từ Voice DNA / Thổi hồn.
                  </Text>
                )}
                {canAdmin ? (
                  <>
                    <Pressable
                      style={[styles.smallBtn, { alignSelf: "flex-start" }]}
                      onPress={() =>
                        setAddingLivingFor(
                          addingLivingFor === "library" ? null : "library",
                        )
                      }
                    >
                      <Text style={styles.smallBtnText}>
                        {addingLivingFor === "library"
                          ? "Đóng"
                          : "Thêm người đang sống"}
                      </Text>
                    </Pressable>
                    {addingLivingFor === "library" ? livingForm() : null}
                  </>
                ) : null}
              </View>
            </>
          ) : null}

          {canAdmin && mirrorIdentities.length ? (
            <Disclosure
              title="Gương đăng nhập"
              subtitle="Forever tự tạo khi vào nhà — không phải hồ sơ gia đình"
              open={mirrorsOpen}
              onToggle={() => setMirrorsOpen((v) => !v)}
            >
              {mirrorIdentities.map((identity) => {
                const linked = identity.linked_user_id
                  ? memberById.get(identity.linked_user_id)
                  : undefined;
                return (
                  <View key={identity.id} style={styles.archiveRow}>
                    <View style={styles.archiveRowMain}>
                      <Text style={styles.value}>{identity.display_name}</Text>
                      <Text style={styles.metaLine}>
                        {linked ? `Đang giữ chỗ cho ${linked.name}` : "Đã bỏ gắn"}
                      </Text>
                    </View>
                    {identity.linked_user_id ? (
                      <Pressable
                        style={[styles.smallBtnGhost, adminBusy && styles.btnDisabled]}
                        disabled={adminBusy}
                        onPress={() => confirmUnlink(identity)}
                      >
                        <Text style={styles.smallBtnGhostText}>Gỡ</Text>
                      </Pressable>
                    ) : canArchive ? (
                      <Pressable
                        style={[
                          styles.smallBtnGhost,
                          archiveBusy && styles.btnDisabled,
                        ]}
                        onPress={() => confirmArchive(identity)}
                        disabled={archiveBusy}
                      >
                        <Text style={styles.smallBtnGhostText}>Lưu trữ</Text>
                      </Pressable>
                    ) : null}
                  </View>
                );
              })}
            </Disclosure>
          ) : null}

          {canArchive && archivedIdentities.length ? (
            <Disclosure
              title="Đã lưu trữ"
              subtitle={`${archivedIdentities.length} hồ sơ ẩn khỏi Thư viện`}
              open={archivedOpen}
              onToggle={() => setArchivedOpen((v) => !v)}
            >
              {archivedIdentities.map((identity) => (
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
              ))}
            </Disclosure>
          ) : null}

          {canAdmin || iAmNominee ? (
            <Disclosure
              title="Người giữ nhà kế tiếp"
              subtitle={
                succession
                  ? `${succession.nominee.name}${succession.nominee.handle ? ` (@${succession.nominee.handle})` : ""} · ${succession.status}`
                  : "Chưa chỉ định — quyền ở người giữ nhà hiện tại"
              }
              open={successionPendingForMe || successionOpen}
              onToggle={() => setSuccessionOpen((v) => !v)}
            >
              <Text style={styles.help}>
                Khi trao quyền, người kế nhiệm nhận steward / quản trị nhà này.
              </Text>
              <View style={styles.row}>
                {stewardship?.is_steward ? (
                  <>
                    <Pressable style={styles.smallBtn} onPress={nominateMember}>
                      <Text style={styles.smallBtnText}>Chỉ định</Text>
                    </Pressable>
                    {succession &&
                    ["pending", "accepted"].includes(succession.status) ? (
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
            </Disclosure>
          ) : null}
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
  presenceNotice: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.brand,
    fontWeight: "600",
    marginBottom: 8,
  },
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
  livingForm: { gap: 8, width: "100%", paddingTop: 4 },
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
  accountName: {
    fontFamily: fonts.display,
    fontSize: 22,
    color: colors.ink,
  },
  accountMeta: { fontSize: 15, color: colors.inkSoft, marginTop: 4 },
  signOutHit: { alignSelf: "flex-start", marginTop: 14 },
  signOutText: { fontSize: 15, fontWeight: "600", color: colors.danger },
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
  pipelineRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
  },
  pipelineRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  pipelineMain: { flex: 1, gap: 4 },
  pipelineLabel: { fontSize: 16, fontWeight: "700", color: colors.ink },
  pipelineHelp: { fontSize: 13, lineHeight: 18, color: colors.inkSoft },
  pipelineReset: {
    marginTop: 2,
    fontSize: 13,
    fontWeight: "600",
    color: colors.brand,
  },
  disclosureCard: {
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    overflow: "hidden",
  },
  disclosureHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  disclosureMain: { flex: 1, gap: 2 },
  disclosureTitle: { fontSize: 16, fontWeight: "700", color: colors.ink },
  disclosureSub: { fontSize: 13, lineHeight: 18, color: colors.inkSoft },
  disclosureChevron: { fontSize: 12, color: colors.inkSoft },
  disclosureBody: {
    paddingHorizontal: 16,
    paddingBottom: 14,
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingTop: 12,
  },
  statGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 12,
  },
  statCell: {
    width: "48%",
    flexGrow: 1,
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    paddingVertical: 14,
    paddingHorizontal: 14,
  },
  statValue: {
    fontFamily: fonts.display,
    fontSize: 26,
    color: colors.ink,
  },
  statLabel: { fontSize: 13, color: colors.inkSoft, marginTop: 4 },
  memberUsageRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  nestedBlock: { gap: 0 },
  nestedLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.inkSoft,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginBottom: 4,
    marginTop: 4,
  },
  innerToggle: { alignSelf: "flex-start", paddingVertical: 4 },
  usageRowLabel: { fontSize: 15, fontWeight: "600", color: colors.ink },
  usageRowValue: {
    fontSize: 14,
    color: colors.inkSoft,
    flexShrink: 1,
    textAlign: "right",
  },
});
