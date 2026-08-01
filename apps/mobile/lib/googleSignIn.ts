import Constants from "expo-constants";
import { Platform } from "react-native";

import { googleIosClientId, googleWebClientId, signInWithGoogleIdToken } from "./firebase";

let configured = false;

/** Expo Go cannot complete Google OAuth (redirect URI bị Google chặn). */
export function isExpoGo(): boolean {
  return Constants.appOwnership === "expo";
}

/**
 * Native @react-native-google-signin — chỉ trên dev build / APK / IPA, không Expo Go.
 */
export function canUseNativeGoogleSignIn(): boolean {
  if (isExpoGo()) return false;
  if (!googleWebClientId()) return false;
  if (Platform.OS === "ios" && !googleIosClientId()) return false;
  return Platform.OS === "android" || Platform.OS === "ios";
}

async function loadNativeGoogleSignIn() {
  return import("@react-native-google-signin/google-signin");
}

export async function signInWithNativeGoogle() {
  if (!canUseNativeGoogleSignIn()) {
    if (isExpoGo()) {
      throw new Error(
        "Google Sign-In không chạy trên Expo Go. Dùng đăng nhập dev hoặc cài bản APK/dev build.",
      );
    }
    if (Platform.OS === "ios" && !googleIosClientId()) {
      throw new Error(
        "Thiếu EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID (Firebase → iOS app → Google Sign-In).",
      );
    }
    throw new Error("Native Google Sign-In chưa sẵn sàng trên thiết bị này.");
  }

  const { GoogleSignin, isSuccessResponse } = await loadNativeGoogleSignIn();
  const webClientId = googleWebClientId();
  const iosClientId = googleIosClientId();

  if (!configured) {
    GoogleSignin.configure({
      webClientId,
      iosClientId: Platform.OS === "ios" ? iosClientId : undefined,
      offlineAccess: false,
    });
    configured = true;
  }

  if (Platform.OS === "android") {
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
  }

  const response = await GoogleSignin.signIn();
  if (!isSuccessResponse(response)) {
    throw new Error("Đăng nhập Google bị hủy.");
  }
  const idToken = response.data.idToken;
  if (!idToken) {
    throw new Error(
      "Google không trả id_token. Kiểm tra Web client ID" +
        (Platform.OS === "android" ? " + SHA-1 trên Firebase." : " + iOS client ID."),
    );
  }
  return signInWithGoogleIdToken(idToken);
}

export async function nativeGoogleSignOut(): Promise<void> {
  if (!canUseNativeGoogleSignIn()) return;
  try {
    const { GoogleSignin } = await loadNativeGoogleSignIn();
    await GoogleSignin.signOut();
  } catch {
    // ignore
  }
}

export function formatGoogleSignInError(e: unknown): string {
  if (e && typeof e === "object" && "code" in e) {
    const code = String((e as { code: unknown }).code);
    if (code === "SIGN_IN_CANCELLED" || code === "12501") {
      return "Bạn đã hủy đăng nhập Google.";
    }
    if (code === "IN_PROGRESS" || code === "12502") {
      return "Đang đăng nhập Google…";
    }
    if (code === "PLAY_SERVICES_NOT_AVAILABLE" || code === "2") {
      return "Máy cần Google Play Services để đăng nhập.";
    }
    const message = (e as { message?: unknown }).message;
    if (typeof message === "string" && message) return message;
  }
  return e instanceof Error ? e.message : "Google đăng nhập thất bại.";
}
