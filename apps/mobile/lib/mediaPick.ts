import * as DocumentPicker from "expo-document-picker";

/** Camcorder / family archive extensions we accept as video for library + Extract. */
export const VIDEO_FILE_EXTENSIONS = new Set([
  ".mts",
  ".m2ts",
  ".mp4",
  ".mov",
  ".mkv",
  ".avi",
  ".wmv",
  ".webm",
  ".3gp",
]);

export const AUDIO_FILE_EXTENSIONS = new Set([
  ".mp3",
  ".m4a",
  ".wav",
  ".aac",
  ".webm",
  ".3gp",
]);

/**
 * iOS Files gray-outs .mts when picker is only `video/*` — AVCHD uses
 * `public.mpeg-2-transport-stream`, not generic public.movie.
 */
const IOS_VIDEO_UTIS = [
  "public.mpeg-2-transport-stream",
  "public.mpeg-2-video",
  "public.movie",
  "com.apple.quicktime-movie",
  "com.apple.m4v-video",
] as const;

export const VIDEO_MEMORY_PICKER_TYPES: string[] = [
  "video/*",
  ...IOS_VIDEO_UTIS,
  "*/*",
];

export const EXTRACT_MEDIA_PICKER_TYPES: string[] = [
  "audio/*",
  "video/*",
  ...IOS_VIDEO_UTIS,
  "*/*",
];

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot < 0) return "";
  return name.slice(dot).toLowerCase();
}

export function guessVideoMime(name: string, mimeType?: string | null): string {
  const mime = mimeType?.split(";")[0].trim().toLowerCase();
  if (mime && mime.startsWith("video/") && mime !== "video/*") return mime;
  switch (extensionOf(name)) {
    case ".mts":
    case ".m2ts":
      return "video/mp2t";
    case ".mp4":
      return "video/mp4";
    case ".mov":
      return "video/quicktime";
    case ".mkv":
      return "video/x-matroska";
    case ".avi":
      return "video/x-msvideo";
    case ".wmv":
      return "video/x-ms-wmv";
    case ".webm":
      return "video/webm";
    case ".3gp":
      return "video/3gpp";
    default:
      return mime && mime !== "application/octet-stream" ? mime : "video/mp2t";
  }
}

export function guessAudioMime(name: string, mimeType?: string | null): string {
  const mime = mimeType?.split(";")[0].trim().toLowerCase();
  if (mime && mime.startsWith("audio/") && mime !== "audio/*") return mime;
  switch (extensionOf(name)) {
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
      return mime && mime !== "application/octet-stream" ? mime : "audio/m4a";
  }
}

export function isAllowedVideoFile(name: string, mimeType?: string | null): boolean {
  if (VIDEO_FILE_EXTENSIONS.has(extensionOf(name))) return true;
  const mime = mimeType?.toLowerCase() ?? "";
  return mime.startsWith("video/");
}

export function isAllowedExtractFile(name: string, mimeType?: string | null): boolean {
  if (isAllowedVideoFile(name, mimeType)) return true;
  if (AUDIO_FILE_EXTENSIONS.has(extensionOf(name))) return true;
  const mime = mimeType?.toLowerCase() ?? "";
  return mime.startsWith("audio/");
}

export async function pickVideoMemoryFile(): Promise<DocumentPicker.DocumentPickerAsset | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: VIDEO_MEMORY_PICKER_TYPES,
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled || !result.assets?.[0]) return null;
  const asset = result.assets[0];
  const name = asset.name || "video.mts";
  if (!isAllowedVideoFile(name, asset.mimeType)) {
    throw new Error(
      "Định dạng chưa hỗ trợ. Dùng mts, mp4, mov, mkv…",
    );
  }
  return asset;
}

export async function pickExtractMediaFile(): Promise<DocumentPicker.DocumentPickerAsset | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: EXTRACT_MEDIA_PICKER_TYPES,
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled || !result.assets?.[0]) return null;
  const asset = result.assets[0];
  const name = asset.name || "tape.m4a";
  if (!isAllowedExtractFile(name, asset.mimeType)) {
    throw new Error(
      "Định dạng chưa hỗ trợ. Dùng audio hoặc video (mts, mp4, mov…).",
    );
  }
  return asset;
}
