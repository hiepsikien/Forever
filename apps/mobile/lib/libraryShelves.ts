/** Client-side grouping, filtering, and sort for the redesigned library. */

import { IdentityProfile, MemoryCandidate, MemoryItem } from "@forever/api-client";

import { identityChipLabel } from "@/lib/identityDisplay";
import { parseHeritageIdentityIds, tagTokens, isCalendarYearOnly } from "@/lib/memoryTags";

export const UNTAGGED_PERSON_ID = "_none";

export function rememberedLibraryPeople(
  identities: IdentityProfile[],
): IdentityProfile[] {
  return identities.filter((i) => !i.archived_at && i.status === "remembered");
}

/** Living members (and linked «Tôi») — light pages on the family hub. */
export function livingLibraryPeople(
  identities: IdentityProfile[],
): IdentityProfile[] {
  return identities.filter((i) => !i.archived_at && i.status !== "remembered");
}

export type ShelfId = "life" | "poems" | "artifacts" | "heard";

export type ShelfFilter = "all" | ShelfId;

export type ShelfCounts = Record<ShelfId, number>;

export type PersonHubRow = {
  identityId: string;
  label: string;
  handle?: string | null;
  status?: string;
  counts: ShelfCounts;
  poemOwn: number;
  poemGift: number;
  total: number;
};

export type DecadeSection = {
  key: string;
  label: string;
  items: MemoryItem[];
};

const ARTIFACT_KINDS = new Set(["photo", "video", "voice", "note"]);

export function shelfForKind(kind: string): ShelfId | null {
  if (kind === "milestone") return "life";
  if (kind === "poem") return "poems";
  if (kind === "knowledge") return "heard";
  if (ARTIFACT_KINDS.has(kind)) return "artifacts";
  return "artifacts";
}

export function emptyCounts(): ShelfCounts {
  return { life: 0, poems: 0, artifacts: 0, heard: 0 };
}

export function countShelves(items: MemoryItem[]): ShelfCounts {
  const counts = emptyCounts();
  for (const item of items) {
    const shelf = shelfForKind(item.kind);
    if (shelf) counts[shelf] += 1;
  }
  return counts;
}

export function memoriesForPerson(
  memories: MemoryItem[],
  identityId: string,
): MemoryItem[] {
  if (identityId === UNTAGGED_PERSON_ID) {
    return memories.filter((m) => parseHeritageIdentityIds(m.tags).length === 0);
  }
  return memories.filter((m) =>
    parseHeritageIdentityIds(m.tags).includes(identityId),
  );
}

export function candidatesForPerson(
  candidates: MemoryCandidate[],
  identityId: string,
): MemoryCandidate[] {
  if (identityId === UNTAGGED_PERSON_ID) return [];
  return candidates.filter((c) => c.identity_id === identityId);
}

export function buildPersonHubRows(
  memories: MemoryItem[],
  identities: IdentityProfile[],
  candidates: MemoryCandidate[],
  userId?: string | null,
): PersonHubRow[] {
  const byId = new Map<string, MemoryItem[]>();
  const untagged: MemoryItem[] = [];

  for (const memory of memories) {
    const ids = parseHeritageIdentityIds(memory.tags);
    if (ids.length === 0) {
      untagged.push(memory);
      continue;
    }
    for (const id of ids) {
      const list = byId.get(id) ?? [];
      list.push(memory);
      byId.set(id, list);
    }
  }

  const pendingByIdentity = new Map<string, number>();
  for (const c of candidates) {
    pendingByIdentity.set(
      c.identity_id,
      (pendingByIdentity.get(c.identity_id) ?? 0) + 1,
    );
  }

  const rows: PersonHubRow[] = [];
  for (const identity of identities) {
    const items = byId.get(identity.id) ?? [];
    const counts = countShelves(items);
    counts.heard += pendingByIdentity.get(identity.id) ?? 0;
    const poems = items.filter((m) => m.kind === "poem");
    const { own, gift } = partitionPoems(poems);
    const total =
      counts.life + counts.poems + counts.artifacts + counts.heard;
    rows.push({
      identityId: identity.id,
      label: identityChipLabel(identity, userId),
      handle: identity.handle ?? null,
      status: identity.status,
      counts,
      poemOwn: own.length,
      poemGift: gift.length,
      total,
    });
  }

  rows.sort((a, b) => {
    if (b.total !== a.total) return b.total - a.total;
    return a.label.localeCompare(b.label, "vi");
  });

  const untaggedCounts = countShelves(untagged);
  const untaggedPoems = partitionPoems(
    untagged.filter((m) => m.kind === "poem"),
  );
  const untaggedTotal =
    untaggedCounts.life +
    untaggedCounts.poems +
    untaggedCounts.artifacts +
    untaggedCounts.heard;
  if (untaggedTotal > 0) {
    rows.push({
      identityId: UNTAGGED_PERSON_ID,
      label: "Chưa neo ai",
      counts: untaggedCounts,
      poemOwn: untaggedPoems.own.length,
      poemGift: untaggedPoems.gift.length,
      total: untaggedTotal,
    });
  }

  return rows;
}

