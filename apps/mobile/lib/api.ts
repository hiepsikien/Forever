import Constants from "expo-constants";
import { Platform } from "react-native";
import { createApiClient } from "@forever/api-client";

import {
  deleteDeviceItem,
  getDeviceItem,
  setDeviceItem,
} from "./deviceStorage";
import { firebaseIdToken, isFirebaseConfigured } from "./firebase";

const TOKEN_KEY = "forever_token";

function metroHost(): string | null {
  const hostUri =
    Constants.expoConfig?.hostUri ||
    Constants.expoGoConfig?.debuggerHost ||
    (Constants as { manifest?: { debuggerHost?: string } }).manifest?.debuggerHost;
  const host = hostUri?.split(":")[0]?.trim();
  if (!host) return null;
  if (host === "localhost" || host === "127.0.0.1") return null;
  return host;
}

function isLocalApiUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname;
    if (host === "localhost" || host === "127.0.0.1" || host === "10.0.2.2") {
      return true;
    }
    // Stale LAN IP in .env — prefer Metro host (current Wi‑Fi IP).
    if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
    if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
    if (/^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
    return false;
  } catch {
    return (
      url.includes("localhost") ||
      url.includes("127.0.0.1") ||
      /192\.168\.\d+\.\d+/.test(url)
    );
  }
}

/**
 * Resolved on each request so hotspot/Wi‑Fi IP changes don't stick.
 * Prefer EXPO_PUBLIC_API_URL when it points at cloud/staging — Metro LAN
 * host is only used for local API dev (localhost / LAN :8001).
 */
export function resolveBaseUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (fromEnv && !isLocalApiUrl(fromEnv)) {
    return fromEnv;
  }

  const host = metroHost();
  if (host) {
    return `http://${host}:8001`;
  }

  if (fromEnv) return fromEnv;

  // Emulators only (Metro also local).
  if (Platform.OS === "android" && Constants.isDevice === false) {
    return "http://10.0.2.2:8001";
  }
  if (Platform.OS === "ios" && Constants.isDevice === false) {
    return "http://127.0.0.1:8001";
  }

  const extra = Constants.expoConfig?.extra as { apiUrl?: string } | undefined;
  if (extra?.apiUrl) return extra.apiUrl;

  return "http://localhost:8001";
}

export async function getStoredToken(): Promise<string | null> {
  return getDeviceItem(TOKEN_KEY);
}

export async function setStoredToken(token: string | null): Promise<void> {
  if (!token) {
    await deleteDeviceItem(TOKEN_KEY);
    return;
  }
  await setDeviceItem(TOKEN_KEY, token);
}

/**
 * The one place that answers "who is calling?".
 *
 * A Firebase sign-in never writes device storage — the SDK holds the session
 * and mints a fresh ID token on demand. Anything that reads the AUTH_DEV
 * token alone gets `null` for a real family member and sends an
 * unauthenticated request, which the API answers with 401. Every authenticated
 * call, including raw file downloads that bypass the API client, must resolve
 * its token through here.
 */
export async function resolveAuthToken(): Promise<string | null> {
  if (isFirebaseConfigured()) {
    const idToken = await firebaseIdToken();
    if (idToken) return idToken;
  }
  return getStoredToken();
}

export function createMobileApi(getToken: () => Promise<string | null>) {
  return createApiClient({
    baseUrl: resolveBaseUrl,
    getToken,
    timeoutMs: 60_000,
  });
}
