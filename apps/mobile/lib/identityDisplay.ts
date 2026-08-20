import { IdentityProfile } from "@forever/api-client";

/**
 * The relation the app writes on the mirror profile it creates for each member
 * (`_ensure_self_identity`). It is first person, so it only ever reads correctly
 * for the one account it belongs to.
 */
const SELF_RELATION = "tôi";

/**
 * How this living person stands to the remembered one — never to the owner
 * account. «Anh/Chị/Mẹ» flip depending on who is looking; these do not.
 */
export const LIVING_RELATIONS_TO_REMEMBERED = ["Vợ", "Con", "Cháu"] as const;

export function relationToRememberedPrompt(
  remembered?: Pick<IdentityProfile, "display_name" | "relation_label"> | null,
): string {
  const name = (remembered?.display_name ?? "").trim();
  const called = (remembered?.relation_label ?? "").trim();
  if (name && called && called.toLowerCase() !== name.toLowerCase()) {
    return `Với ${name} (${called}), người này là`;
  }
  if (name) return `Với ${name}, người này là`;
  return "Với người đã mất trong nhà, người này là";
}

export function relationRelativeLine(
  ident: IdentityProfile,
  remembered?: Pick<IdentityProfile, "display_name" | "relation_label"> | null,
): string | null {
  const rel = (ident.relation_label ?? "").trim();
  if (!rel || ident.relation_label?.trim().toLowerCase() === SELF_RELATION) {
    return null;
  }
  if (ident.status === "remembered") {
    return `Cả nhà gọi là ${rel}`;
  }
  const anchor =
    (remembered?.relation_label ?? "").trim() ||
    (remembered?.display_name ?? "").trim() ||
    "người đã mất";
  return `${rel} của ${anchor}`;
}

/** Auto-created when someone joins — not a family-tree person. */
export function isLoginMirror(ident: IdentityProfile): boolean {
  return (ident.relation_label ?? "").trim().toLowerCase() === SELF_RELATION;
}

export function identityChipLabel(
  ident: IdentityProfile,
  userId?: string | null,
): string {
  if (ident.linked_user_id && ident.linked_user_id === userId) return "Tôi";
  const name = ident.display_name;
  const relation = (ident.relation_label ?? "").trim();
  // Someone else's "Tôi" is not a relation to you — showing it produced rows
  // like «anh.nguyendinh.cs · Tôi» on your mother's phone. Let the name stand.
  // A relation identical to the name would only repeat it («Mẹ · Mẹ»).
  if (!relation || relation.toLowerCase() === SELF_RELATION || relation === name) {
    return name;
  }
  return `${name} · ${relation}`;
}

/**
 * Compact who-label for calendar rows — prefer «Bố» / «Bà Nội» over full legal name.
 */
export function shortPersonLabel(
  ident: IdentityProfile,
  userId?: string | null,
): string {
  if (ident.linked_user_id && ident.linked_user_id === userId) return "Tôi";
  const relation = (ident.relation_label ?? "").trim();
  if (relation && relation.toLowerCase() !== SELF_RELATION) {
    return relation;
  }
  const name = (ident.display_name ?? "").trim();
  if (!name) return "Ai đó";
  // First significant word if the legal name is long.
  const parts = name.split(/\s+/).filter(Boolean);
  return parts.length <= 2 ? name : parts[parts.length - 1]!;
}
