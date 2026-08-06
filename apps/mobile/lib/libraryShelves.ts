/** Client-side grouping, filtering, and sort for the redesigned library. */

import { IdentityProfile, MemoryCandidate, MemoryItem } from "@forever/api-client";

import { identityChipLabel } from "@/lib/identityDisplay";
import { parseHeritageIdentityIds, tagTokens } from "@/lib/memoryTags";

export const UNTAGGED_PERSON_ID = "_none";

export type ShelfId = "life" | "poems" | "artifacts" | "heard";

export type ShelfFilter = "all" | ShelfId;

export type ShelfCounts = Record<ShelfId, number>;

export type PersonHubRow = {
  identityId: string;
  label: string;
  counts: ShelfCounts;
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
    const total =
      counts.life + counts.poems + counts.artifacts + counts.heard;
    // Linked living profiles (including your own "Tôi") are Voice DNA mirrors,
    // not memorial pages. The app creates one per member on first touch, so an
    // empty row would just read «Tôi · Chưa có ký ức». Once the family keeps
    // something about them, they earn the shelf. Add still tags people via form.
    if (total === 0 && identity.linked_user_id) continue;
    rows.push({
      identityId: identity.id,
      label: identityChipLabel(identity, userId),
      counts,
      total,
    });
  }

  rows.sort((a, b) => {
    if (b.total !== a.total) return b.total - a.total;
    return a.label.localeCompare(b.label, "vi");
  });

  const untaggedCounts = countShelves(untagged);
  rows.push({
    identityId: UNTAGGED_PERSON_ID,
    label: "Chưa neo ai",
    counts: untaggedCounts,
    total:
      untaggedCounts.life +
      untaggedCounts.poems +
      untaggedCounts.artifacts +
      untaggedCounts.heard,
  });

  return rows;
}

export function formatShelfSummary(counts: ShelfCounts): string {
  const parts: string[] = [];
  if (counts.life) parts.push(`${counts.life} mốc đời`);
  if (counts.poems) parts.push(`${counts.poems} bài thơ`);
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

/** Dòng đời: oldest first; undated last. */
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

/** Thơ / hiện vật / knowledge: newest saved first. */
export function sortByCreatedDesc(items: MemoryItem[]): MemoryItem[] {
  return [...items].sort((a, b) => createdMs(b) - createdMs(a));
}

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

export const THEME_LABELS: Record<string, string> = {
  vo_chong: "Vợ chồng",
  con_cai: "Con cái",
  gia_dinh: "Gia đình",
  nghe_giao: "Nghề giáo",
  tho: "Thơ",
  biet_on: "Biết ơn",
  truyen_thong: "Truyền thống",
};

export const SHELF_LABELS: Record<ShelfFilter, string> = {
  all: "Tất cả",
  life: "Dòng đời",
  poems: "Thơ",
  artifacts: "Hiện vật",
  heard: "Điều nghe được",
};
