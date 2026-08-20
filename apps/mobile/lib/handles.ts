/** Helpers for @handle tagging across living + remembered people. */

import { IdentityProfile } from "@forever/api-client";

import { identityChipLabel } from "@/lib/identityDisplay";

const HANDLE_TOKEN = /(?:^|[\s([{«"'])@([a-z0-9_]{2,32})\b/gi;

export function identityHandle(ident: IdentityProfile): string | null {
  const h = (ident.handle || "").trim().replace(/^@/, "");
  return h || null;
}

/** Truncate long @handles for hub rows / chips — full value still used for tagging. */
export function formatHandleDisplay(handle: string, max = 14): string {
  const h = handle.trim().replace(/^@/, "");
  if (!h) return "";
  if (h.length <= max) return `@${h}`;
  return `@${h.slice(0, Math.max(1, max - 1))}…`;
}

export function chipLabelWithHandle(
  ident: IdentityProfile,
  userId?: string | null,
): string {
  const base = identityChipLabel(ident, userId);
  const handle = identityHandle(ident);
  return handle ? `${base} · ${formatHandleDisplay(handle)}` : base;
}

/** Active @query at the end of text (for composer autocomplete). */
export function activeHandleQuery(text: string): string | null {
  const m = text.match(/(?:^|[\s([{«"'])@([a-z0-9_]*)$/i);
  if (!m) return null;
  return m[1].toLowerCase();
}

export function suggestHandles(
  identities: IdentityProfile[],
  query: string,
  userId?: string | null,
  limit = 6,
): IdentityProfile[] {
  const q = query.toLowerCase();
  const scored = identities
    .filter((i) => !i.archived_at)
    .map((i) => {
      const handle = identityHandle(i) || "";
      const label = identityChipLabel(i, userId).toLowerCase();
      let score = 0;
      if (!q) score = 1;
      else if (handle.startsWith(q)) score = 3;
      else if (handle.includes(q)) score = 2;
      else if (label.includes(q)) score = 1;
      return { i, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.i.display_name.localeCompare(b.i.display_name, "vi"));
  return scored.slice(0, limit).map((x) => x.i);
}

/** Handles mentioned in free text (without the @). */
export function parseMentionedHandles(text: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  HANDLE_TOKEN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = HANDLE_TOKEN.exec(text))) {
    const h = m[1].toLowerCase();
    if (!seen.has(h)) {
      seen.add(h);
      found.push(h);
    }
  }
  return found;
}

export function identityIdsForHandles(
  identities: IdentityProfile[],
  handles: string[],
): string[] {
  const byHandle = new Map<string, string>();
  for (const i of identities) {
    const h = identityHandle(i);
    if (h) byHandle.set(h.toLowerCase(), i.id);
  }
  const ids: string[] = [];
  for (const h of handles) {
    const id = byHandle.get(h.toLowerCase());
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}
