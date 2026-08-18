import { IdentityProfile } from "@forever/api-client";

import { identityChipLabel } from "@/lib/identityDisplay";

export const HERITAGE_TAG_PREFIX = "heritage:";

/** Same separators the API splits on — a tag itself never contains one. */
const TAG_SPLIT = /[,;\s]+/;

export function heritageTag(identityId: string): string {
  return `${HERITAGE_TAG_PREFIX}${identityId}`;
}

export function tagTokens(tags: string | null | undefined): string[] {
  if (!tags?.trim()) return [];
  return tags.trim().split(TAG_SPLIT).filter(Boolean);
}

export function parseHeritageIdentityIds(tags: string): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const token of tagTokens(tags)) {
    if (!token.startsWith(HERITAGE_TAG_PREFIX)) continue;
    const id = token.slice(HERITAGE_TAG_PREFIX.length);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

/** Keep non-heritage tags; replace heritage tags with the selected identity ids. */
export function mergeMemoryTags(existingTags: string, identityIds: string[]): string {
  const parts = tagTokens(existingTags).filter(
    (p) => !p.startsWith(HERITAGE_TAG_PREFIX),
  );
  for (const id of identityIds) {
    if (!parts.includes(heritageTag(id))) parts.push(heritageTag(id));
  }
  return parts.join(" ").slice(0, 500);
}

export const CALENDAR_KIND_PREFIX = "lich:";
export const CALENDAR_YEAR_ONLY = "lich-precision:year";

export type CalendarKind = "gio" | "mat" | "cuoi" | "sinh" | "khac";

export const CALENDAR_KIND_LABELS: Record<CalendarKind, string> = {
  gio: "Giỗ",
  mat: "Ngày mất",
  cuoi: "Cưới",
  sinh: "Sinh",
  khac: "Khác",
};

export function parseCalendarKind(tags: string | null | undefined): CalendarKind {
  for (const token of tagTokens(tags ?? "")) {
    if (!token.startsWith(CALENDAR_KIND_PREFIX)) continue;
    const kind = token.slice(CALENDAR_KIND_PREFIX.length);
    if (
      kind === "gio" ||
      kind === "mat" ||
      kind === "cuoi" ||
      kind === "sinh" ||
      kind === "khac"
    ) {
      return kind;
    }
  }
  return "khac";
}

export function isCalendarYearOnly(tags: string | null | undefined): boolean {
  return tagTokens(tags ?? "").includes(CALENDAR_YEAR_ONLY);
}

export function mergeCalendarTags(
  existingTags: string,
  kind: CalendarKind,
  yearOnly: boolean,
): string {
  const parts = tagTokens(existingTags).filter(
    (p) => !p.startsWith(CALENDAR_KIND_PREFIX) && p !== CALENDAR_YEAR_ONLY,
  );
  parts.push(`${CALENDAR_KIND_PREFIX}${kind}`);
  if (yearOnly) parts.push(CALENDAR_YEAR_ONLY);
  return parts.join(" ").slice(0, 500);
}

export function heritageLabelsForMemory(
  tags: string,
  identities: IdentityProfile[],
  userId?: string | null,
): string[] {
  return parseHeritageIdentityIds(tags)
    .map((id) => identities.find((i) => i.id === id))
    .filter((i): i is IdentityProfile => Boolean(i))
    .map((i) => identityChipLabel(i, userId));
}
