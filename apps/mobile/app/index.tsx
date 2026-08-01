import { FamilySpace } from "@forever/api-client";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { useRouter } from "expo-router";
import { useCallback, useLayoutEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { useAuth } from "@/lib/auth";
import { colors, fonts } from "@/lib/theme";

export default function HomeScreen() {
  const { api, user, signOut } = useAuth();
  const router = useRouter();
  const navigation = useNavigation();
  const [spaces, setSpaces] = useState<FamilySpace[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: "Forever",
      headerRight: () => (
        <Pressable onPress={() => signOut()} hitSlop={8} style={styles.headerBtn}>
          <Text style={styles.headerBtnText}>Thoát</Text>
        </Pressable>
      ),
    });
  }, [navigation, signOut]);

  const load = useCallback(
    async (opts?: { silent?: boolean }) => {
      const silent = opts?.silent === true;
      if (silent) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const res = await api.listSpaces();
        setSpaces(res.spaces);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Không tải được.");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [api],
  );

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const createSpace = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      const space = await api.createSpace(trimmed);
      setName("");
      router.push(`/space/${space.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tạo được.");
    }
  };

  const renderHeader = () => (
    <View style={styles.headerBlock}>
      <Text style={styles.hello}>Xin chào, {user?.name}</Text>
      <Text style={styles.sub}>Chọn mái nhà gia đình của bạn</Text>

      <Pressable style={styles.secondary} onPress={() => router.push("/invite")}>
        <Text style={styles.secondaryText}>Nhập mã mời</Text>
      </Pressable>

      <View style={styles.createBox}>
        <Text style={styles.createLabel}>Tạo gia đình mới</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Ví dụ: Nhà mình"
          placeholderTextColor={colors.inkSoft}
          style={styles.input}
        />
        <Pressable style={styles.cta} onPress={createSpace}>
          <Text style={styles.ctaText}>Tạo</Text>
        </Pressable>
      </View>
    </View>
  );

  if (loading && spaces.length === 0) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }

  return (
    <FlatList
      style={styles.list}
      contentContainerStyle={styles.listContent}
      data={spaces}
      keyExtractor={(item) => item.id}
      ListHeaderComponent={renderHeader}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => load({ silent: true })}
          tintColor={colors.brand}
        />
      }
      renderItem={({ item }) => (
        <Pressable
          style={styles.card}
          onPress={() => router.push(`/space/${item.id}`)}
        >
          <Text style={styles.cardTitle}>{item.name}</Text>
          <Text style={styles.cardMeta}>
            {item.member_count} thành viên · {item.role}
          </Text>
        </Pressable>
      )}
      ListEmptyComponent={
        <Text style={styles.empty}>
          Chưa có không gian nào. Tạo “Nhà mình” ở trên để bắt đầu.
        </Text>
      }
      ListFooterComponent={error ? <Text style={styles.error}>{error}</Text> : null}
    />
  );
}

const styles = StyleSheet.create({
  list: { flex: 1, backgroundColor: colors.bg },
  listContent: { padding: 20, paddingBottom: 40 },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bg,
  },
  headerBtn: { marginRight: 4, paddingVertical: 4, paddingHorizontal: 2 },
  headerBtnText: { color: colors.brand, fontWeight: "600", fontSize: 16 },
  headerBlock: { gap: 12, marginBottom: 8 },
  hello: {
    fontFamily: fonts.display,
    fontSize: 28,
    color: colors.ink,
  },
  sub: { color: colors.inkSoft, lineHeight: 20 },
  secondary: {
    alignSelf: "flex-start",
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: colors.card,
  },
  secondaryText: { color: colors.ink, fontWeight: "500" },
  createBox: {
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    gap: 8,
  },
  createLabel: { color: colors.inkSoft },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: "#fff",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: colors.ink,
  },
  cta: {
    backgroundColor: colors.brand,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: "center",
  },
  ctaText: { color: "#f4efe6", fontWeight: "600" },
  card: {
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 18,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.line,
  },
  cardTitle: {
    fontFamily: fonts.display,
    fontSize: 22,
    color: colors.ink,
  },
  cardMeta: { marginTop: 6, color: colors.inkSoft },
  empty: { color: colors.inkSoft, lineHeight: 22, marginTop: 4 },
  error: { color: colors.danger, marginTop: 12 },
});
