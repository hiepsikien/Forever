import Constants from "expo-constants";
import { Platform } from "react-native";

import { googleWebClientId, signInWithGoogleIdToken } from "./firebase";

let configured = false;

function isExpoGo(): boolean {
  return Constants.appOwnership === "expo";
}

/** Native Google Sign-In only in a custom Android binary — never Expo Go. */
export function canUseNativeGoogleSignIn(): boolean {
  return Platform.OS === "android" && !isExpoGo() && Boolean(googleWebClientId());
}

async function loadNativeGoogleSignIn() {
  // Dynamic import so Expo Go does not crash on TurboModuleRegistry at startup.
  return import("@react-native-google-signin/google-signin");
}

export async function signInWithNativeGoogle() {
  if (!canUseNativeGoogleSignIn()) {
    throw new Error("Native Google Sign-In chỉ dùng trên bản Android standalone.");
  }
  const { GoogleSignin, isSuccessResponse } = await loadNativeGoogleSignIn();
  const webClientId = googleWebClientId();
  if (!webClientId) {
    throw new Error("Thiếu EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID.");
  }
  if (!configured) {
    GoogleSignin.configure({
      webClientId,
      offlineAccess: false,
    });
    configured = true;
  }
  await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
  const response = await GoogleSignin.signIn();
  if (!isSuccessResponse(response)) {
    throw new Error("Đăng nhập Google bị hủy.");
  }
  const idToken = response.data.idToken;
  if (!idToken) {
    throw new Error(
      "Google không trả id_token. Kiểm tra Web client ID + SHA-1 trên Firebase.",
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
    // statusCodes from the native package — avoid importing them in Expo Go.
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
