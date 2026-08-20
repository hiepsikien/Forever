import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";

const PICKING_IN_PROGRESS = /picking in progress/i;

let pickLock: Promise<DocumentPicker.DocumentPickerResult> | null = null;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function documentPickerErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (PICKING_IN_PROGRESS.test(message)) {
    return "Đang mở chọn file. Đợi cửa sổ chọn đóng rồi thử lại.";
  }
  return message || "Không chọn được file.";
}

/**
 * iOS Expo DocumentPicker keeps a native lock; a second call throws
 * "Different document picking in progress" instead of opening Files.
 */
export async function getDocumentAsyncSafe(
  options: DocumentPicker.DocumentPickerOptions,
): Promise<DocumentPicker.DocumentPickerResult> {
  if (pickLock) {
    throw new Error("Đang mở chọn file. Đợi cửa sổ chọn đóng rồi thử lại.");
  }
  const run = (async () => {
    try {
      return await DocumentPicker.getDocumentAsync(options);
    } catch (error) {
      if (!PICKING_IN_PROGRESS.test(error instanceof Error ? error.message : "")) {
        throw error;
      }
      await delay(400);
      try {
        return await DocumentPicker.getDocumentAsync(options);
      } catch (retry) {
        throw new Error(documentPickerErrorMessage(retry));
      }
    }
  })();
  pickLock = run.finally(() => {
    pickLock = null;
  });
  return run;
}

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

export type PickedVideo = {
  uri: string;
  name: string;
  mimeType: string;
  size?: number | null;
};

/** The phone refused the photo library — nothing to do with the family role. */
export class MediaPermissionError extends Error {
  constructor() {
    super("Máy chưa cho Forever đọc Ảnh.");
    this.name = "MediaPermissionError";
  }
}

/**
 * Phone camera roll — not Files. Avoids expo-document-picker's iOS native lock.
 * Picking a photo needs no permission, but an untouched video does: iOS hands
 * back the original file, so it asks for library access.
 */
export async function pickVideoFromPhotos(): Promise<PickedVideo | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) {
    throw new MediaPermissionError();
  }
  const picked = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["videos"],
    quality: 1,
  });
  if (picked.canceled || !picked.assets[0]) return null;
  const asset = picked.assets[0];
  const name = asset.fileName ?? "video.mp4";
  return {
    uri: asset.uri,
    name,
    mimeType: guessVideoMime(name, asset.mimeType),
    size: asset.fileSize ?? null,
  };
}

export async function pickVideoMemoryFile(): Promise<DocumentPicker.DocumentPickerAsset | null> {
  const result = await getDocumentAsyncSafe({
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
  const result = await getDocumentAsyncSafe({
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
