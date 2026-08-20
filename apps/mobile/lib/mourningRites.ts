/**
 * Mourning rites after a death date: 49 ngày → 100 ngày → giỗ đầu.
 * Derived from ngày mất (solar stored); giỗ đầu follows âm lịch like other giỗ.
 */

import { MemoryItem } from "@forever/api-client";

import {
  isCalendarYearOnly,
  mergeCalendarTags,
  mergeMemoryTags,
  parseCalendarKind,
  parseHeritageIdentityIds,
  tagTokens,
} from "@/lib/memoryTags";
import { lunarToSolar, solarToLunar, type Ymd } from "@/lib/vnLunar";

export const RITE_TAG_PREFIX = "lich-rite:";
export const RITE_FROM_PREFIX = "lich-from:";

export type MourningRiteId = "49" | "100" | "gio_dau";

export const MOURNING_RITES: {
  id: MourningRiteId;
  title: string;
  body: string;
  /** Calendar chip: giỗ đầu uses lunar giỗ; 49/100 stay civil days. */
  calendarKind: "gio" | "khac";
}[] = [
  {
    id: "49",
    title: "49 ngày",
    body: "Bốn mươi chín ngày sau ngày mất.",
    calendarKind: "khac",
  },
  {
    id: "100",
    title: "100 ngày",
    body: "Một trăm ngày sau ngày mất.",
    calendarKind: "khac",
  },
  {
    id: "gio_dau",
    title: "Giỗ đầu",
    body: "Giỗ đầu — một năm âm sau ngày mất.",
    calendarKind: "gio",
  },
];

export function riteTag(id: MourningRiteId): string {
  return `${RITE_TAG_PREFIX}${id}`;
}

export function parseRiteId(tags: string | null | undefined): MourningRiteId | null {
  for (const token of tagTokens(tags)) {
    if (!token.startsWith(RITE_TAG_PREFIX)) continue;
    const id = token.slice(RITE_TAG_PREFIX.length);
    if (id === "49" || id === "100" || id === "gio_dau") return id;
  }
  return null;
}

function utcParts(occurredAt: string): Ymd | null {
  const t = Date.parse(occurredAt);
  if (!Number.isFinite(t)) return null;
  const dt = new Date(t);
  return {
    y: dt.getUTCFullYear(),
    m: dt.getUTCMonth() + 1,
    d: dt.getUTCDate(),
  };
}

