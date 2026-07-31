import * as AuthSession from "expo-auth-session";
import * as Google from "expo-auth-session/providers/google";
import * as WebBrowser from "expo-web-browser";
import { useEffect, useState } from "react";
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
import { resolveBaseUrl } from "@/lib/api";
import {
  googleWebClientId,
  isAuthDevEnabled,
  isFirebaseConfigured,
  signInWithGoogleIdToken,
} from "@/lib/firebase";
import {
  canUseNativeGoogleSignIn,
  formatGoogleSignInError,
  signInWithNativeGoogle,
} from "@/lib/googleSignIn";
import { colors, fonts } from "@/lib/theme";

WebBrowser.maybeCompleteAuthSession();

export default function LoginScreen() {
  const { signInDev, signInWithIdToken } = useAuth();
  const [email, setEmail] = useState("me@forever.family");
  const [password, setPassword] = useState("forever123");
  const [phone, setPhone] = useState("+84");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const firebaseOn = isFirebaseConfigured();
  const devOn = isAuthDevEnabled();
  const webClientId = googleWebClientId();
  const useNativeGoogle = canUseNativeGoogleSignIn();
  const redirectUri = AuthSession.makeRedirectUri();
  const resolveHint = resolveBaseUrl();

  // Expo Go: only the Web client ID. Passing it as ios/androidClientId causes Google Error 400.
  const [request, response, promptGoogle] = Google.useIdTokenAuthRequest(
    !useNativeGoogle && webClientId
      ? { clientId: webClientId, redirectUri }
      : { clientId: "placeholder.apps.googleusercontent.com" },
  );

  useEffect(() => {
    if (useNativeGoogle) return;
    (async () => {
      if (response?.type === "error") {
        setError(
          response.error?.message ||
            response.params?.error_description ||
            "Google trả lỗi (thường do redirect URI chưa khai báo).",
        );
        return;
      }
      if (response?.type !== "success") return;
      const idToken = response.params.id_token;
      if (!idToken) {
        setError("Google không trả về id_token.");
        return;
      }
      setBusy(true);
      setError(null);
      try {
        const cred = await signInWithGoogleIdToken(idToken);
        const token = await cred.user.getIdToken();
        await signInWithIdToken(token);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Google đăng nhập thất bại.");
      } finally {
        setBusy(false);
      }
    })();
  }, [response, signInWithIdToken, useNativeGoogle]);

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
    if (!firebaseOn || !webClientId) {
      setError("Thiếu Firebase / Google Web Client ID trong cấu hình.");
      return;
    }
    setError(null);
    if (useNativeGoogle) {
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
      return;
    }
    await promptGoogle();
  };

  const onPhoneHint = () => {
    setError(
      phone.trim().length < 8
        ? "Nhập số E.164 (vd. +8490…)."
        : "SMS Phone Auth cần cấu hình thêm. Tạm dùng Google hoặc Dev login.",
    );
  };

  const googleDisabled = busy || (!useNativeGoogle && !request);

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
        {firebaseOn ? (
          <>
            <Pressable
              onPress={onGoogle}
              disabled={googleDisabled}
              style={({ pressed }) => [
                styles.secondaryCta,
                (pressed || busy) && { opacity: 0.85 },
              ]}
            >
              <Text style={styles.secondaryText}>
                {busy ? "Đang vào…" : "Tiếp tục với Google"}
              </Text>
            </Pressable>

            <Text style={styles.label}>Điện thoại (SMS)</Text>
            <TextInput
              autoCapitalize="none"
              keyboardType="phone-pad"
              value={phone}
              onChangeText={setPhone}
              style={styles.input}
              placeholder="+8490…"
              placeholderTextColor={colors.inkSoft}
            />
            <Pressable
              onPress={onPhoneHint}
              disabled={busy}
              style={({ pressed }) => [
                styles.secondaryCta,
                (pressed || busy) && { opacity: 0.85 },
              ]}
            >
              <Text style={styles.secondaryText}>Gửi mã SMS</Text>
            </Pressable>
            <Text style={styles.divider}>hoặc</Text>
          </>
        ) : null}

        {devOn ? (
          <>
            <Text style={styles.label}>Email (dev)</Text>
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
                styles.cta,
                (pressed || busy) && { opacity: 0.85 },
              ]}
            >
              <Text style={styles.ctaText}>{busy ? "Đang vào…" : "Vào nhà (dev)"}</Text>
            </Pressable>
            <Text style={styles.hint}>
              Demo: me@forever.family / forever123 · API: {resolveHint}
            </Text>
          </>
        ) : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}
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
  hero: { marginBottom: 36 },
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
  ctaText: { color: "#f4efe6", fontSize: 16, fontWeight: "600" },
  secondaryCta: {
    marginTop: 10,
    backgroundColor: colors.bgDeep,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.line,
  },
  secondaryText: { color: colors.brand, fontSize: 16, fontWeight: "600" },
  divider: {
    textAlign: "center",
    marginVertical: 14,
    color: colors.inkSoft,
  },
  error: { marginTop: 10, color: colors.danger },
  hint: {
    marginTop: 14,
    fontSize: 12,
    color: colors.inkSoft,
    lineHeight: 18,
  },
});
