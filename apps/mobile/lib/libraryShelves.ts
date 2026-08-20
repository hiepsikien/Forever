/** Client-side grouping, filtering, and sort for the redesigned library. */

import { IdentityProfile, MemoryCandidate, MemoryItem } from "@forever/api-client";

import { identityChipLabel } from "@/lib/identityDisplay";
import {
  parseHeritageIdentityIds,
  tagTokens,
  isCalendarYearOnly,
  isLunarMemorialKind,
  parseCalendarKind,
} from "@/lib/memoryTags";
import {
  nextLunarAnniversarySolar,
  solarToLunar,
  type Ymd,
} from "@/lib/vnLunar";
import {
  calendarGioOrdinalLabel,
  dedupeMourningMilestones,
  isDeathMilestone,
  parseRiteId,
  titleAlreadyHasGioOrdinal,
} from "@/lib/mourningRites";
import { displayMemoryTitle } from "@/lib/memoryDisplay";

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

function ymdKey(day: Ymd): number {
  return day.y * 10000 + day.m * 100 + day.d;
}

function todayYmd(now: Date): Ymd {
  return {
    y: now.getFullYear(),
    m: now.getMonth() + 1,
    d: now.getDate(),
  };
}

/**
 * Absolute solar day used to order the family calendar.
 * 49 / 100 / giỗ đầu / ngày mất → đúng ngày đã lưu (một lần).
 * Giỗ thường → lần âm kế tiếp. Cưới·sinh → dương năm nay/tới.
 */
function calendarOccurrenceSolar(item: MemoryItem, now: Date): Ymd | null {
  const p = utcParts(item.occurred_at!);
  if (!p) return null;
  const rite = parseRiteId(item.tags);
  if (rite === "49" || rite === "100" || rite === "gio_dau") {
    return p;
  }
  if (isDeathMilestone(item)) {
    return p;
  }
  if (isLunarMemorialKind(item.tags)) {
    return nextLunarAnniversarySolar(p, now) ?? p;
  }
  // Cưới / sinh / khác — neo theo dương trong năm nay (đã qua hoặc còn tới).
  const today = todayYmd(now);
  return { y: today.y, m: p.m, d: p.d };
}

/** Lịch gia đình: sắp tới theo ngày dương tuyệt đối, rồi đã qua, năm, chưa rõ. */
export function groupFamilyCalendar(
  items: MemoryItem[],
  now: Date = new Date(),
): DecadeSection[] {
  const deduped = dedupeMourningMilestones(items);
  const today = todayYmd(now);
  const todayKey = ymdKey(today);
  const upcoming: MemoryItem[] = [];
  const past: MemoryItem[] = [];
  const yearOnly: MemoryItem[] = [];
  const unknown: MemoryItem[] = [];

  for (const item of deduped) {
    if (!item.occurred_at) {
      unknown.push(item);
      continue;
    }
    if (isYearOnlyMilestone(item)) {
      yearOnly.push(item);
      continue;
    }
    const sort = calendarOccurrenceSolar(item, now);
    if (!sort) {
      unknown.push(item);
      continue;
    }
    if (ymdKey(sort) >= todayKey) upcoming.push(item);
    else past.push(item);
  }

  const byOccurrenceAsc = (a: MemoryItem, b: MemoryItem) => {
    const pa = calendarOccurrenceSolar(a, now)!;
    const pb = calendarOccurrenceSolar(b, now)!;
    const da = ymdKey(pa);
    const db = ymdKey(pb);
    if (da !== db) return da - db;
    return (a.title || "").localeCompare(b.title || "", "vi");
  };

  /** Đã xảy ra: theo ngày gốc trên dòng đời (sinh → cưới → mất → …). */
  const byAbsoluteAsc = (a: MemoryItem, b: MemoryItem) => {
    const pa = utcParts(a.occurred_at!)!;
    const pb = utcParts(b.occurred_at!)!;
    const da = ymdKey(pa);
    const db = ymdKey(pb);
    if (da !== db) return da - db;
    return (a.title || "").localeCompare(b.title || "", "vi");
  };

  upcoming.sort(byOccurrenceAsc);
  past.sort(byAbsoluteAsc);
  yearOnly.sort((a, b) => (occurredMs(a) ?? 0) - (occurredMs(b) ?? 0));
  unknown.sort((a, b) => createdMs(a) - createdMs(b));

  const sections: DecadeSection[] = [];
  if (upcoming.length) {
    sections.push({ key: "upcoming", label: "Sắp tới", items: upcoming });
  }
  if (past.length) {
    sections.push({ key: "past", label: "Đã xảy ra", items: past });
  }
  if (yearOnly.length) {
    sections.push({ key: "year", label: "Chỉ biết năm", items: yearOnly });
  }
  if (unknown.length) {
    sections.push({ key: "unknown", label: "Chưa rõ ngày", items: unknown });
  }
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
  item?: MemoryItem,
): string {
  const lines = calendarDateLines(occurredAt, tags, new Date(), item);
  return lines.secondary
    ? `${lines.primary} · ${lines.secondary}`
    : lines.primary;
}

