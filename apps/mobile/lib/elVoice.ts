import type { ElevenLabsVoice } from "@forever/api-client";

const VN_TIMEZONE = "Asia/Ho_Chi_Minh";
const NAME_STAMP_RE = /(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/;

/** Parse `Forever · Name · YYYY-MM-DD HH:MM` stamp (local VN wall clock). */
function parseNameStamp(v: ElevenLabsVoice): Date | null {
  const m = v.name.match(NAME_STAMP_RE);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  return new Date(+y, +mo - 1, +d, +h, +mi);
}

export function elVoiceSortKey(v: ElevenLabsVoice): number {
  if (typeof v.created_at_unix === "number" && v.created_at_unix > 0) {
    return v.created_at_unix;
  }
  const parsed = parseNameStamp(v);
  if (parsed) return Math.floor(parsed.getTime() / 1000);
  return 0;
}

export function formatElVoiceWhen(v: ElevenLabsVoice): string {
  const parsed = parseNameStamp(v);
  if (parsed) {
    return parsed.toLocaleString("vi-VN", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  const ts = elVoiceSortKey(v);
  if (!ts) return v.category || "cloned";
  return new Date(ts * 1000).toLocaleString("vi-VN", {
    timeZone: VN_TIMEZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
