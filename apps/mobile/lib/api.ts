import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";
import { createApiClient } from "@forever/api-client";

const TOKEN_KEY = "forever_token";

function resolveBaseUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (fromEnv) return fromEnv;

  // Prefer Expo packager LAN host so a physical phone can reach the API.
  const hostUri =
    Constants.expoConfig?.hostUri ||
    Constants.expoGoConfig?.debuggerHost ||
    // Legacy Expo Go / manifest fields
    (Constants as { manifest?: { debuggerHost?: string } }).manifest?.debuggerHost;
  const host = hostUri?.split(":")[0]?.trim();
  if (host && host !== "localhost" && host !== "127.0.0.1") {
    return `http://${host}:8001`;
  }

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
    baseUrl: resolveBaseUrl(),
    getToken,
  });
}
