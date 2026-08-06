import {
  FamilySpace,
  IdentityProfile,
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

type SettingsTab = "account" | "space";

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

  useLayoutEffect(() => {
    load();
  }, [load]);

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
  const archivedIdentities = allIdentities.filter((i) => i.archived_at);
  const archivableIdentities = allIdentities.filter(
    (i) => !i.archived_at && !i.linked_user_id,
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

          <Text style={styles.section}>Thành viên</Text>
          <View style={styles.card}>
            {(space?.members ?? []).map((member) => (
              <View key={member.id} style={styles.archiveRow}>
                <View style={styles.archiveRowMain}>
                  <Text style={styles.value}>{member.name}</Text>
                  <Text style={styles.metaLine}>
                    {member.email}
                    {member.role === "owner" ? " · Quản trị" : ""}
                    {member.id === stewardship?.steward?.id ? " · Steward" : ""}
                  </Text>
                </View>
                {member.id !== user?.id &&
                member.id !== stewardship?.steward?.id ? (
                  <Pressable
                    style={styles.smallBtnGhost}
                    onPress={() => confirmRemoveMember(member)}
                  >
                    <Text style={styles.smallBtnGhostText}>Gỡ</Text>
                  </Pressable>
                ) : null}
              </View>
            ))}
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
});
