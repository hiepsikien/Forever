import { IdentityProfile } from "@forever/api-client";

export function identityChipLabel(
  ident: IdentityProfile,
  userId?: string | null,
): string {
  if (ident.linked_user_id && ident.linked_user_id === userId) return "Tôi";
  if (ident.relation_label) {
    return `${ident.display_name} · ${ident.relation_label}`;
  }
  return ident.display_name;
}