/**
 * Date column — same stack everywhere so rows align:
 *   trên: ngày/tháng(/năm khi cần — giỗ đầu, 49, 100, mất…)
 *   dưới: ngày/tháng âm (cưới·sinh bỏ dòng này)
 */
export function calendarDateLines(
  occurredAt: string | null | undefined,
  tags?: string | null,
  now: Date = new Date(),
  item?: MemoryItem,
): { primary: string; secondary?: string } {
  if (!occurredAt) return { primary: "?" };
  const p = utcParts(occurredAt);
  if (!p) return { primary: "?" };
  if (
    isCalendarYearOnly(tags) ||
    (p.m === 1 && p.d === 1 && !tags?.includes("lich-precision:day"))
  ) {
    return { primary: String(p.y) };
  }

  const kind = parseCalendarKind(tags);
  const rite = parseRiteId(tags);
  const isDeath =
    kind === "mat" || Boolean(item && isDeathMilestone(item));

  // Cưới / sinh — chỉ dương, không năm (lặp hằng năm).
  if (kind === "cuoi" || kind === "sinh") {
    return { primary: `${p.d}/${p.m}` };
  }

  const needYear =
    isDeath ||
    kind === "gio" ||
    rite === "gio_dau" ||
    rite === "49" ||
    rite === "100";
  const primary = needYear
    ? `${p.d}/${p.m}/${p.y}`
    : `${p.d}/${p.m}`;

  const lunar = solarToLunar(p.d, p.m, p.y);
  const secondary = `${lunar.d}/${lunar.m} âm`;

  // Mất / giỗ / nghi lễ — luôn có dòng âm bên dưới.
  if (
    isDeath ||
    kind === "gio" ||
    Boolean(rite) ||
    isLunarMemorialKind(tags)
  ) {
    return { primary, secondary };
  }

  return { primary };
}

/**
 * Calendar / mốc title with «Giỗ đầu» / «Giỗ năm thứ N» when death year is known.
 */
export function displayCalendarMilestoneTitle(
  item: MemoryItem,
  opts?: { milestones?: MemoryItem[]; now?: Date },
): string {
  const base = displayMemoryTitle(item.kind, item.title ?? "");
  const gio = calendarGioOrdinalLabel(
    item,
    opts?.milestones,
    opts?.now ?? new Date(),
  );
  if (!gio) return base;
  if (titleAlreadyHasGioOrdinal(base)) return base;
  const genericDeath =
    /^(tạ thế|ngày mất|giỗ|mốc đời|ngày gia đình)$/i.test(base.trim());
  if (genericDeath) return gio;
  return `${base} · ${gio}`;
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
