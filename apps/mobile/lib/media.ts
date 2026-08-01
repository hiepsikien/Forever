import * as FileSystem from "expo-file-system/legacy";

import { getStoredToken } from "./api";

const EXT_BY_MIME: Record<string, string> = {
  "audio/mpeg": ".mp3",
  "audio/mp4": ".m4a",
  "audio/m4a": ".m4a",
  "audio/x-m4a": ".m4a",
  "audio/aac": ".aac",
  "audio/wav": ".wav",
  "audio/x-wav": ".wav",
  "audio/webm": ".webm",
  "audio/3gpp": ".3gp",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/heic": ".heic",
  "image/heif": ".heif",
};

function extensionForMime(mime?: string | null): string {
  if (!mime) return ".m4a";
  return EXT_BY_MIME[mime.toLowerCase()] ?? ".bin";
}

/** Download authenticated media to a local cache file and return its URI. */
export async function fetchAuthedMediaUri(
  remoteUrl: string,
  cacheKey: string,
  mimeType?: string | null,
): Promise<string> {
  const token = await getStoredToken();
  const dir = FileSystem.cacheDirectory;
  if (!dir) {
    throw new Error("Cache directory unavailable.");
  }
  // iOS AVPlayer needs a real extension (-11828 without one).
  const ext = extensionForMime(mimeType);
  const target = `${dir}forever-media-${cacheKey}${ext}`;
  const result = await FileSystem.downloadAsync(remoteUrl, target, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (result.status !== 200) {
    throw new Error(`Không tải được media (${result.status}).`);
  }
  return result.uri;
}

/** Write binary audio (e.g. TTS) to cache and return a playable file URI. */
export async function writeCacheAudio(
  bytes: Uint8Array,
  cacheKey: string,
  mimeType = "audio/mpeg",
): Promise<string> {
  const dir = FileSystem.cacheDirectory;
  if (!dir) {
    throw new Error("Cache directory unavailable.");
  }
  const ext = extensionForMime(mimeType);
  const target = `${dir}forever-tts-${cacheKey}${ext}`;
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  if (typeof btoa !== "function") {
    throw new Error("Base64 encode unavailable on this runtime.");
  }
  await FileSystem.writeAsStringAsync(target, btoa(binary), {
    encoding: FileSystem.EncodingType.Base64,
  });
  return target;
}
