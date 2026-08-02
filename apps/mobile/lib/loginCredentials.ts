import * as SecureStore from "expo-secure-store";

const EMAIL_KEY = "forever_login_email";
const PASSWORD_KEY = "forever_login_password";

export async function getSavedLoginCredentials(): Promise<{
  email: string;
  password: string;
} | null> {
  try {
    const email = (await SecureStore.getItemAsync(EMAIL_KEY))?.trim() ?? "";
    const password = (await SecureStore.getItemAsync(PASSWORD_KEY)) ?? "";
    if (!email) return null;
    return { email, password };
  } catch {
    return null;
  }
}

export async function saveLoginCredentials(
  email: string,
  password: string,
): Promise<void> {
  await SecureStore.setItemAsync(EMAIL_KEY, email.trim());
  await SecureStore.setItemAsync(PASSWORD_KEY, password);
}

export async function clearLoginCredentials(): Promise<void> {
  await SecureStore.deleteItemAsync(EMAIL_KEY);
  await SecureStore.deleteItemAsync(PASSWORD_KEY);
}
