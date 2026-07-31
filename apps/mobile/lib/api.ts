import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";
import { createApiClient } from "@forever/api-client";

const TOKEN_KEY = "forever_token";

function resolveBaseUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (fromEnv) return fromEnv;

  const extra = Constants.expoConfig?.extra as { apiUrl?: string } | undefined;
  if (extra?.apiUrl) return extra.apiUrl;

  const host = Constants.expoConfig?.hostUri?.split(":")[0];
  if (host) return `http://${host}:8000`;

  return "http://localhost:8000";
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
