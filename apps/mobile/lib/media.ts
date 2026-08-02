import * as FileSystem from "expo-file-system/legacy";
import * as MediaLibrary from "expo-media-library";
import * as Sharing from "expo-sharing";
import { Platform } from "react-native";

import { getStoredToken } from "./api";

const EXT_BY_MIME: Record<string, string> = {
  "audio/mpeg": ".mp3",
  "audio/mp4": ".m4a",
  "audio/aac": ".aac",
  "audio/wav": ".wav",
  "audio/webm": ".webm",
  "audio/3gpp": ".3gp",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/heic": ".heic",
  "image/heif": ".heif",
};

const MIME_ALIASES: Record<string, string> = {
  "audio/mp3": "audio/mpeg",
  "audio/m4a": "audio/mp4",
  "audio/x-m4a": "audio/mp4",
  "audio/wave": "audio/wav",
  "audio/x-wav": "audio/wav",
  "audio/vnd.wave": "audio/wav",
  "audio/vnd.wav": "audio/wav",
  "audio/x-ms-wma": "audio/mpeg",
  "audio/3gp": "audio/3gpp",
};

function extensionForName(name?: string | null): string | null {
  if (!name) return null;
  const ext = name.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "mp3":
      return ".mp3";
    case "m4a":
      return ".m4a";
    case "wav":
      return ".wav";
    case "aac":
      return ".aac";
    case "webm":
      return ".webm";
    case "3gp":
      return ".3gp";
    default:
      return null;
  }
}

function mimeFromExtension(ext: string | null): string | null {
  switch (ext) {
    case ".mp3":
      return "audio/mpeg";
    case ".m4a":
      return "audio/mp4";
    case ".wav":
      return "audio/wav";
    case ".aac":
      return "audio/aac";
    case ".webm":
      return "audio/webm";
    case ".3gp":
      return "audio/3gpp";
    default:
      return null;
  }
}

/** Normalize picker / OS mime aliases for playback and upload. */
export function normalizeAudioMime(
  mime?: string | null,
  name?: string | null,
): string {
  const lower = mime?.toLowerCase().split(";")[0].trim();
  if (lower && MIME_ALIASES[lower]) return MIME_ALIASES[lower];
  if (lower && EXT_BY_MIME[lower]) return lower;

  if (lower?.startsWith("audio/")) {
    const sub = lower.slice("audio/".length);
    if (sub.includes("wav") || sub === "wave") return "audio/wav";
    if (sub.includes("mpeg") || sub === "mp3") return "audio/mpeg";
    if (sub.includes("m4a") || sub.includes("mp4")) return "audio/mp4";
    if (sub.includes("aac")) return "audio/aac";
    if (sub.includes("webm")) return "audio/webm";
    if (sub.includes("3gp")) return "audio/3gpp";
  }

  const fromName = mimeFromExtension(extensionForName(name));
  if (fromName) return fromName;
  return "audio/mpeg";
}

function extensionForMime(mime?: string | null, name?: string | null): string {
  const normalized = normalizeAudioMime(mime, name);
  if (EXT_BY_MIME[normalized]) return EXT_BY_MIME[normalized];
  const fromName = extensionForName(name);
  if (fromName) return fromName;
  return ".m4a";
}

/** Copy picked audio into cache with a real extension so AVPlayer can preview it. */
export async function stageLocalAudioFile(
  sourceUri: string,
  opts: { name?: string; mimeType?: string | null; cacheKey?: string },
): Promise<{ uri: string; name: string; mimeType: string }> {
  const dir = FileSystem.cacheDirectory;
  if (!dir) {
    throw new Error("Cache directory unavailable.");
  }

  const mimeType = normalizeAudioMime(opts.mimeType, opts.name);
  const ext = extensionForMime(mimeType, opts.name);
  const baseName = (opts.name || "sample").replace(/\.[^.]+$/, "") || "sample";
  const fileName = `${baseName}${ext}`;
  const target = `${dir}forever-pick-${opts.cacheKey ?? Date.now()}${ext}`;

  await FileSystem.copyAsync({ from: sourceUri, to: target });
  return { uri: target, name: fileName, mimeType };
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
  const existing = await FileSystem.getInfoAsync(target);
  if (existing.exists) {
    return target;
  }
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

function sanitizeExportBase(name: string): string {
  return (
    name
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 48) || "forever-tts"
  );
}

/** Copy a cached audio file to an export-friendly path with a readable name. */
export async function prepareAudioExport(
  sourceUri: string,
  baseName: string,
  mimeType?: string | null,
): Promise<string> {
  const dir = FileSystem.cacheDirectory;
  if (!dir) {
    throw new Error("Cache directory unavailable.");
  }
  const ext = extensionForMime(normalizeAudioMime(mimeType), baseName);
  const target = `${dir}${sanitizeExportBase(baseName)}${ext}`;
  await FileSystem.copyAsync({ from: sourceUri, to: target });
  return target;
}

function ensureFileUri(uri: string): string {
  if (uri.startsWith("file://")) return uri;
  return `file://${uri.startsWith("/") ? "" : "/"}${uri}`;
}

export async function shareLocalAudio(
  uri: string,
  opts?: { mimeType?: string | null; dialogTitle?: string },
): Promise<void> {
  const available = await Sharing.isAvailableAsync();
  if (!available) {
    throw new Error("Chia sẻ không khả dụng trên thiết bị này.");
  }
  const fileUri = ensureFileUri(uri);
  await Sharing.shareAsync(fileUri, {
    mimeType: normalizeAudioMime(opts?.mimeType),
    dialogTitle: opts?.dialogTitle ?? "Chia sẻ audio",
  });
}

/** Save audio locally. Android → media library; iOS → share sheet (Save to Files). */
export async function saveLocalAudioToLibrary(
  uri: string,
  opts?: { mimeType?: string | null; dialogTitle?: string },
): Promise<"library" | "share_sheet"> {
  const fileUri = ensureFileUri(uri);
  const info = await FileSystem.getInfoAsync(fileUri);
  if (!info.exists) {
    throw new Error("Không tìm thấy file audio để lưu.");
  }

  if (Platform.OS === "ios") {
    // iOS Photo Library rejects audio — export via share sheet → "Save to Files".
    await shareLocalAudio(fileUri, {
      mimeType: opts?.mimeType,
      dialogTitle: opts?.dialogTitle ?? "Lưu audio",
    });
    return "share_sheet";
  }

  const perm = await MediaLibrary.requestPermissionsAsync();
  if (perm.status !== "granted") {
    throw new Error("Cần quyền truy cập thư viện để lưu file audio.");
  }
  await MediaLibrary.createAssetAsync(fileUri);
  return "library";
}
