import { useEffect, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { useAuth } from "@/lib/auth";
import { resolveBaseUrl } from "@/lib/api";
import { isAuthDevEnabled } from "@/lib/firebase";
import {
  getSavedLoginCredentials,
  saveLoginCredentials,
} from "@/lib/loginCredentials";
import { colors, fonts } from "@/lib/theme";

export default function LoginScreen() {
  const { signInDev } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const devOn = isAuthDevEnabled();
  const resolveHint = resolveBaseUrl();

  useEffect(() => {
    (async () => {
      const saved = await getSavedLoginCredentials();
      if (saved) {
        setEmail(saved.email);
        setPassword(saved.password);
      } else {
        setEmail("me@forever.family");
        setPassword("forever123");
      }
      setReady(true);
    })();
  }, []);

  const onSubmit = async () => {
    if (!email.trim() || !password) {
      setError("Nhập email và mật khẩu.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await signInDev(email.trim(), password);
      await saveLoginCredentials(email.trim(), password);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không đăng nhập được.");
    } finally {
      setBusy(false);
    }
  };

  if (!ready) {
    return (
      <View style={[styles.root, styles.centered]}>
        <Text style={styles.loadingText}>Đang tải…</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.hero}>
          <Text style={styles.brand}>Forever</Text>
          <Text style={styles.tagline}>
            Mái nhà số cho gia đình — kết nối, lưu giữ, trường tồn.
          </Text>
        </View>

        <View style={styles.form}>
          {devOn ? (
            <>
              <Text style={styles.formLead}>Đăng nhập để vào nhà</Text>
              <Text style={styles.formNote}>
                Thông tin đăng nhập được lưu trên thiết bị — lần sau không cần
                nhập lại.
              </Text>
              <Text style={styles.label}>Email</Text>
              <TextInput
                autoCapitalize="none"
                keyboardType="email-address"
                autoComplete="email"
                textContentType="username"
                value={email}
                onChangeText={setEmail}
                style={styles.input}
                placeholder="me@forever.family"
                placeholderTextColor={colors.inkSoft}
                editable={!busy}
              />
              <Text style={styles.label}>Mật khẩu</Text>
              <TextInput
                secureTextEntry
                autoComplete="password"
                textContentType="password"
                value={password}
                onChangeText={setPassword}
                style={styles.input}
                placeholderTextColor={colors.inkSoft}
                editable={!busy}
                onSubmitEditing={() => void onSubmit()}
              />
              <Pressable
                onPress={onSubmit}
                disabled={busy}
                style={({ pressed }) => [
                  styles.cta,
                  (pressed || busy) && { opacity: 0.85 },
                ]}
              >
                <Text style={styles.ctaText}>
                  {busy ? "Đang vào…" : "Vào nhà"}
                </Text>
              </Pressable>
              <Text style={styles.hint}>
                Demo: me@forever.family / forever123 · API: {resolveHint}
              </Text>
            </>
          ) : (
            <Text style={styles.formLead}>
              Chưa bật đăng nhập dev. Liên hệ người quản trị.
            </Text>
          )}

          {error ? <Text style={styles.error}>{error}</Text> : null}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.brand },
  centered: { alignItems: "center", justifyContent: "center" },
  loadingText: { color: "#f4efe6", fontSize: 16 },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: 28,
    paddingVertical: 32,
    justifyContent: "center",
  },
  hero: { marginBottom: 28 },
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
    gap: 10,
  },
  formLead: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.ink,
    marginBottom: 4,
  },
  formNote: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.inkSoft,
  },
  label: {
    fontSize: 13,
    color: colors.inkSoft,
    marginBottom: 4,
    marginTop: 4,
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
    marginTop: 8,
    backgroundColor: colors.brand,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  ctaText: { color: "#f4efe6", fontSize: 16, fontWeight: "600" },
  error: { marginTop: 4, color: colors.danger, lineHeight: 20 },
  hint: {
    marginTop: 8,
    fontSize: 12,
    color: colors.inkSoft,
    lineHeight: 18,
  },
});
