import { IdentityProfile } from "@forever/api-client";
import {
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { IdentityChipPicker } from "@/components/IdentityChipPicker";
import {
  CALENDAR_KIND_LABELS,
  CalendarKind,
} from "@/lib/memoryTags";
import { colors, fonts, createThemedStyles } from "@/lib/theme";
import {
  formatLunarShort,
  formatSolarShort,
  nextLunarAnniversarySolar,
  solarToLunar,
} from "@/lib/vnLunar";

export type TextMemoryKind = "note" | "milestone" | "poem";

function LunarPreview({ occurredAt }: { occurredAt: string }) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(occurredAt);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const lunar = solarToLunar(d, mo, y);
  const next = nextLunarAnniversarySolar({ y, m: mo, d });
  const solarObs = next ? formatSolarShort(next) : null;
  return (
    <Text style={styles.help}>
      → {formatLunarShort(lunar)}
      {solarObs ? ` · năm nay ${solarObs} dương` : ""}
    </Text>
  );
}

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
  editing?: boolean;
  calendarKind?: CalendarKind;
  onChangeCalendarKind?: (kind: CalendarKind) => void;
  /** Local preview URI when creating/editing a milestone photo. */
  photoUri?: string | null;
  onChangeTitle: (v: string) => void;
  onChangeBody: (v: string) => void;
  onChangeOccurredAt: (v: string) => void;
  onToggleIdentity: (id: string) => void;
  onPickPhoto?: () => void;
  onClearPhoto?: () => void;
  onCancel: () => void;
  onSave: () => void;
};

const TITLES: Record<TextMemoryKind, string> = {
  note: "Ghi chú mới",
  milestone: "Ngày gia đình",
  poem: "Thơ mới",
};