export function formatShelfSummary(
  counts: ShelfCounts,
  opts?: {
    poemOwn?: number;
    poemGift?: number;
    /** Person memorial uses «mốc đời»; family hub calendar uses «ngày». */
    lifeAsMilestones?: boolean;
  },
): string {
  const parts: string[] = [];
  if (counts.life) {
    parts.push(
      opts?.lifeAsMilestones
        ? `${counts.life} mốc đời`
        : `${counts.life} ngày gia đình`,
    );
  }
  const own = opts?.poemOwn;
  const gift = opts?.poemGift;
  if (typeof own === "number" && typeof gift === "number" && (own > 0 || gift > 0)) {
    if (own > 0 && gift > 0) parts.push(`${own} thơ · ${gift} thơ tặng`);
    else if (gift > 0) parts.push(`${gift} thơ tặng`);
    else parts.push(`${own} bài thơ`);
  } else if (counts.poems) {
    parts.push(`${counts.poems} bài thơ`);
  }
  if (counts.artifacts) parts.push(`${counts.artifacts} hiện vật`);
  if (counts.heard) parts.push(`${counts.heard} điều nghe được`);
  return parts.length ? parts.join(" · ") : "Chưa có ký ức";
}

function foldVi(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function matchesSearch(item: MemoryItem, query: string): boolean {
  const q = foldVi(query.trim());
  if (!q) return true;
  return foldVi(`${item.title}\n${item.body}`).includes(q);
}

export function filterMemories(
  items: MemoryItem[],
  opts: {
    shelf?: ShelfFilter;
    query?: string;
    privateOnly?: boolean;
  },
): MemoryItem[] {
  const shelf = opts.shelf ?? "all";
  return items.filter((item) => {
    if (opts.privateOnly && item.visibility !== "private") return false;
    if (shelf !== "all" && shelfForKind(item.kind) !== shelf) return false;
    if (opts.query && !matchesSearch(item, opts.query)) return false;
    return true;
  });
}

function occurredMs(item: MemoryItem): number | null {
  if (!item.occurred_at) return null;
  const t = Date.parse(item.occurred_at);
  return Number.isFinite(t) ? t : null;
}

function createdMs(item: MemoryItem): number {
  const t = Date.parse(item.created_at);
  return Number.isFinite(t) ? t : 0;
}

/** Dòng đời cũ: oldest first; undated last. */
export function sortLifeTimeline(items: MemoryItem[]): MemoryItem[] {
  return [...items].sort((a, b) => {
    const ao = occurredMs(a);
    const bo = occurredMs(b);
    if (ao == null && bo == null) return createdMs(a) - createdMs(b);
    if (ao == null) return 1;
    if (bo == null) return -1;
    if (ao !== bo) return ao - bo;
    return createdMs(a) - createdMs(b);
  });
}

function utcParts(occurredAt: string): { y: number; m: number; d: number } | null {
  const t = Date.parse(occurredAt);
  if (!Number.isFinite(t)) return null;
  const dt = new Date(t);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

function isYearOnlyMilestone(item: MemoryItem): boolean {
  if (isCalendarYearOnly(item.tags)) return true;
  if (!item.occurred_at) return false;
  const p = utcParts(item.occurred_at);
  return Boolean(p && p.m === 1 && p.d === 1 && !item.tags?.includes("lich-precision:day"));
}

function mdKey(month: number, day: number): number {
  return month * 100 + day;
}

/** Lịch gia đình: sắp tới theo tháng/ngày, rồi đã qua, năm, chưa rõ. */
export function groupFamilyCalendar(
  items: MemoryItem[],
  now: Date = new Date(),
): DecadeSection[] {
  const todayMd = mdKey(now.getMonth() + 1, now.getDate());
  const upcoming: MemoryItem[] = [];
  const past: MemoryItem[] = [];
  const yearOnly: MemoryItem[] = [];
  const unknown: MemoryItem[] = [];

  for (const item of items) {
    if (!item.occurred_at) {
      unknown.push(item);
      continue;
    }
    if (isYearOnlyMilestone(item)) {
      yearOnly.push(item);
      continue;
    }
    const p = utcParts(item.occurred_at);
    if (!p) {
      unknown.push(item);
      continue;
    }
    if (mdKey(p.m, p.d) >= todayMd) upcoming.push(item);
    else past.push(item);
  }

  const byNext = (a: MemoryItem, b: MemoryItem) => {
    const pa = utcParts(a.occurred_at!)!;
    const pb = utcParts(b.occurred_at!)!;
    const da = mdKey(pa.m, pa.d);
    const db = mdKey(pb.m, pb.d);
    if (da !== db) return da - db;
    return pb.y - pa.y;
  };
  upcoming.sort(byNext);
  past.sort(byNext);
  yearOnly.sort((a, b) => (occurredMs(a) ?? 0) - (occurredMs(b) ?? 0));
  unknown.sort((a, b) => createdMs(a) - createdMs(b));

  const sections: DecadeSection[] = [];
  if (upcoming.length) sections.push({ key: "upcoming", label: "Sắp tới", items: upcoming });
  if (past.length) sections.push({ key: "past", label: "Đã qua trong năm", items: past });
  if (yearOnly.length) sections.push({ key: "year", label: "Chỉ biết năm", items: yearOnly });
  if (unknown.length) sections.push({ key: "unknown", label: "Chưa rõ ngày", items: unknown });
  return sections;
}

/** @deprecated decade biography — kept for any leftover callers */
export function groupLifeByDecade(items: MemoryItem[]): DecadeSection[] {
  const sorted = sortLifeTimeline(items);
  const map = new Map<string, MemoryItem[]>();
  const order: string[] = [];

  for (const item of sorted) {
    const ms = occurredMs(item);
    let key: string;
    let label: string;
    if (ms == null) {
      key = "unknown";
      label = "Chưa rõ năm";
    } else {
      const year = new Date(ms).getUTCFullYear();
      const decade = Math.floor(year / 10) * 10;
      key = String(decade);
      label = `${decade}s`;
    }
    if (!map.has(key)) {
      map.set(key, []);
      order.push(key);
    }
    map.get(key)!.push(item);
  }

  return order.map((key) => ({
    key,
    label: key === "unknown" ? "Chưa rõ năm" : `${key}s`,
    items: map.get(key)!,
  }));
}

export function yearLabel(occurredAt: string | null | undefined): string {
  if (!occurredAt) return "?";
  const t = Date.parse(occurredAt);
  if (!Number.isFinite(t)) return "?";
  return String(new Date(t).getUTCFullYear());
}

export function calendarDateLabel(
  occurredAt: string | null | undefined,
  tags?: string | null,
): string {
  if (!occurredAt) return "?";
  const p = utcParts(occurredAt);
  if (!p) return "?";
  if (
    isCalendarYearOnly(tags) ||
    (p.m === 1 && p.d === 1 && !tags?.includes("lich-precision:day"))
  ) {
    return String(p.y);
  }
  return `${p.d}/${p.m}`;
}

/** Thơ / hiện vật / knowledge: newest saved first. */
export function sortByCreatedDesc(items: MemoryItem[]): MemoryItem[] {
  return [...items].sort((a, b) => createdMs(b) - createdMs(a));
}

export function themeFromTags(tags: string): string[] {
  const themes: string[] = [];
  for (const token of tagTokens(tags)) {
    if (token.startsWith("chu-de:")) {
      themes.push(token.slice("chu-de:".length));
    }
  }
  return themes;
}

export function meterFromTags(tags: string): string | null {
  for (const token of tagTokens(tags)) {
    if (token.startsWith("meter:")) {
      const m = token.slice("meter:".length);
      return m && m !== "unknown" ? m : null;
    }
  }
  return null;
}

/** own | gift — missing tag treated as own (legacy). */
export function poemAuthorshipFromTags(tags: string | null | undefined): "own" | "gift" {
  for (const token of tagTokens(tags ?? "")) {
    if (token === "tho:tang") return "gift";
  }
  return "own";
}

export function isGiftPoem(tags: string | null | undefined): boolean {
  return poemAuthorshipFromTags(tags) === "gift";
}

export function partitionPoems(poems: MemoryItem[]): {
  own: MemoryItem[];
  gift: MemoryItem[];
} {
  const own: MemoryItem[] = [];
  const gift: MemoryItem[] = [];
  for (const poem of poems) {
    if (isGiftPoem(poem.tags)) gift.push(poem);
    else own.push(poem);
  }
  return { own, gift };
}

export const THEME_LABELS: Record<string, string> = {
  vo_chong: "Vợ chồng",
  con_cai: "Con cái",
  gia_dinh: "Gia đình",
  nghe_giao: "Nghề giáo",
  tho: "Thơ",
  biet_on: "Biết ơn",
  truyen_thong: "Truyền thống",
};

export const METER_LABELS: Record<string, string> = {
  luc_bat: "Lục bát",
  song_that_luc_bat: "Song thất lục bát",
  that_ngon: "Thất ngôn",
  other: "Thể khác",
};

export function meterLabel(meter: string | null | undefined): string | null {
  if (!meter || meter === "unknown") return null;
  return METER_LABELS[meter] ?? meter.replace(/_/g, " ");
}

export const SHELF_LABELS: Record<ShelfFilter, string> = {
  all: "Tất cả",
  life: "Lịch gia đình",
  poems: "Thơ",
  artifacts: "Hiện vật",
  heard: "Điều nghe được",
};

/** Person memorial shelf — only days tagged to that person. */
export const PERSON_LIFE_LABEL = "Mốc đời";
