import AsyncStorage from "@react-native-async-storage/async-storage";

function enteredKey(userId: string): string {
  return `forever:entered-a-space:${userId}`;
}

/** One skip per JS session so Back from Nhà still reaches the space picker. */
let autoEnteredForUserId: string | null = null;

export function consumeHomeSkip(userId: string): boolean {
  if (autoEnteredForUserId === userId) return false;
  autoEnteredForUserId = userId;
  return true;
}

/** Call when the user opens a space so this session will not bounce them back. */
export function rememberOpenedSpaceThisSession(userId: string): void {
  autoEnteredForUserId = userId;
}

/** True after this account has opened a family space at least once on this device. */
export async function hasEnteredASpace(userId: string): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(enteredKey(userId))) === "1";
  } catch {
    return false;
  }
}

export async function markEnteredASpace(userId: string): Promise<void> {
  rememberOpenedSpaceThisSession(userId);
  try {
    await AsyncStorage.setItem(enteredKey(userId), "1");
  } catch {
    // ignore — next launch will show the picker again
  }
}
