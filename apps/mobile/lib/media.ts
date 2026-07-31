import * as FileSystem from "expo-file-system/legacy";

import { getStoredToken } from "./api";

/** Download authenticated media to a local cache file and return its URI. */
export async function fetchAuthedMediaUri(
  remoteUrl: string,
  memoryId: string,
): Promise<string> {
  const token = await getStoredToken();
  const dir = FileSystem.cacheDirectory;
  if (!dir) {
    throw new Error("Cache directory unavailable.");
  }
  const target = `${dir}forever-media-${memoryId}`;
  const result = await FileSystem.downloadAsync(remoteUrl, target, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (result.status !== 200) {
    throw new Error(`Không tải được media (${result.status}).`);
  }
  return result.uri;
}
