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
import {
  googleIosClientId,
  googleWebClientId,
  isAuthDevEnabled,
  isFirebaseConfigured,
} from "@/lib/firebase";
import {
  canUseNativeGoogleSignIn,
  formatGoogleSignInError,
  isExpoGo,
  signInWithNativeGoogle,
} from "@/lib/googleSignIn";
import { colors, fonts } from "@/lib/theme";

export default function LoginScreen() {
  const { signInDev, signInWithIdToken } = useAuth();
  const [email, setEmail] = useState("me@forever.family");
  const [password, setPassword] = useState("forever123");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showDev, setShowDev] = useState(false);
  const firebaseOn = isFirebaseConfigured();
  const devOn = isAuthDevEnabled();
  const nativeGoogle = canUseNativeGoogleSignIn();
  const expoGo = isExpoGo();
  const resolveHint = resolveBaseUrl();
  const hasWebClient = Boolean(googleWebClientId());
  const hasIosClient = Boolean(googleIosClientId());

  useEffect(() => {
    if (!firebaseOn && devOn) setShowDev(true);
    if (expoGo && firebaseOn && devOn) setShowDev(true);
  }, [firebaseOn, devOn, expoGo]);

  const onDevSubmit = async () => {
    setBusy(true);
    setError(null);
    try {
      await signInDev(email.trim(), password);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không đăng nhập được.");
    } finally {
      setBusy(false);
    }
  };

  const onGoogle = async () => {
    setError(null);
    setBusy(true);
    try {
      const cred = await signInWithNativeGoogle();
      const token = await cred.user.getIdToken();
      await signInWithIdToken(token);
    } catch (e) {
      setError(formatGoogleSignInError(e));
    } finally {
      setBusy(false);
    }
  };

  const googleBlockedReason = expoGo
    ? "Expo Go không hỗ trợ Google OAuth (Google chặn redirect). Dùng đăng nhập dev bên dưới, hoặc cài bản APK / dev build."
    : Platform.OS === "ios" && !hasIosClient
      ? "Thiếu EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID trong apps/mobile/.env — lấy từ Firebase iOS app."
      : !hasWebClient
        ? "Thiếu EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID trong apps/mobile/.env."
        : null;

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
          {firebaseOn ? (
            <>
              <Text style={styles.formLead}>Đăng nhập để vào nhà</Text>
              {nativeGoogle ? (
                <Pressable
                  onPress={onGoogle}
                  disabled={busy}
                  style={({ pressed }) => [
                    styles.cta,
                    (pressed || busy) && { opacity: 0.85 },
                  ]}
                >
                  <Text style={styles.ctaText}>
                    {busy ? "Đang vào…" : "Tiếp tục với Google"}
                  </Text>
                </Pressable>
              ) : (
                <View style={styles.notice}>
                  <Text style={styles.noticeTitle}>Google chưa dùng được</Text>
                  <Text style={styles.noticeBody}>{googleBlockedReason}</Text>
                </View>
              )}
              {!nativeGoogle && devOn ? (
                <Text style={styles.formNote}>
                  Tạm thời: mở «Đăng nhập dev» bên dưới (me@forever.family /
                  forever123).
                </Text>
              ) : (
                <Text style={styles.formNote}>
                  Dùng tài khoản Google của bạn. Forever không lưu mật khẩu
                  Google.
                </Text>
              )}
            </>
          ) : devOn ? (
            <Text style={styles.formLead}>Chế độ dev — chưa bật Firebase</Text>
          ) : (
            <Text style={styles.formLead}>
              Chưa cấu hình đăng nhập. Liên hệ người quản trị.
            </Text>
          )}

          {devOn ? (
            <>
              {firebaseOn ? (
                <Pressable
                  onPress={() => setShowDev((v) => !v)}
                  style={styles.devToggle}
                  disabled={busy}
                >
                  <Text style={styles.devToggleText}>
                    {showDev ? "Ẩn đăng nhập dev ▴" : "Đăng nhập dev (local) ▾"}
                  </Text>
                </Pressable>
              ) : null}

              {showDev ? (
                <View style={styles.devPanel}>
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
                  <Pressable
                    onPress={onDevSubmit}
                    disabled={busy}
                    style={({ pressed }) => [
                      styles.secondaryCta,
                      (pressed || busy) && { opacity: 0.85 },
                    ]}
                  >
                    <Text style={styles.secondaryText}>
                      {busy ? "Đang vào…" : "Vào nhà (dev)"}
                    </Text>
                  </Pressable>
                  <Text style={styles.hint}>
                    Demo: me@forever.family / forever123 · API: {resolveHint}
                  </Text>
                </View>
              ) : null}
            </>
          ) : null}

          {error ? <Text style={styles.error}>{error}</Text> : null}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.brand },
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
  notice: {
    backgroundColor: "#f7f1e6",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(196, 165, 116, 0.45)",
    padding: 12,
    gap: 6,
  },
  noticeTitle: { fontSize: 14, fontWeight: "700", color: colors.ink },
  noticeBody: { fontSize: 13, lineHeight: 18, color: colors.inkSoft },
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
    backgroundColor: colors.brand,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  ctaText: { color: "#f4efe6", fontSize: 16, fontWeight: "600" },
  devToggle: { paddingVertical: 8, marginTop: 4 },
  devToggleText: {
    textAlign: "center",
    color: colors.inkSoft,
    fontSize: 14,
    fontWeight: "600",
  },
  devPanel: {
    marginTop: 4,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    gap: 6,
  },
  secondaryCta: {
    marginTop: 8,
    backgroundColor: colors.bgDeep,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.line,
  },
  secondaryText: { color: colors.brand, fontSize: 16, fontWeight: "600" },
  error: { marginTop: 4, color: colors.danger, lineHeight: 20 },
  hint: {
    marginTop: 8,
    fontSize: 12,
    color: colors.inkSoft,
    lineHeight: 18,
  },
});
