import { IdentityProfile } from "@forever/api-client";

import { identityChipLabel } from "@/lib/identityDisplay";

export const HERITAGE_TAG_PREFIX = "heritage:";

export function heritageTag(identityId: string): string {
  return `${HERITAGE_TAG_PREFIX}${identityId}`;
}

export function parseHeritageIdentityIds(tags: string): string[] {
  if (!tags?.trim()) return [];
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const part of tags.split(",")) {
    const token = part.trim();
    if (!token.startsWith(HERITAGE_TAG_PREFIX)) continue;
    const id = token.slice(HERITAGE_TAG_PREFIX.length).trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

/** Keep non-heritage tags; replace heritage tags with the selected identity ids. */
export function mergeMemoryTags(existingTags: string, identityIds: string[]): string {
  const parts = (existingTags ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((p) => !p.startsWith(HERITAGE_TAG_PREFIX));
  for (const id of identityIds) {
    parts.push(heritageTag(id));
  }
  return parts.join(",").slice(0, 500);
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
