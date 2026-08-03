import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors, fonts } from "@/lib/theme";

type Props = {
  visible: boolean;
  mode: "upload" | "edit";
  mediaKind?: "video" | "photo" | "voice";
  title: string;
  body: string;
  busy?: boolean;
  onChangeTitle: (v: string) => void;
  onChangeBody: (v: string) => void;
  onCancel: () => void;
  onSave: () => void;
};

function headline(mode: Props["mode"], mediaKind?: Props["mediaKind"]): string {
  if (mode === "edit") return "Sửa ghi chú ký ức";
  if (mediaKind === "video") return "Lưu video ký ức";
  if (mediaKind === "photo") return "Lưu ảnh ký ức";
  if (mediaKind === "voice") return "Lưu giọng ký ức";
  return "Ghi chú mới";
}

export function MemoryCaptionModal({
  visible,
  mode,
  mediaKind,
  title,
  body,
  busy = false,
  onChangeTitle,
  onChangeBody,
  onCancel,
  onSave,
}: Props) {
  const insets = useSafeAreaInsets();
  const canSave = title.trim().length > 0;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onCancel}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 8 : 0}
      >
        <Pressable style={styles.backdrop} onPress={onCancel}>
          <Pressable style={styles.sheetHit} onPress={(e) => e.stopPropagation()}>
            <View style={[styles.card, { paddingBottom: Math.max(insets.bottom, 16) }]}>
              <ScrollView
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="interactive"
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.scrollContent}
              >
                <Text style={styles.title}>{headline(mode, mediaKind)}</Text>
                <Text style={styles.hint}>
                  Đặt tên và vài dòng ghi chú để sau này cả nhà nhận ra — vd.
                  &quot;Bố quay Tết 2015, cả nhà ăn cơm&quot;.
                </Text>
                <Text style={styles.label}>Tên ký ức</Text>
                <TextInput
                  value={title}
                  onChangeText={onChangeTitle}
                  placeholder="vd. Tết 2015 · Bố quay"
                  placeholderTextColor={colors.inkSoft}
                  style={styles.input}
                  returnKeyType="next"
                />
                <Text style={styles.label}>Ghi chú (tuỳ chọn)</Text>
                <TextInput
                  value={body}
                  onChangeText={onChangeBody}
                  placeholder="Ai, ở đâu, khoảnh khắc gì…"
                  placeholderTextColor={colors.inkSoft}
                  style={[styles.input, styles.inputTall]}
                  multiline
                />
                <View style={styles.actions}>
                  <Pressable onPress={onCancel} disabled={busy}>
                    <Text style={styles.cancel}>Huỷ</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.saveBtn, (!canSave || busy) && styles.disabled]}
                    onPress={onSave}
                    disabled={!canSave || busy}
                  >
                    {busy ? (
                      <ActivityIndicator color="#f4efe6" />
                    ) : (
                      <Text style={styles.saveText}>
                        {mode === "upload" ? "Lưu" : "Cập nhật"}
                      </Text>
                    )}
                  </Pressable>
                </View>
              </ScrollView>
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    justifyContent: "flex-end",
  },
  sheetHit: { maxHeight: "92%" },
  card: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 20,
    paddingHorizontal: 20,
    maxHeight: "100%",
  },
  scrollContent: { gap: 8, paddingBottom: 8 },
  title: {
    fontFamily: fonts.display,
    fontSize: 22,
    color: colors.ink,
  },
  hint: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.inkSoft,
    marginBottom: 4,
  },
  label: {
    marginTop: 4,
    fontSize: 13,
    fontWeight: "700",
    color: colors.inkSoft,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: "#fff",
    color: colors.ink,
    fontSize: 16,
  },
  inputTall: { minHeight: 96, textAlignVertical: "top" },
  actions: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 10,
  },
  cancel: { color: colors.inkSoft, fontSize: 16 },
  saveBtn: {
    backgroundColor: colors.brand,
    borderRadius: 14,
    paddingHorizontal: 18,
    paddingVertical: 12,
    minWidth: 110,
    alignItems: "center",
  },
  saveText: { color: "#f4efe6", fontWeight: "600" },
  disabled: { opacity: 0.45 },
});
