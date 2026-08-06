import { IdentityProfile } from "@forever/api-client";

/**
 * The relation the app writes on the mirror profile it creates for each member
 * (`_ensure_self_identity`). It is first person, so it only ever reads correctly
 * for the one account it belongs to.
 */
const SELF_RELATION = "tôi";

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
