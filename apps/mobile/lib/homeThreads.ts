import { ThreadSummary } from "@forever/api-client";

/** A row the family has not created yet — tapping it opens the private thread. */
export type HomeThreadRow = ThreadSummary & { pendingDirectFor?: string };

export function isDirectThread(item: ThreadSummary): boolean {
  return (item.audience_scope ?? "family") === "direct";
}

/** Onboard room with Người giữ nhà — not the family's living room. */
export function isKeeperFamilyThread(item: ThreadSummary): boolean {
  return item.kind === "family";
}

export function isHeritageFamilyRoom(item: ThreadSummary): boolean {
  return item.kind === "heritage" && !isDirectThread(item);
}

function foldVi(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function threadRelationFold(item: ThreadSummary): string {
  const labeled = foldVi(item.heritage?.relation_label ?? "");
  if (labeled) return labeled;
  const title = item.title ?? "";
  const sep = title.lastIndexOf("·");
  if (sep >= 0) return foldVi(title.slice(sep + 1));
  return "";
}

export function isFatherFamilyRoom(item: ThreadSummary): boolean {
  return isHeritageFamilyRoom(item) && threadRelationFold(item) === "bo";
}

export function isPaternalGrandmotherFamilyRoom(item: ThreadSummary): boolean {
  return isHeritageFamilyRoom(item) && threadRelationFold(item) === "ba noi";
}

function isReadyFamilyHeritage(item: ThreadSummary): boolean {
  return isHeritageFamilyRoom(item) && Boolean(item.heritage?.chat_ready);
}

function mostRecentReadyFamilyHeritage(
  threads: ThreadSummary[],
): ThreadSummary | null {
  const ready = threads.filter(isReadyFamilyHeritage);
  if (!ready.length) return null;
  return ready.reduce((best, item) => {
    const bestAt = best.last_message?.created_at ?? best.created_at;
    const itemAt = item.last_message?.created_at ?? item.created_at;
    return itemAt > bestAt ? item : best;
  });
}

/** Cả nhà with Bố — show even before chat_ready (awakening CTA). */
export function pickFatherFamilyRoom(
  threads: ThreadSummary[],
): ThreadSummary | null {
  return threads.find(isFatherFamilyRoom) ?? null;
}

/** Cả nhà with Bà Nội — show even before chat_ready. */
export function pickBaNoiFamilyRoom(
  threads: ThreadSummary[],
): ThreadSummary | null {
  return threads.find(isPaternalGrandmotherFamilyRoom) ?? null;
}

/**
 * Hero «Bố (Cả nhà)» prefers the father family room. Fallback only when this
 * house has no Bố profile at all.
 */
export function pickLivingRoomThread(
  threads: ThreadSummary[],
): ThreadSummary | null {
  const father = pickFatherFamilyRoom(threads);
  if (father) {
    return father.heritage?.chat_ready ? father : null;
  }
  return mostRecentReadyFamilyHeritage(threads);
}

function ensurePendingDirect(
  rows: HomeThreadRow[],
  threads: ThreadSummary[],
  familyRoom: ThreadSummary | null,
): void {
  const identityId = familyRoom?.heritage?.identity_id;
  if (
    !familyRoom ||
    !identityId ||
    !familyRoom.heritage?.chat_ready
  ) {
    return;
  }
  const hasDirect = threads.some(
    (other) =>
      isDirectThread(other) && other.heritage?.identity_id === identityId,
  );
  if (hasDirect) return;
  if (rows.some((row) => row.pendingDirectFor === identityId)) return;
  rows.push({
    ...familyRoom,
    id: `direct:${identityId}`,
    audience_scope: "direct",
    last_message: null,
    pendingDirectFor: identityId,
  });
}

function directRank(item: HomeThreadRow): number {
  if (threadRelationFold(item) === "bo") return 0;
  if (threadRelationFold(item) === "ba noi") return 1;
  return 2;
}

/**
 * SECTION 5 — private rooms with Bố and Bà Nội only when that person is
 * chat_ready (existing direct or a pending open-direct row).
 */
export function homePrivateRows(threads: ThreadSummary[]): HomeThreadRow[] {
  const father = pickFatherFamilyRoom(threads);
  const baNoi = pickBaNoiFamilyRoom(threads);
  const readyFocusIds = new Set(
    [father, baNoi]
      .filter((t) => t?.heritage?.chat_ready && t.heritage.identity_id)
      .map((t) => t!.heritage!.identity_id),
  );

  const rows: HomeThreadRow[] = threads
    .filter((item) => {
      if (!isDirectThread(item) || item.kind !== "heritage") return false;
      const id = item.heritage?.identity_id;
      if (!id || !readyFocusIds.has(id)) return false;
      return Boolean(item.heritage?.chat_ready);
    })
    .map((thread) => ({ ...thread }));

  if (father?.heritage?.chat_ready) {
    ensurePendingDirect(rows, threads, father);
  }
  if (baNoi?.heritage?.chat_ready) {
    ensurePendingDirect(rows, threads, baNoi);
  }

  rows.sort((a, b) => directRank(a) - directRank(b));
  return rows;
}

/**
 * @deprecated Prefer homePrivateRows — kept for any leftover call sites.
 * List under the hero: Bà Nội Cả nhà first; hide Người giữ nhà.
 */
export function homeConversationRows(
  threads: ThreadSummary[],
  livingRoom: ThreadSummary | null,
): HomeThreadRow[] {
  const rows: HomeThreadRow[] = threads
    .filter((item) => {
      if (isKeeperFamilyThread(item)) return false;
      if (livingRoom && item.id === livingRoom.id) return false;
      return true;
    })
    .map((thread) => ({ ...thread }));

  for (const thread of threads) {
    const identityId = thread.heritage?.identity_id;
    if (
      thread.kind !== "heritage" ||
      isDirectThread(thread) ||
      !identityId ||
      !thread.heritage?.chat_ready
    ) {
      continue;
    }
    const hasDirect = threads.some(
      (other) =>
        isDirectThread(other) && other.heritage?.identity_id === identityId,
    );
    if (hasDirect) continue;
    if (rows.some((row) => row.pendingDirectFor === identityId)) continue;
    rows.push({
      ...thread,
      id: `direct:${identityId}`,
      audience_scope: "direct",
      last_message: null,
      pendingDirectFor: identityId,
    });
  }

  rows.sort((a, b) => {
    if (isPaternalGrandmotherFamilyRoom(a)) return -1;
    if (isPaternalGrandmotherFamilyRoom(b)) return 1;
    if (isHeritageFamilyRoom(a) && !a.pendingDirectFor) return -1;
    if (isHeritageFamilyRoom(b) && !b.pendingDirectFor) return 1;
    return 0;
  });
  return rows;
}
