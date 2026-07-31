import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { useAuth } from "@/lib/auth";
import { colors, fonts } from "@/lib/theme";

export default function LoginScreen() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState("me@forever.family");
  const [password, setPassword] = useState("forever123");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async () => {
    setBusy(true);
    setError(null);
    try {
      await signIn(email.trim(), password);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không đăng nhập được.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.hero}>
        <Text style={styles.brand}>Forever</Text>
        <Text style={styles.tagline}>
          Mái nhà số cho gia đình — kết nối, lưu giữ, trường tồn.
        </Text>
      </View>

      <View style={styles.form}>
        <Text style={styles.label}>Email</Text>
        <TextInput
          autoCapitalize="none"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
          style={styles.input}
          placeholderTextColor={colors.inkSoft}
        />
        <Text style={styles.label}>Mật khẩu</Text>
        <TextInput
          secureTextEntry
          value={password}
          onChangeText={setPassword}
          style={styles.input}
          placeholderTextColor={colors.inkSoft}
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Pressable
          onPress={onSubmit}
          disabled={busy}
          style={({ pressed }) => [
            styles.cta,
            (pressed || busy) && { opacity: 0.85 },
          ]}
        >
          <Text style={styles.ctaText}>{busy ? "Đang vào…" : "Vào nhà"}</Text>
        </Pressable>
        <Text style={styles.hint}>
          Demo: me@forever.family / forever123 hoặc con@forever.family
        </Text>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.brand,
    paddingHorizontal: 28,
    justifyContent: "center",
  },
  hero: {
    marginBottom: 36,
  },
  brand: {
    fontFamily: fonts.display,
    fontSize: 48,
    color: "#f4efe6",
    letterSpacing: 0.5,
  },
  tagline: {
    marginTop: 12,
    fontSize: 17,
    lineHeight: 24,
    color: "rgba(244,239,230,0.88)",
    maxWidth: 300,
  },
  form: {
    backgroundColor: colors.card,
    borderRadius: 18,
    padding: 20,
  },
  label: {
    fontSize: 13,
    color: colors.inkSoft,
    marginBottom: 6,
    marginTop: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.ink,
    backgroundColor: "#fff",
  },
  cta: {
    marginTop: 18,
    backgroundColor: colors.brand,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  ctaText: {
    color: "#f4efe6",
    fontSize: 16,
    fontWeight: "600",
  },
  error: {
    marginTop: 10,
    color: colors.danger,
  },
  hint: {
    marginTop: 14,
    fontSize: 12,
    color: colors.inkSoft,
    lineHeight: 18,
  },
});