const EDIT_TITLES: Record<TextMemoryKind, string> = {
  note: "Sửa ghi chú",
  milestone: "Sửa ngày gia đình",
  poem: "Sửa thơ",
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
  editing,
  calendarKind,
  onChangeCalendarKind,
  photoUri,
  onChangeTitle,
  onChangeBody,
  onChangeOccurredAt,
  onToggleIdentity,
  onPickPhoto,
  onClearPhoto,
  onCancel,
  onSave,
}: Props) {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const canSave = body.trim().length > 0 && !busy;
  const sheetMaxHeight = Math.round(windowHeight * 0.92);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onCancel}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 8 : 0}
      >
        <View style={styles.backdrop}>
          <View style={[styles.sheet, { maxHeight: sheetMaxHeight }]}>
            <View
              style={[
                styles.card,
                {
                  paddingBottom: Math.max(insets.bottom, 12),
                  maxHeight: sheetMaxHeight,
                },
              ]}
            >
              <ScrollView
                style={styles.scroll}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="interactive"
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.scrollContent}
              >
                <Text style={styles.modalTitle}>
                  {editing ? EDIT_TITLES[kind] : TITLES[kind]}
                </Text>
                <TextInput
                  value={title}
                  onChangeText={onChangeTitle}
                  placeholder={kind === "poem" ? "Tiêu đề bài thơ" : "Tiêu đề (tuỳ chọn)"}
                  placeholderTextColor={colors.inkSoft}
                  style={styles.input}
                />
                {kind === "milestone" ? (
                  <>
                    <Text style={styles.label}>Loại ngày</Text>
                    <View style={styles.kindRow}>
                      {(
                        ["gio", "mat", "cuoi", "sinh", "khac"] as CalendarKind[]
                      ).map((id) => {
                        const on = (calendarKind || "khac") === id;
                        return (
                          <Pressable
                            key={id}
                            style={[styles.kindChip, on && styles.kindChipOn]}
                            onPress={() => onChangeCalendarKind?.(id)}
                          >
                            <Text
                              style={[
                                styles.kindChipText,
                                on && styles.kindChipTextOn,
                              ]}
                            >
                              {CALENDAR_KIND_LABELS[id]}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                    <TextInput
                      value={occurredAt}
                      onChangeText={onChangeOccurredAt}
                      placeholder={
                        calendarKind === "mat" || calendarKind === "gio"
                          ? "Ngày mất dương lịch (vd. 1966-07-18)"
                          : "Ngày (vd. 1966-06-01) hoặc chỉ năm (1966)"
                      }
                      placeholderTextColor={colors.inkSoft}
                      style={styles.input}
                      autoCapitalize="none"
                    />
                    {kind === "milestone" &&
                    (calendarKind === "mat" || calendarKind === "gio") &&
                    /^\d{4}-\d{2}-\d{2}$/.test(occurredAt.trim()) ? (
                      <LunarPreview occurredAt={occurredAt.trim()} />
                    ) : calendarKind === "mat" || calendarKind === "gio" ? (
                      <Text style={styles.help}>
                        Nhập ngày dương trên giấy tờ — Forever đổi sang âm để giỗ
                        và hiện cả hai.
                      </Text>
                    ) : null}
                  </>
                ) : null}
                <TextInput
                  value={body}
                  onChangeText={onChangeBody}
                  placeholder={
                    kind === "poem"
                      ? "Thân bài — mỗi câu một dòng…"
                      : kind === "milestone"
                        ? "Giỗ ai, cưới năm nào, con sinh khi nào…"
                        : "Nội dung ký ức…"
                  }
                  placeholderTextColor={colors.inkSoft}
                  style={[styles.input, styles.inputTall]}
                  multiline
                />
                {kind === "milestone" && onPickPhoto ? (
                  <View style={styles.photoBlock}>
                    {photoUri ? (
                      <Image source={{ uri: photoUri }} style={styles.photoPreview} />
                    ) : null}
                    <View style={styles.photoActions}>
                      <Pressable onPress={onPickPhoto} hitSlop={8}>
                        <Text style={styles.photoLink}>
                          {photoUri ? "Đổi ảnh" : "Thêm ảnh (tuỳ chọn)"}
                        </Text>
                      </Pressable>
                      {photoUri && onClearPhoto ? (
                        <Pressable onPress={onClearPhoto} hitSlop={8}>
                          <Text style={styles.clearPhoto}>Bỏ ảnh</Text>
                        </Pressable>
                      ) : null}
                    </View>
                  </View>
                ) : null}
                {identities.length > 0 ? (
                  <>
                    <Text style={styles.label}>
                      {kind === "milestone" ? "Ai trong ngày này?" : "Ai trong ký ức này?"}
                    </Text>
                    <IdentityChipPicker
                      identities={identities}
                      selectedIds={selectedIdentityIds}
                      onToggle={onToggleIdentity}
                      userId={userId}
                    />
                  </>
                ) : null}
              </ScrollView>
              <View style={styles.actions}>
                <Pressable onPress={onCancel}>
                  <Text style={styles.cancel}>Huỷ</Text>
                </Pressable>
                <Pressable
                  style={[styles.saveBtn, !canSave && { opacity: 0.5 }]}
                  onPress={onSave}
                  disabled={!canSave}
                >
                  <Text style={styles.saveText}>{editing ? "Cập nhật" : "Lưu"}</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = createThemedStyles((colors) => ({
  flex: { flex: 1 },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    justifyContent: "flex-end",
  },
  sheet: { width: "100%" },
  card: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingTop: 20,
    paddingHorizontal: 20,
    gap: 10,
  },
  scroll: { flexGrow: 0, flexShrink: 1 },
  scrollContent: { gap: 10, paddingBottom: 8 },
  modalTitle: {
    fontFamily: fonts.display,
    fontSize: 22,
    color: colors.ink,
    marginBottom: 4,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: colors.ink,
    backgroundColor: colors.card,
  },
  inputTall: { minHeight: 120, textAlignVertical: "top" },
  photoBlock: { gap: 8 },
  photoPreview: {
    width: "100%",
    height: 160,
    borderRadius: 12,
    backgroundColor: colors.bgDeep,
  },
  photoActions: { flexDirection: "row", gap: 16, alignItems: "center" },
  photoLink: { fontSize: 14, fontWeight: "600", color: colors.brand },
  clearPhoto: { fontSize: 14, fontWeight: "600", color: colors.inkSoft },
  label: { fontSize: 13, fontWeight: "600", color: colors.inkSoft, marginTop: 4 },
  help: { fontSize: 13, lineHeight: 18, color: colors.inkSoft },
  kindRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  kindChip: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: colors.card,
  },
  kindChipOn: { borderColor: colors.brand, backgroundColor: colors.brand },
  kindChipText: { fontSize: 13, fontWeight: "600", color: colors.inkSoft },
  kindChipTextOn: { color: "#fff" },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: 16,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
  },
  cancel: { fontSize: 16, color: colors.inkSoft },
  saveBtn: {
    backgroundColor: colors.brand,
    borderRadius: 10,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  saveText: { color: "#fff", fontWeight: "700", fontSize: 15 },
}));
