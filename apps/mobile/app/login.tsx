import { useEffect, useRef, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BrandLogo } from "@/components/BrandLogo";
import { useAuth } from "@/lib/auth";
import { resolveBaseUrl } from "@/lib/api";
import { isAuthDevEnabled, isFirebaseConfigured } from "@/lib/firebase";
import {
  getSavedLoginEmail,
  saveLoginEmail,
} from "@/lib/loginCredentials";
import { colors } from "@/lib/theme";

/** Firebase error codes read like stack traces; mẹ needs a sentence. */
function friendlyAuthError(e: unknown): string {
  const code =
    e && typeof e === "object" && "code" in e
      ? String((e as { code: unknown }).code)
      : "";
  switch (code) {
    case "auth/invalid-email":
      return "Email không đúng định dạng.";
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "Email hoặc mật khẩu chưa đúng.";
    case "auth/user-disabled":
      return "Tài khoản này đã bị khoá.";
    case "auth/too-many-requests":
      return "Thử quá nhiều lần. Đợi vài phút rồi thử lại.";
    case "auth/network-request-failed":
      return "Không có mạng. Kiểm tra Wi-Fi hoặc 4G rồi thử lại.";
    default:
      return e instanceof Error ? e.message : "Không đăng nhập được.";
  }
}

export default function LoginScreen() {
  const { signIn, signInDev, resetPassword } = useAuth();
  const insets = useSafeAreaInsets();
  const passwordRef = useRef<TextInput>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const firebaseOn = isFirebaseConfigured();
  // Dev login is a local-development affordance, never shipped to family phones.
  const devOn = !firebaseOn || (isAuthDevEnabled() && __DEV__);
  const resolveHint = resolveBaseUrl();

  useEffect(() => {
    (async () => {
      const saved = await getSavedLoginEmail();
      if (saved) setEmail(saved);
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
      if (firebaseOn) {
        await signIn(email.trim(), password);
      } else {
        await signInDev(email.trim(), password);
      }
      await saveLoginEmail(email.trim());
    } catch (e) {
      setError(friendlyAuthError(e));
    } finally {
      setBusy(false);
    }
  };

  const onForgotPassword = async () => {
    if (!email.trim()) {
      setError("Nhập email trước, rồi bấm Quên mật khẩu.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await resetPassword(email.trim());
      Alert.alert(
        "Đã gửi email",
        `Mở hộp thư ${email.trim()} và làm theo hướng dẫn để đặt lại mật khẩu.`,
      );
    } catch (e) {
      setError(friendlyAuthError(e));
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
    // Android 15 ignores adjustResize under edge-to-edge, so the keyboard would
    // sit on top of the inputs unless this view gives way for it.
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          {
            paddingTop: insets.top + 32,
            paddingBottom: insets.bottom + 32,
          },
        ]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <View style={styles.hero}>
          <BrandLogo
            variant="onDark"
            layout="stacked"
            markSize={88}
            wordmarkSize={42}
            style={{ alignItems: "flex-start" }}
          />
          <Text style={styles.tagline}>
            Mái nhà số cho gia đình — kết nối, lưu giữ, trường tồn.
          </Text>
        </View>

        <View style={styles.form}>
          <Text style={styles.formLead}>Đăng nhập để vào nhà</Text>
          <Text style={styles.formNote}>
            Đăng nhập một lần là xong — lần sau mở app bạn đã ở trong nhà.
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
            placeholder="ten@gmail.com"
            placeholderTextColor={colors.inkSoft}
            editable={!busy}
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={() => passwordRef.current?.focus()}
          />
          <Text style={styles.label}>Mật khẩu</Text>
          <TextInput
            ref={passwordRef}
            secureTextEntry
            autoComplete="password"
            textContentType="password"
            value={password}
            onChangeText={setPassword}
            style={styles.input}
            placeholderTextColor={colors.inkSoft}
            editable={!busy}
            returnKeyType="go"
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
            <Text style={styles.ctaText}>{busy ? "Đang vào…" : "Vào nhà"}</Text>
          </Pressable>

          {firebaseOn ? (
            <Pressable onPress={onForgotPassword} disabled={busy}>
              <Text style={styles.linkText}>Quên mật khẩu?</Text>
            </Pressable>
          ) : null}

          {error ? <Text style={styles.error}>{error}</Text> : null}

          {devOn ? (
            <Text style={styles.hint}>
              {firebaseOn ? "Firebase" : "Đăng nhập dev"} · API: {resolveHint}
            </Text>
          ) : null}
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
    justifyContent: "center",
  },
  hero: { marginBottom: 28, alignItems: "flex-start" },
  tagline: {
    marginTop: 16,
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
  linkText: {
    marginTop: 4,
    fontSize: 14,
    color: colors.brand,
    fontWeight: "600",
    textAlign: "center",
  },
  error: { marginTop: 4, color: colors.danger, lineHeight: 20 },
  hint: {
    marginTop: 8,
    fontSize: 12,
    color: colors.inkSoft,
    lineHeight: 18,
  },
});
