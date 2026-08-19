import { useEffect, useRef } from "react";
import { Modal, Platform, Pressable, Text, View } from "react-native";

import { colors, fonts, createThemedStyles } from "@/lib/theme";

export type AddMemoryAction =
  | "note"
  | "photo"
  | "video"
  | "milestone"
  | "poem";

type Props = {
  visible: boolean;
  onClose: () => void;
  onSelect: (action: AddMemoryAction) => void;
  /** Steward/owner only — opens document ingest. */
  onIngest?: () => void;
};

const OPTIONS: { id: AddMemoryAction; label: string; hint: string }[] = [
  { id: "note", label: "Ghi chú", hint: "Một dòng nhớ ngắn" },
  { id: "photo", label: "Ảnh", hint: "Từ thư viện ảnh" },
  { id: "video", label: "Video", hint: "Từ thư viện ảnh" },
  { id: "milestone", label: "Ngày gia đình", hint: "Giỗ, cưới, sinh, mất…" },
  { id: "poem", label: "Thơ", hint: "Dán tiêu đề và thân bài" },
];

export function AddMemorySheet({ visible, onClose, onSelect, onIngest }: Props) {
  /**
   * iOS drops a picker presented while this Modal is still dismissing, so the
   * choice waits for onDismiss. Android has no onDismiss — one frame is enough.
   */
  const pending = useRef<(() => void) | null>(null);
  const fallback = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (visible) pending.current = null;
  }, [visible]);

  useEffect(() => {
    return () => {
      if (fallback.current) clearTimeout(fallback.current);
    };
  }, []);

  const runPending = () => {
    if (fallback.current) clearTimeout(fallback.current);
    fallback.current = null;
    const action = pending.current;
    pending.current = null;
    action?.();
  };

  const choose = (action: () => void) => {
    if (pending.current) return;
    pending.current = action;
    onClose();
    if (Platform.OS !== "ios") {
      requestAnimationFrame(runPending);
      return;
    }
    // onDismiss is the reliable signal, but never leave the choice unrun.
    fallback.current = setTimeout(runPending, 700);
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
      onDismiss={runPending}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.title}>Thêm vào ký ức</Text>
          <Text style={styles.sub}>Chọn loại — rồi gắn người nếu biết.</Text>
          {OPTIONS.map((opt) => (
            <Pressable
              key={opt.id}
              style={styles.option}
              onPress={() => choose(() => onSelect(opt.id))}
            >
              <Text style={styles.optionLabel}>{opt.label}</Text>
              <Text style={styles.optionHint}>{opt.hint}</Text>
            </Pressable>
          ))}
          {onIngest ? (
            <Pressable
              style={styles.option}
              onPress={() => choose(() => onIngest())}
            >
              <Text style={styles.optionLabel}>Nhập tài liệu</Text>
              <Text style={styles.optionHint}>Thơ, ảnh, ngày gia đình từ file</Text>
            </Pressable>
          ) : null}
          <Pressable style={styles.cancel} onPress={onClose}>
            <Text style={styles.cancelText}>Huỷ</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = createThemedStyles((colors) => ({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 28,
    gap: 8,
  },
  title: {
    fontFamily: fonts.display,
    fontSize: 24,
    color: colors.ink,
  },
  sub: {
    color: colors.inkSoft,
    marginBottom: 8,
    lineHeight: 20,
  },
  option: {
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 2,
  },
  optionLabel: {
    fontSize: 17,
    fontWeight: "700",
    color: colors.ink,
  },
  optionHint: {
    fontSize: 13,
    color: colors.inkSoft,
  },
  cancel: {
    alignItems: "center",
    paddingVertical: 14,
    marginTop: 4,
  },
  cancelText: {
    color: colors.inkSoft,
    fontSize: 16,
    fontWeight: "600",
  },
}));
