import { Pressable, Text, TextInput, View } from "react-native";

import { colors, createThemedStyles } from "@/lib/theme";

type Props = {
  value: string;
  onChange: (text: string) => void;
  placeholder?: string;
  /** Sit beside a toolbar button — no outer horizontal padding. */
  embedded?: boolean;
};

export function LibrarySearchBar({
  value,
  onChange,
  placeholder = "Tìm trong ký ức…",
  embedded,
}: Props) {
  return (
    <View style={[styles.wrap, embedded && styles.embedded]}>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.inkSoft}
        style={styles.input}
        autoCorrect={false}
        autoCapitalize="none"
        clearButtonMode="while-editing"
      />
      {value ? (
        <Pressable onPress={() => onChange("")} hitSlop={8}>
          <Text style={styles.clear}>Xóa</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = createThemedStyles((colors) => ({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  embedded: {
    flex: 1,
    paddingHorizontal: 0,
    paddingBottom: 0,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: "#fff",
    color: colors.ink,
    fontSize: 16,
  },
  clear: { color: colors.brand, fontWeight: "600", fontSize: 14 },
}));
