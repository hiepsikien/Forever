import { IdentityProfile } from "@forever/api-client";
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { IdentityChipPicker } from "@/components/IdentityChipPicker";
import { colors, fonts } from "@/lib/theme";

export type TextMemoryKind = "note" | "milestone" | "poem";

type Props = {
  visible: boolean;
  kind: TextMemoryKind;
  title: string;
  body: string;
  occurredAt: string;
  identities: IdentityProfile[];
  selectedIdentityIds: string[];
  userId?: string | null;
  busy?: boolean;
  onChangeTitle: (v: string) => void;
  onChangeBody: (v: string) => void;
  onChangeOccurredAt: (v: string) => void;
  onToggleIdentity: (id: string) => void;
  onCancel: () => void;
  onSave: () => void;
};

const TITLES: Record<TextMemoryKind, string> = {
  note: "Ghi chú mới",
  milestone: "Mốc đời mới",
  poem: "Thơ mới",
};

export function TextMemoryFormModal({
  visible,
  kind,
  title,
  body,
  occurredAt,
  identities,
  selectedIdentityIds,
  userId,
  busy,
  onChangeTitle,
  onChangeBody,
  onChangeOccurredAt,
  onToggleIdentity,
  onCancel,
  onSave,
}: Props) {
  const canSave = body.trim().length > 0 && !busy;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.modalTitle}>{TITLES[kind]}</Text>
          <TextInput
            value={title}
            onChangeText={onChangeTitle}
            placeholder={kind === "poem" ? "Tiêu đề bài thơ" : "Tiêu đề (tuỳ chọn)"}
            placeholderTextColor={colors.inkSoft}
            style={styles.input}
          />
          {kind === "milestone" ? (
            <TextInput
              value={occurredAt}
              onChangeText={onChangeOccurredAt}
              placeholder="Năm hoặc ngày (vd. 1966 hoặc 1966-05-01)"
              placeholderTextColor={colors.inkSoft}
              style={styles.input}
              autoCapitalize="none"
            />
          ) : null}
          <TextInput
            value={body}
            onChangeText={onChangeBody}
            placeholder={
              kind === "poem"
                ? "Thân bài — mỗi câu một dòng…"
                : kind === "milestone"
                  ? "Chuyện đã xảy ra…"
                  : "Nội dung ký ức…"
            }
            placeholderTextColor={colors.inkSoft}
            style={[styles.input, styles.inputTall]}
            multiline
          />
          {identities.length > 0 ? (
            <>
              <Text style={styles.label}>Ai trong ký ức này?</Text>
              <IdentityChipPicker
                identities={identities}
                selectedIds={selectedIdentityIds}
                onToggle={onToggleIdentity}
                userId={userId}
              />
            </>
          ) : null}
          <View style={styles.actions}>
            <Pressable onPress={onCancel}>
              <Text style={styles.cancel}>Huỷ</Text>
            </Pressable>
            <Pressable
              style={[styles.saveBtn, !canSave && { opacity: 0.5 }]}
              onPress={onSave}
              disabled={!canSave}
            >
              <Text style={styles.saveText}>Lưu</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    justifyContent: "flex-end",
  },
  card: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    gap: 10,
    maxHeight: "92%",
  },
  modalTitle: {
    fontFamily: fonts.display,
    fontSize: 22,
    color: colors.ink,
    marginBottom: 4,
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
  inputTall: { minHeight: 120, textAlignVertical: "top" },
  label: {
    marginTop: 4,
    fontSize: 13,
    fontWeight: "700",
    color: colors.inkSoft,
  },
  actions: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 8,
  },
  cancel: { color: colors.inkSoft, fontSize: 16 },
  saveBtn: {
    backgroundColor: colors.brand,
    borderRadius: 14,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  saveText: { color: "#f4efe6", fontWeight: "600" },
});
