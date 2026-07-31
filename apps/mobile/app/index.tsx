import { FamilySpace } from "@forever/api-client";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
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
  const [spaces, setSpaces] = useState<FamilySpace[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.listSpaces();
      setSpaces(res.spaces);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tải được.");
    } finally {
      setLoading(false);
    }
  }, [api]);

  useFocusEffect(
    useCallback(() => {
      load();
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

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <View>
          <Text style={styles.hello}>Xin chào, {user?.name}</Text>
          <Text style={styles.sub}>Chọn mái nhà gia đình của bạn</Text>
        </View>
        <Pressable onPress={() => signOut()}>
          <Text style={styles.signOut}>Thoát</Text>
        </Pressable>
      </View>

      <View style={styles.actions}>
        <Pressable style={styles.secondary} onPress={() => router.push("/invite")}>
          <Text style={styles.secondaryText}>Nhập mã mời</Text>
        </Pressable>
      </View>

      {loading ? (
        <ActivityIndicator color={colors.brand} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={spaces}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingBottom: 40 }}
          ListEmptyComponent={
            <Text style={styles.empty}>
              Chưa có không gian nào. Tạo “Nhà mình” để bắt đầu.
            </Text>
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
        />
      )}

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
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: 20, backgroundColor: colors.bg },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 18,
  },
  hello: {
    fontFamily: fonts.display,
    fontSize: 28,
    color: colors.ink,
  },
  sub: { marginTop: 4, color: colors.inkSoft },
  signOut: { color: colors.brand, fontWeight: "600" },
  actions: { marginBottom: 12 },
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
  empty: { color: colors.inkSoft, marginTop: 24, lineHeight: 22 },
  createBox: {
    marginTop: "auto",
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  createLabel: { color: colors.inkSoft, marginBottom: 8 },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: "#fff",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 10,
    color: colors.ink,
  },
  cta: {
    backgroundColor: colors.brand,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: "center",
  },
  ctaText: { color: "#f4efe6", fontWeight: "600" },
  error: { color: colors.danger, marginTop: 8 },
});
