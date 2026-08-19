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

function isFatherFamilyRoom(item: ThreadSummary): boolean {
  return isHeritageFamilyRoom(item) && threadRelationFold(item) === "bo";
}

function isPaternalGrandmotherFamilyRoom(item: ThreadSummary): boolean {
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

/**
 * Hero «Phòng khách» is Cả nhà with Bố. Do not promote another remembered
 * person into that slot just because they spoke more recently.
 */
export function pickLivingRoomThread(
  threads: ThreadSummary[],
): ThreadSummary | null {
  const fatherReady = threads.find(
    (item) => isFatherFamilyRoom(item) && Boolean(item.heritage?.chat_ready),
  );
  if (fatherReady) return fatherReady;
  if (threads.some(isFatherFamilyRoom)) return null;
  return mostRecentReadyFamilyHeritage(threads);
}

function listRank(item: HomeThreadRow): number {
  if (isPaternalGrandmotherFamilyRoom(item)) return 0;
  if (isHeritageFamilyRoom(item) && !item.pendingDirectFor) return 1;
  return 2;
}

/** List under the hero: Bà Nội Cả nhà first; hide Người giữ nhà. */
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

  // Pending directs must consider the hero too — otherwise «Riêng với Bố»
  // disappears when Cả nhà is elevated to Phòng khách.
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

  rows.sort((a, b) => listRank(a) - listRank(b));
  return rows;
}
