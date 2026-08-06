import * as SecureStore from "expo-secure-store";

const EMAIL_KEY = "forever_login_email";
const LEGACY_PASSWORD_KEY = "forever_login_password";

/**
 * Only the email is remembered. Firebase persists the session itself, so
 * keeping a plaintext password on the device buys nothing and costs a lot.
 */
export async function getSavedLoginEmail(): Promise<string | null> {
  try {
    // Older builds stored the password too; drop it the first time we run.
    await SecureStore.deleteItemAsync(LEGACY_PASSWORD_KEY);
    const email = (await SecureStore.getItemAsync(EMAIL_KEY))?.trim() ?? "";
    return email || null;
  } catch {
    return null;
  }
}

export async function saveLoginEmail(email: string): Promise<void> {
  await SecureStore.setItemAsync(EMAIL_KEY, email.trim());
}

export async function clearLoginEmail(): Promise<void> {
  await SecureStore.deleteItemAsync(EMAIL_KEY);
}
