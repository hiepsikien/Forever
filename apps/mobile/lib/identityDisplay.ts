import { IdentityProfile } from "@forever/api-client";

/**
 * The relation the app writes on the mirror profile it creates for each member
 * (`_ensure_self_identity`). It is first person, so it only ever reads correctly
 * for the one account it belongs to.
 */
const SELF_RELATION = "tôi";

/** Quick-pick labels — always relative to the remembered anchor, never the viewer. */
export const LIVING_RELATION_GROUPS = [
  {
    title: "Bạn đời",
    options: ["Vợ", "Chồng"],
  },
  {
    title: "Con cháu",
    options: ["Con", "Con gái", "Con trai", "Cháu", "Cháu gái", "Cháu trai", "Chắt"],
  },
  {
    title: "Anh em",
    options: ["Em gái", "Em trai", "Anh", "Chị"],
  },
  {
    title: "Họ hàng",
    options: ["Cô", "Chú", "Dì", "Cậu", "Bác"],
  },
] as const;

export const LIVING_RELATION_PRESETS = LIVING_RELATION_GROUPS.flatMap(
  (group) => group.options,
);

/** @deprecated Use LIVING_RELATION_PRESETS — kept for older imports. */
export const LIVING_RELATIONS_TO_REMEMBERED = LIVING_RELATION_PRESETS;

export const DEFAULT_LIVING_RELATION = "Con";

function foldVi(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .trim();
}

export function isLivingRelationPreset(relation: string): boolean {
  const folded = foldVi(relation);
  return LIVING_RELATION_PRESETS.some((preset) => foldVi(preset) === folded);
}

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

export function livingRelationHelp(
  remembered?: Pick<IdentityProfile, "display_name" | "relation_label"> | null,
): string {
  return (
    `${relationToRememberedPrompt(remembered)}. Không phải với tài khoản quản trị — ` +
    "ghi quan hệ so với người được nhớ (vd. Em gái, Cháu), không phải Anh/Chị/Mẹ theo góc nhìn của bạn."
  );
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
