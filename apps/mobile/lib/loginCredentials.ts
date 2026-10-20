import {
  deleteDeviceItem,
  getDeviceItem,
  setDeviceItem,
} from "./deviceStorage";

const EMAIL_KEY = "forever_login_email";
const LEGACY_PASSWORD_KEY = "forever_login_password";

/**
 * Only the email is remembered. Firebase persists the session itself, so
 * keeping a plaintext password on the device buys nothing and costs a lot.
 *
 * Stored in AsyncStorage (not Keychain) so iOS 27 cold-start never hits
 * SecureStore — a Keychain NSException there aborts the process.
 */
export async function getSavedLoginEmail(): Promise<string | null> {
  try {
    // Older builds may have left a password in AsyncStorage; drop it.
    await deleteDeviceItem(LEGACY_PASSWORD_KEY);
    const email = (await getDeviceItem(EMAIL_KEY))?.trim() ?? "";
    return email || null;
  } catch {
    return null;
  }
}

export async function saveLoginEmail(email: string): Promise<void> {
  await setDeviceItem(EMAIL_KEY, email.trim());
}

export async function clearLoginEmail(): Promise<void> {
  await deleteDeviceItem(EMAIL_KEY);
}
