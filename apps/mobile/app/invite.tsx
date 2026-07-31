import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { useAuth } from "@/lib/auth";
import { colors } from "@/lib/theme";

export default function InviteScreen() {
  const { api } = useAuth();
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const join = async () => {
    setBusy(true);
    setError(null);
    try {
      const space = await api.joinSpace(code.trim());
      router.replace(`/space/${space.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tham gia được.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.root}>
      <Text style={styles.title}>Nhập mã mời gia đình</Text>
      <Text style={styles.sub}>
        Người quản trị gửi bạn một mã — dùng mã đó để vào cùng một mái nhà.
      </Text>
      <TextInput
        autoCapitalize="characters"
        value={code}
        onChangeText={setCode}
        placeholder="Ví dụ: AB12CD34"
        placeholderTextColor={colors.inkSoft}
        style={styles.input}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Pressable
        style={[styles.cta, busy && { opacity: 0.7 }]}
        onPress={join}
        disabled={busy}
      >
        <Text style={styles.ctaText}>{busy ? "Đang vào…" : "Tham gia"}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: 20, backgroundColor: colors.bg },
  title: { fontFamily: "Georgia", fontSize: 26, color: colors.ink },
  sub: { marginTop: 8, marginBottom: 20, color: colors.inkSoft, lineHeight: 22 },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: "#fff",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 18,
    letterSpacing: 2,
    color: colors.ink,
  },
  cta: {
    marginTop: 16,
    backgroundColor: colors.brand,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  ctaText: { color: "#f4efe6", fontWeight: "600" },
  error: { marginTop: 10, color: colors.danger },
});
