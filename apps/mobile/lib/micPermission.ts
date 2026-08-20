import {
  getRecordingPermissionsAsync,
  requestRecordingPermissionsAsync,
} from "expo-audio";
import { Linking } from "react-native";

/**
 * Mic permission for a hold-to-talk take.
 *
 * `requestRecordingPermissionsAsync` launches Android's GrantPermissionsActivity
 * **every time**, and that activity steals focus for ~200ms whether or not it
 * has anything to show: already granted, or hard-denied in Settings, it appears
 * and finishes on its own. Our window loses focus, AppState reports we left the
 * app, and the take we just opened dies. So:
 *
 * - ask the system what it already knows (`get…`, no UI, no focus change) first;
 * - launch the real dialog at most once per app run, because a second launch on
 *   a denied permission only repeats the flash — Android will not show mẹ a
 *   dialog it has already been told to stop showing.
 *
 * When it stays denied, the way back is Settings, not another request.
 */
let granted = false;
let dialogShown = false;
let requesting = false;
/** Android has been told to stop asking — possibly in an earlier app run. */
let blocked = false;

/** True while a system dialog may be stealing focus. */
export function isRequestingRecordingPermission(): boolean {
  return requesting;
}

/** Denied and we cannot ask again this run — only Settings can fix it. */
export function micPermissionNeedsSettings(): boolean {
  return !granted && (dialogShown || blocked);
}

export function openMicSettings(): void {
  void Linking.openSettings();
}

export async function ensureRecordingPermission(): Promise<boolean> {
  if (granted) return true;
  requesting = true;
  try {
    // Cheap and silent, so it also picks up a grant made in Settings meanwhile.
    const current = await getRecordingPermissionsAsync();
    if (current.granted) {
      granted = true;
      blocked = false;
      return true;
    }
    if (!current.canAskAgain) blocked = true;
    if (dialogShown || !current.canAskAgain) return false;
    dialogShown = true;
    const asked = await requestRecordingPermissionsAsync();
    granted = asked.granted;
    return asked.granted;
  } catch {
    return false;
  } finally {
    requesting = false;
  }
}
