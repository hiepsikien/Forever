import { FamilySpace, ThreadSummary } from "@forever/api-client";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useLayoutEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useNavigation } from "@react-navigation/native";

import { useAuth } from "@/lib/auth";
import { colors, fonts } from "@/lib/theme";

export default function SpaceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api } = useAuth();
  const router = useRouter();
  const navigation = useNavigation();
  const [space, setSpace] = useState<FamilySpace | null>(null);
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const [spaceRes, threadRes] = await Promise.all([
        api.getSpace(id),
        api.listThreads(id),
      ]);
      setSpace(spaceRes);
      setThreads(threadRes.threads);
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

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <Text style={styles.meta}>
        {space?.member_count ?? 0} thành viên
        {space?.role === "owner" ? " · Bạn là người quản trị" : ""}
      </Text>

      {space?.role === "owner" ? (
        <Pressable style={styles.inviteBtn} onPress={makeInvite}>
          <Text style={styles.inviteText}>
            {inviteCode ? `Mã mời: ${inviteCode}` : "Tạo mã mời"}
          </Text>
        </Pressable>
      ) : null}

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
  section: {
    fontFamily: fonts.display,
    fontSize: 22,
    color: colors.ink,
    marginBottom: 10,
  },
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
