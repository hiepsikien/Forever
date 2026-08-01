import { FamilySpace, StewardshipStatus, ThreadSummary } from "@forever/api-client";
import { useNavigation } from "@react-navigation/native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useLayoutEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { useAuth } from "@/lib/auth";
import { colors, fonts } from "@/lib/theme";

export default function SpaceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api, user } = useAuth();
  const router = useRouter();
  const navigation = useNavigation();
  const [space, setSpace] = useState<FamilySpace | null>(null);
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [stewardship, setStewardship] = useState<StewardshipStatus | null>(null);
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const [spaceRes, threadRes, stewardRes] = await Promise.all([
        api.getSpace(id),
        api.listThreads(id),
        api.getStewardship(id),
      ]);
      setSpace(spaceRes);
      setThreads(threadRes.threads);
      setStewardship(stewardRes);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tải được.");
    } finally {
      setLoading(false);
    }
  }, [api, id]);

  useLayoutEffect(() => {
    load();
  }, [load]);

  useLayoutEffect(() => {
    if (space?.name) {
      navigation.setOptions({ title: space.name });
    }
  }, [navigation, space?.name]);

  const makeInvite = async () => {
    if (!id) return;
    try {
      const invite = await api.createInvite(id);
      setInviteCode(invite.code);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tạo mã được.");
    }
  };

  const nominateMember = () => {
    if (!id || !space?.members?.length) return;
    const candidates = space.members.filter((m) => m.id !== user?.id);
    if (!candidates.length) {
      Alert.alert("Chưa có thành viên khác", "Mời người thân vào trước khi chỉ định kế nhiệm.");
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
              await api.nominateSuccessor(id, m.id, "Chỉ định kế nhiệm Forever");
              await load();
              Alert.alert("Đã đề cử", `${m.name} cần chấp nhận trên thiết bị của họ.`);
            } catch (e) {
              Alert.alert("Lỗi", e instanceof Error ? e.message : "Không đề cử được.");
            }
          },
        })),
        { text: "Huỷ", style: "cancel" },
      ],
    );
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

  return (
    <View style={styles.root}>
      <Text style={styles.meta}>
        {space?.member_count ?? 0} thành viên
        {space?.role === "owner" ? " · Bạn là người quản trị" : ""}
        {stewardship?.steward
          ? ` · Steward: ${stewardship.steward.name}`
          : ""}
      </Text>

      {space?.role === "owner" ? (
        <Pressable style={styles.inviteBtn} onPress={makeInvite}>
          <Text style={styles.inviteText}>
            {inviteCode ? `Mã mời: ${inviteCode}` : "Tạo mã mời"}
          </Text>
        </Pressable>
      ) : null}

      <View style={styles.hub}>
        <Pressable
          style={styles.hubBtn}
          onPress={() => id && router.push(`/library/${id}`)}
        >
          <Text style={styles.hubTitle}>Thư viện ký ức</Text>
          <Text style={styles.hubSub}>Ảnh, ghi chú, giọng nói của cả nhà</Text>
        </Pressable>
        <Pressable
          style={styles.hubBtn}
          onPress={() => id && router.push(`/interview/${id}`)}
        >
          <Text style={styles.hubTitle}>Time-Capsule</Text>
          <Text style={styles.hubSub}>Một câu hỏi cội nguồn — trả lời khi tiện</Text>
        </Pressable>
        <Pressable
          style={styles.hubBtn}
          onPress={() => id && router.push(`/voice/${id}`)}
        >
          <Text style={styles.hubTitle}>Voice DNA</Text>
          <Text style={styles.hubSub}>Giọng của bạn hoặc ký ức người thân</Text>
        </Pressable>
        <Pressable
          style={styles.hubBtn}
          onPress={() => id && router.push(`/settings/${id}`)}
        >
          <Text style={styles.hubTitle}>Cài đặt</Text>
          <Text style={styles.hubSub}>ElevenLabs API key và tùy chọn không gian</Text>
        </Pressable>
      </View>

      <Text style={styles.section}>Trường tồn · Steward</Text>
      <View style={styles.stewardCard}>
        {succession ? (
          <Text style={styles.stewardBody}>
            Đề cử: {succession.nominee.name}
            {succession.nominee.handle ? ` (@${succession.nominee.handle})` : ""} ·{" "}
            {succession.status}
          </Text>
        ) : (
          <Text style={styles.stewardBody}>
            Chưa có người kế nhiệm. Steward hiện tại giữ quyền Owner của không gian này.
          </Text>
        )}
        <View style={styles.stewardActions}>
          {stewardship?.is_steward ? (
            <>
              <Pressable style={styles.smallBtn} onPress={nominateMember}>
                <Text style={styles.smallBtnText}>Chỉ định kế nhiệm</Text>
              </Pressable>
              {succession && ["pending", "accepted"].includes(succession.status) ? (
                <Pressable
                  style={styles.smallBtnGhost}
                  onPress={async () => {
                    if (!id) return;
                    await api.revokeSuccession(id);
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
                  if (!id) return;
                  await api.acceptSuccession(id);
                  await load();
                }}
              >
                <Text style={styles.smallBtnText}>Nhận kế nhiệm</Text>
              </Pressable>
              <Pressable
                style={styles.smallBtnGhost}
                onPress={async () => {
                  if (!id) return;
                  await api.declineSuccession(id);
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
                if (!id) return;
                await api.activateSuccession(id);
                await load();
                Alert.alert("Đã chuyển giao", "Quyền steward / owner đã trao cho người kế nhiệm.");
              }}
            >
              <Text style={styles.smallBtnText}>Kích hoạt chuyển giao</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      <Text style={styles.section}>Cuộc trò chuyện</Text>
      <FlatList
        data={threads}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <Pressable
            style={styles.thread}
            onPress={() => router.push(`/chat/${item.id}`)}
          >
            <Text style={styles.threadTitle}>{item.title}</Text>
            <Text style={styles.threadPreview} numberOfLines={2}>
              {item.last_message?.body ?? "Chưa có tin nhắn"}
            </Text>
          </Pressable>
        )}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: 20, backgroundColor: colors.bg },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bg,
  },
  meta: { color: colors.inkSoft, marginBottom: 12 },
  inviteBtn: {
    alignSelf: "flex-start",
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginBottom: 18,
  },
  inviteText: { color: colors.brand, fontWeight: "600" },
  hub: { gap: 10, marginBottom: 20 },
  hubBtn: {
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.line,
  },
  hubTitle: { fontSize: 17, fontWeight: "600", color: colors.ink },
  hubSub: { marginTop: 6, color: colors.inkSoft, lineHeight: 20 },
  section: {
    fontFamily: fonts.display,
    fontSize: 22,
    color: colors.ink,
    marginBottom: 10,
  },
  stewardCard: {
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.line,
    marginBottom: 20,
  },
  stewardBody: { color: colors.inkSoft, lineHeight: 20 },
  stewardActions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
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
  thread: {
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.line,
  },
  threadTitle: { fontSize: 17, fontWeight: "600", color: colors.ink },
  threadPreview: { marginTop: 6, color: colors.inkSoft, lineHeight: 20 },
  error: { color: colors.danger, marginTop: 8 },
});
