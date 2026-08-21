import { Pressable, Text, TextInput, View } from "react-native";

import {
  DEFAULT_LIVING_RELATION,
  LIVING_RELATION_GROUPS,
  livingRelationHelp,
  relationToRememberedPrompt,
} from "@/lib/identityDisplay";
import { createThemedStyles, useTheme } from "@/lib/theme";

type RememberedAnchor = {
  display_name?: string | null;
  relation_label?: string | null;
} | null;

type Props = {
  value: string;
  onChange: (value: string) => void;
  remembered?: RememberedAnchor;
  help?: string;
};

function isActiveChip(value: string, preset: string): boolean {
  return value.trim().toLowerCase() === preset.trim().toLowerCase();
}

export function LivingRelationField({
  value,
  onChange,
  remembered,
  help,
}: Props) {
  const { colors } = useTheme();
  const hint = help ?? livingRelationHelp(remembered);
  const relationValue = value.trim() ? value : DEFAULT_LIVING_RELATION;

  return (
    <View style={styles.wrap}>
      <Text style={styles.help}>{hint}</Text>
      {LIVING_RELATION_GROUPS.map((group) => (
        <View key={group.title} style={styles.group}>
          <Text style={styles.groupTitle}>{group.title}</Text>
          <View style={styles.chipRow}>
            {group.options.map((preset) => {
              const active = isActiveChip(relationValue, preset);
              return (
                <Pressable
                  key={preset}
                  style={[styles.chip, active && styles.chipActive]}
                  onPress={() => onChange(preset)}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>
                    {preset}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ))}
      <Text style={styles.inputLabel}>Quan hệ</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChange}
        placeholder={`${relationToRememberedPrompt(remembered)} — vd. Em gái`}
        placeholderTextColor={colors.inkSoft}
        autoCapitalize="sentences"
      />
    </View>
  );
}

const styles = createThemedStyles((colors, fonts) => ({
  wrap: { gap: 8, width: "100%" },
  help: { fontSize: 13, color: colors.inkSoft, lineHeight: 18 },
  group: { gap: 4 },
  groupTitle: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.inkSoft,
    textTransform: "uppercase",
    letterSpacing: 0.35,
    marginTop: 2,
  },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.inputBg,
  },
  chipActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipText: { fontSize: 13, fontWeight: "600", color: colors.inkSoft },
  chipTextActive: { color: colors.onBrand },
  inputLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.inkSoft,
    marginTop: 4,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.inputBg,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.ink,
    fontFamily: fonts.body,
  },
}));
