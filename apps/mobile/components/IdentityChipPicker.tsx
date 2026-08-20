import { IdentityProfile } from "@forever/api-client";
import { Pressable, Text, View } from "react-native";

import { chipLabelWithHandle } from "@/lib/handles";
import { createThemedStyles } from "@/lib/theme";

type Props = {
  identities: IdentityProfile[];
  selectedIds: string[];
  onToggle: (identityId: string) => void;
  userId?: string | null;
};

export function IdentityChipPicker({
  identities,
  selectedIds,
  onToggle,
  userId,
}: Props) {
  if (identities.length === 0) return null;

  return (
    <View style={styles.chips}>
      {identities.map((ident) => {
        const active = selectedIds.includes(ident.id);
        return (
          <Pressable
            key={ident.id}
            style={[styles.chip, active && styles.chipActive]}
            onPress={() => onToggle(ident.id)}
          >
            <Text style={[styles.chipText, active && styles.chipTextActive]}>
              {chipLabelWithHandle(ident, userId)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = createThemedStyles((colors) => ({
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 4,
  },
  chip: {
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  chipActive: {
    backgroundColor: colors.brand,
    borderColor: colors.brand,
  },
  chipText: { fontWeight: "600", color: colors.ink, fontSize: 14 },
  chipTextActive: { color: "#fff" },
}));
