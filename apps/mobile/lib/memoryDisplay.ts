/** Display helpers for memory library cards. */

const GENERIC_TITLES: Record<string, readonly string[]> = {
  video: ["Video ký ức"],
  photo: ["Ảnh ký ức"],
  voice: ["Voice note", "Giọng nói từ Phòng khách"],
};

const GENERIC_BODIES = new Set([
  "Có thể dùng cho Giọng từ ký ức (Extract).",
  "Voice note từ chat",
]);

export function titleFromFileName(name: string): string {
  const base = name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
  return base || "Ký ức mới";
}

export function isGenericMemoryTitle(kind: string, title: string): boolean {
  const list = GENERIC_TITLES[kind] ?? [];
  return list.includes(title.trim());
}

export function displayMemoryTitle(kind: string, title: string): string {
  const trimmed = title.trim();
  if (!trimmed || isGenericMemoryTitle(kind, trimmed)) {
    if (kind === "video") return "Video chưa đặt tên";
    if (kind === "photo") return "Ảnh chưa đặt tên";
    if (kind === "voice") return "Giọng chưa đặt tên";
    return trimmed || "Không tiêu đề";
  }
  return trimmed;
}

export function displayMemoryNote(body: string): string | null {
  const trimmed = body.trim();
  if (!trimmed || GENERIC_BODIES.has(trimmed)) return null;
  return trimmed;
}

export function kindEmoji(kind: string): string {
  if (kind === "video") return "▶";
  if (kind === "photo") return "🖼";
  if (kind === "voice") return "🎙";
  if (kind === "note") return "📝";
  return "•";
}