function addUtcDays(day: Ymd, days: number): Ymd {
  const dt = new Date(Date.UTC(day.y, day.m - 1, day.d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return {
    y: dt.getUTCFullYear(),
    m: dt.getUTCMonth() + 1,
    d: dt.getUTCDate(),
  };
}

function formatIsoDate(day: Ymd): string {
  const mm = String(day.m).padStart(2, "0");
  const dd = String(day.d).padStart(2, "0");
  return `${day.y}-${mm}-${dd}`;
}

/** Full-day death milestone (not year-only). */
export function isDeathMilestone(item: MemoryItem): boolean {
  if (item.kind !== "milestone" || !item.occurred_at) return false;
  if (parseRiteId(item.tags)) return false;
  if (isCalendarYearOnly(item.tags)) return false;
  const p = utcParts(item.occurred_at);
  if (!p) return false;
  if (p.m === 1 && p.d === 1 && !item.tags?.includes("lich-precision:day")) {
    return false;
  }
  if (parseCalendarKind(item.tags) === "mat") return true;
  const blob = `${item.title ?? ""} ${item.body ?? ""}`.toLowerCase();
  return /tạ thế|qua đời|từ trần|mất ngày|ngày mất/.test(blob);
}

export function deathDay(item: MemoryItem): Ymd | null {
  if (!isDeathMilestone(item) || !item.occurred_at) return null;
  return utcParts(item.occurred_at);
}

/** Giỗ đầu = same âm day/month, next lunar year. */
export function gioDauSolar(death: Ymd): Ymd | null {
  const lunar = solarToLunar(death.d, death.m, death.y);
  let solar = lunarToSolar(lunar.d, lunar.m, lunar.y + 1, lunar.leap);
  if (!solar && lunar.leap) {
    solar = lunarToSolar(lunar.d, lunar.m, lunar.y + 1, false);
  }
  return solar;
}

export function riteOccurredAt(death: Ymd, rite: MourningRiteId): string | null {
  if (rite === "49") return formatIsoDate(addUtcDays(death, 49));
  if (rite === "100") return formatIsoDate(addUtcDays(death, 100));
  const gio = gioDauSolar(death);
  return gio ? formatIsoDate(gio) : null;
}

function titleLooksLikeRite(title: string, rite: MourningRiteId): boolean {
  const t = title.toLowerCase().normalize("NFC");
  if (rite === "49") return /49\s*ngày|bốn mươi chín/.test(t);
  if (rite === "100") return /100\s*ngày|một trăm ngày|tram ngay/.test(t);
  return /giỗ đầu|gio dau|giỗ hết năm|giỗ năm đầu/.test(t);
}

function samePeople(a: string, b: string): boolean {
  const aa = new Set(parseHeritageIdentityIds(a));
  const bb = parseHeritageIdentityIds(b);
  if (aa.size === 0 || bb.length === 0) return false;
  return bb.every((id) => aa.has(id)) || bb.some((id) => aa.has(id));
}

/** True if this milestone already covers the rite for the same person(s). */
export function hasMourningRite(
  milestones: MemoryItem[],
  death: MemoryItem,
  rite: MourningRiteId,
): boolean {
  const needle = riteTag(rite);
  const from = `${RITE_FROM_PREFIX}${death.id}`;
  for (const item of milestones) {
    if (item.id === death.id || item.kind !== "milestone") continue;
    const tags = item.tags || "";
    if (tags.includes(from) && tags.includes(needle)) return true;
    if (parseRiteId(tags) === rite && samePeople(death.tags || "", tags)) {
      return true;
    }
    if (
      titleLooksLikeRite(item.title || "", rite) &&
      samePeople(death.tags || "", tags)
    ) {
      return true;
    }
  }
  return false;
}

export function missingMourningRites(
  death: MemoryItem,
  milestones: MemoryItem[],
): MourningRiteId[] {
  if (!isDeathMilestone(death) || !deathDay(death)) return [];
  return MOURNING_RITES.map((r) => r.id).filter(
    (id) => !hasMourningRite(milestones, death, id),
  );
}

export type MourningRiteDraft = {
  rite: MourningRiteId;
  title: string;
  body: string;
  tags: string;
  occurred_at: string;
};

export function buildMourningRiteDraft(
  death: MemoryItem,
  rite: MourningRiteId,
): MourningRiteDraft | null {
  const day = deathDay(death);
  if (!day) return null;
  const def = MOURNING_RITES.find((r) => r.id === rite);
  if (!def) return null;
  const occurred_at = riteOccurredAt(day, rite);
  if (!occurred_at) return null;
  const identityIds = parseHeritageIdentityIds(death.tags || "");
  let tags = mergeMemoryTags("", identityIds);
  tags = mergeCalendarTags(tags, def.calendarKind, false);
  const parts = tagTokens(tags);
  parts.push(riteTag(rite));
  parts.push(`${RITE_FROM_PREFIX}${death.id}`);
  tags = parts.join(" ").slice(0, 500);
  return {
    rite,
    title: def.title,
    body: def.body,
    tags,
    occurred_at,
  };
}

export type CreateMilestoneFn = (payload: {
  kind: "milestone";
  title: string;
  body: string;
  tags: string;
  occurred_at: string;
}) => Promise<MemoryItem>;

export type EnsureMourningDeps = {
  create: CreateMilestoneFn;
  update?: (
    id: string,
    payload: { occurred_at?: string; tags?: string; title?: string; body?: string },
  ) => Promise<MemoryItem>;
  remove?: (id: string) => Promise<void>;
};

function ritePeopleKey(item: MemoryItem): string {
  const ids = parseHeritageIdentityIds(item.tags || "").slice().sort();
  return ids.join(",") || item.id;
}

function collectRiteCopies(
  pool: MemoryItem[],
  death: MemoryItem,
  rite: MourningRiteId,
): MemoryItem[] {
  const needle = riteTag(rite);
  const from = `${RITE_FROM_PREFIX}${death.id}`;
  const out: MemoryItem[] = [];
  for (const item of pool) {
    if (item.id === death.id || item.kind !== "milestone") continue;
    const tags = item.tags || "";
    if (tags.includes(from) && (tags.includes(needle) || titleLooksLikeRite(item.title || "", rite))) {
      out.push(item);
      continue;
    }
    if (parseRiteId(tags) === rite && samePeople(death.tags || "", tags)) {
      out.push(item);
      continue;
    }
    if (
      titleLooksLikeRite(item.title || "", rite) &&
      samePeople(death.tags || "", tags)
    ) {
      out.push(item);
    }
  }
  return out;
}

function preferRiteCopy(copies: MemoryItem[], expectedIso: string): MemoryItem {
  const tagged = copies.filter((c) => parseRiteId(c.tags) != null);
  const pool = tagged.length ? tagged : copies;
  const exact = pool.find((c) => (c.occurred_at || "").startsWith(expectedIso));
  if (exact) return exact;
  return pool[0]!;
}

/**
 * Create missing 49 / 100 / giỗ đầu, drop duplicates, repair giỗ đầu date
 * (= đúng một năm âm sau ngày mất).
 */
export async function ensureMourningRites(
  milestones: MemoryItem[],
  deps: EnsureMourningDeps | CreateMilestoneFn,
): Promise<number> {
  const api: EnsureMourningDeps =
    typeof deps === "function" ? { create: deps } : deps;
  const deaths = milestones.filter(isDeathMilestone);
  let changed = 0;
  const pool = [...milestones];

  for (const death of deaths) {
    const day = deathDay(death);
    if (!day) continue;

    // Normalize «Tạ thế» → lich:mat so âm/dương display stays consistent.
    if (
      api.update &&
      parseCalendarKind(death.tags) !== "mat" &&
      !parseRiteId(death.tags)
    ) {
      const identityIds = parseHeritageIdentityIds(death.tags || "");
      let tags = mergeMemoryTags(death.tags || "", identityIds);
      tags = mergeCalendarTags(tags, "mat", false);
      try {
        const updated = await api.update(death.id, { tags });
        const idx = pool.findIndex((m) => m.id === death.id);
        if (idx >= 0) pool[idx] = updated;
        changed += 1;
      } catch {
        /* best-effort */
      }
    }

    for (const rite of MOURNING_RITES.map((r) => r.id)) {
      const expected = riteOccurredAt(day, rite);
      if (!expected) continue;
      const copies = collectRiteCopies(pool, death, rite);
      if (copies.length === 0) {
        const draft = buildMourningRiteDraft(
          pool.find((m) => m.id === death.id) ?? death,
          rite,
        );
        if (!draft) continue;
        const row = await api.create({
          kind: "milestone",
          title: draft.title,
          body: draft.body,
          tags: draft.tags,
          occurred_at: draft.occurred_at,
        });
        pool.push(row);
        changed += 1;
        continue;
      }

      const keep = preferRiteCopy(copies, expected);
      for (const extra of copies) {
        if (extra.id === keep.id) continue;
        if (api.remove) {
          try {
            await api.remove(extra.id);
            const idx = pool.findIndex((m) => m.id === extra.id);
            if (idx >= 0) pool.splice(idx, 1);
            changed += 1;
          } catch {
            /* keep showing until next pass */
          }
        }
      }

      // Repair date / tags on the keeper (especially giỗ đầu âm +1 năm).
      if (api.update) {
        const dateWrong = !(keep.occurred_at || "").startsWith(expected);
        const tagsNeed =
          parseRiteId(keep.tags) !== rite ||
          !(keep.tags || "").includes(riteTag(rite));
        if (dateWrong || tagsNeed) {
          try {
            const draft = buildMourningRiteDraft(
              pool.find((m) => m.id === death.id) ?? death,
              rite,
            );
            const updated = await api.update(keep.id, {
              occurred_at: expected,
              ...(draft?.tags ? { tags: draft.tags } : {}),
              title: MOURNING_RITES.find((r) => r.id === rite)?.title,
            });
            const idx = pool.findIndex((m) => m.id === keep.id);
            if (idx >= 0) pool[idx] = updated;
            changed += 1;
          } catch {
            /* ignore */
          }
        }
      }
    }
  }
  return changed;
}

/** Drop duplicate mourning rites in a list (UI safety net). */
export function dedupeMourningMilestones(items: MemoryItem[]): MemoryItem[] {
  const seen = new Set<string>();
  const out: MemoryItem[] = [];
  for (const item of items) {
    const rite = parseRiteId(item.tags);
    const fuzzy =
      rite ??
      (titleLooksLikeRite(item.title || "", "49")
        ? "49"
        : titleLooksLikeRite(item.title || "", "100")
          ? "100"
          : titleLooksLikeRite(item.title || "", "gio_dau")
            ? "gio_dau"
            : null);
    if (!fuzzy) {
      out.push(item);
      continue;
    }
    const key = `${fuzzy}:${ritePeopleKey(item)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

/** For chips / labels when lich-rite is set. */
export function mourningRiteLabel(tags: string | null | undefined): string | null {
  const id = parseRiteId(tags);
  if (!id) return null;
  return MOURNING_RITES.find((r) => r.id === id)?.title ?? null;
}

/** Giỗ đầu / Giỗ năm thứ N — only when death year is known. */
export function formatGioOrdinalLabel(n: number): string {
  if (n <= 1) return "Giỗ đầu";
  return `Giỗ năm thứ ${n}`;
}

export function gioOrdinalNumber(death: Ymd, observance: Ymd): number | null {
  const deathL = solarToLunar(death.d, death.m, death.y);
  const obsL = solarToLunar(observance.d, observance.m, observance.y);
  const n = obsL.y - deathL.y;
  if (n < 1) return null;
  return n;
}

function parseFromDeathId(tags: string | null | undefined): string | null {
  for (const token of tagTokens(tags)) {
    if (token.startsWith(RITE_FROM_PREFIX)) {
      const id = token.slice(RITE_FROM_PREFIX.length);
      return id || null;
    }
  }
  return null;
}

/** Death day for a giỗ / mất row — itself, or linked / sibling ngày mất. */
export function resolveDeathDay(
  item: MemoryItem,
  milestones?: MemoryItem[],
): Ymd | null {
  if (isDeathMilestone(item)) return deathDay(item);
  const fromId = parseFromDeathId(item.tags);
  if (fromId && milestones) {
    const src = milestones.find((m) => m.id === fromId);
    if (src) return deathDay(src);
  }
  if (milestones) {
    for (const m of milestones) {
      if (!isDeathMilestone(m)) continue;
      if (samePeople(item.tags || "", m.tags || "")) {
        return deathDay(m);
      }
    }
  }
  return null;
}

export function titleAlreadyHasGioOrdinal(title: string): boolean {
  const t = title.toLowerCase();
  return /giỗ đầu|giỗ năm thứ|gio dau|gio nam thu/.test(t);
}

/**
 * Label for giỗ rows when the death year is known.
 * Ngày mất keeps its own title («Tạ thế») — ordinal only on giỗ / giỗ đầu.
 */
export function calendarGioOrdinalLabel(
  item: MemoryItem,
  milestones?: MemoryItem[],
  now: Date = new Date(),
): string | null {
  if (item.kind !== "milestone" || !item.occurred_at) return null;
  if (isCalendarYearOnly(item.tags)) return null;

  const rite = parseRiteId(item.tags);
  if (rite === "49" || rite === "100") return null;
  if (rite === "gio_dau") return formatGioOrdinalLabel(1);

  const kind = parseCalendarKind(item.tags);
  if (kind === "mat" || isDeathMilestone(item)) return null;
  if (kind !== "gio") return null;

  const death = resolveDeathDay(item, milestones);
  if (!death) return null;

  const p = utcParts(item.occurred_at);
  if (!p) return null;

  const n = gioOrdinalNumber(death, p);
  if (n == null) return null;
  return formatGioOrdinalLabel(n);
}
