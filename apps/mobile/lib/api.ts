import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { createApiClient } from "@forever/api-client";

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

/**
 * Resolved on each request so hotspot/Wi‑Fi IP changes don't stick.
 * Prefer Metro's LAN host whenever available — never use loopback on a phone.
 */
export function resolveBaseUrl(): string {
  const host = metroHost();
  if (host) {
    return `http://${host}:8001`;
  }

  const fromEnv = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (
    fromEnv &&
    !fromEnv.includes("localhost") &&
    !fromEnv.includes("127.0.0.1")
  ) {
    return fromEnv;
  }

  // Emulators only (Metro also local).
  if (Platform.OS === "android" && Constants.isDevice === false) {
    return "http://10.0.2.2:8001";
  }
  if (Platform.OS === "ios" && Constants.isDevice === false) {
    return "http://127.0.0.1:8001";
  }

  if (fromEnv) return fromEnv;

  const extra = Constants.expoConfig?.extra as { apiUrl?: string } | undefined;
  if (extra?.apiUrl) return extra.apiUrl;

  return "http://localhost:8001";
}

export async function getStoredToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(TOKEN_KEY);
  } catch {
    return null;
  }
}

export async function setStoredToken(token: string | null): Promise<void> {
  if (!token) {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    return;
  }
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

export function createMobileApi(getToken: () => Promise<string | null>) {
  return createApiClient({
    baseUrl: resolveBaseUrl,
    getToken,
  });
}
