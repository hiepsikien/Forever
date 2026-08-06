import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { colors } from "@/lib/theme";

type Props = {
  value: string;
  onChange: (text: string) => void;
  placeholder?: string;
};

export function LibrarySearchBar({
  value,
  onChange,
  placeholder = "Tìm trong ký ức…",
}: Props) {
  return (
    <View style={styles.wrap}>
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

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingBottom: 8,
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
});
