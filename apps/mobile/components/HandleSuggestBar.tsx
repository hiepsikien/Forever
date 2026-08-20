import { IdentityProfile } from "@forever/api-client";
import { Pressable, ScrollView, Text, View } from "react-native";

import { chipLabelWithHandle, identityHandle } from "@/lib/handles";
import { createThemedStyles } from "@/lib/theme";

type Props = {
  suggestions: IdentityProfile[];
  userId?: string | null;
  onPick: (identity: IdentityProfile) => void;
};

/** Compact strip above the composer when the user is typing @… */
export function HandleSuggestBar({ suggestions, userId, onPick }: Props) {
  if (suggestions.length === 0) return null;
  return (
    <View style={styles.wrap}>
      <ScrollView
        horizontal
        keyboardShouldPersistTaps="handled"
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        {suggestions.map((ident) => {
          const handle = identityHandle(ident);
          return (
            <Pressable
              key={ident.id}
              style={styles.chip}
              onPress={() => onPick(ident)}
            >
              <Text style={styles.chipText} numberOfLines={1}>
                {handle
                  ? `@${handle}`
                  : chipLabelWithHandle(ident, userId)}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = createThemedStyles((colors) => ({
  wrap: {
    borderTopWidth: 1,
    borderTopColor: colors.line,
    backgroundColor: colors.bg,
    paddingVertical: 6,
  },
  row: {
    paddingHorizontal: 12,
    gap: 8,
    alignItems: "center",
  },
  chip: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: colors.bgDeep,
    borderWidth: 1,
    borderColor: colors.line,
  },
  chipText: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.brand,
  },
}));
