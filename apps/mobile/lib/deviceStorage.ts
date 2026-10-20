import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Lightweight on-device KV for non-secret prefs (remembered email, AUTH_DEV
 * JWTs). Firebase already persists the real family session in AsyncStorage.
 *
 * Do not use expo-secure-store here: on iOS 26/27 a Keychain NSException from
 * SecureStore during cold start aborts through TurboModule
 * performVoidMethodInvocation before JS can catch it.
 */
export async function getDeviceItem(key: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(key);
  } catch {
    return null;
  }
}

export async function setDeviceItem(key: string, value: string): Promise<void> {
  try {
    await AsyncStorage.setItem(key, value);
  } catch {
    // Prefer a forgotten preference over a launch crash.
  }
}

export async function deleteDeviceItem(key: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(key);
  } catch {
    // ignore
  }
}
