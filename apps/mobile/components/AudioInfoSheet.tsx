import { AudioFileInfo } from "@forever/api-client";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { colors, fonts } from "@/lib/theme";

export type AudioInfoTarget = {
  /** Shown as the sheet subtitle so the user knows which file they opened. */
  label: string;
  load: () => Promise<AudioFileInfo>;
};

type Props = {
  target: AudioInfoTarget | null;
  onClose: () => void;
};

function formatBytes(bytes?: number | null): string {
  if (!bytes || bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(0)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

function formatDuration(ms?: number | null): string {
  if (!ms || ms <= 0) return "—";
  const total = Math.round(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatRate(hz?: number | null): string {
  if (!hz || hz <= 0) return "—";
  return `${(hz / 1000).toFixed(hz % 1000 === 0 ? 0 : 1)} kHz`;
}

function formatBitrate(bps?: number | null): string {
  if (!bps || bps <= 0) return "—";
  return `${Math.round(bps / 1000)} kbps`;
}

function formatChannels(info: AudioFileInfo): string {
  if (!info.channels) return "—";
  const name =
    info.channels === 1
      ? "Mono"
      : info.channels === 2
        ? "Stereo"
        : `${info.channels} kênh`;
  return info.channel_layout && info.channel_layout !== "mono"
    ? `${name} (${info.channel_layout})`
    : name;
}

const SOURCE_LABELS: Record<string, string> = {
  record: "Ghi trong app",
  upload: "Upload file",
  memory: "Từ ký ức",
  extract: "Tách từ băng",
  combine: "Ghép nhiều mẫu",
  process: "Đã cân bằng âm lượng",
  split: "Chia từ mẫu dài",
};

const STAGE_LABELS: Record<string, string> = {
  unprocessed: "Chưa xử lý",
  processed: "Sẵn sàng clone",
  archived: "Đã loại",
};

export function AudioInfoSheet({ target, onClose }: Props) {
  const [info, setInfo] = useState<AudioFileInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!target) {
      setInfo(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setInfo(null);
    // load() can throw synchronously (a stale bundle missing the method, say),
    // so it must run inside the chain — otherwise nothing catches it and the
    // spinner never clears.
    Promise.resolve()
      .then(() => target.load())
      .then((res) => {
        if (!cancelled) setInfo(res);
      })
      .catch((e) => {
        console.warn("[AudioInfoSheet] load failed", e);
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Không đọc được thông số.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [target]);

  const rows: { label: string; value: string }[] = info
    ? [
        { label: "Thời lượng", value: formatDuration(info.duration_ms) },
        { label: "Sample rate", value: formatRate(info.sample_rate) },
        { label: "Kênh", value: formatChannels(info) },
        { label: "Codec", value: info.codec ? info.codec.toUpperCase() : "—" },
        {
          label: "Độ sâu bit",
          value: info.bit_depth ? `${info.bit_depth}-bit` : "—",
        },
        { label: "Bitrate", value: formatBitrate(info.bitrate_bps) },
        { label: "Dung lượng", value: formatBytes(info.size_bytes) },
        { label: "Định dạng", value: info.container || info.media_mime || "—" },
      ]
    : [];

  if (info?.source && SOURCE_LABELS[info.source]) {
    rows.push({ label: "Nguồn", value: SOURCE_LABELS[info.source] });
  }
  if (info?.pipeline_stage && STAGE_LABELS[info.pipeline_stage]) {
    rows.push({
      label: "Trạng thái",
      value: STAGE_LABELS[info.pipeline_stage],
    });
  }

  return (
    <Modal
      visible={target != null}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => undefined}>
          <Text style={styles.title}>Thông số audio</Text>
          {target ? (
            <Text style={styles.subtitle} numberOfLines={2}>
              {target.label}
            </Text>
          ) : null}

          {loading ? (
            <View style={styles.center}>
              <ActivityIndicator color={colors.brand} />
            </View>
          ) : error ? (
            <Text style={styles.error}>{error}</Text>
          ) : (
            <ScrollView style={styles.list}>
              {info?.narrow_band ? (
                <View style={styles.warn}>
                  <Text style={styles.warnText}>
                    Băng thông hẹp ({formatRate(info.sample_rate)}). Clone từ
                    mẫu này dễ nghe trẻ và khác người gốc — lấy lại từ file gốc
                    nếu còn.
                  </Text>
                </View>
              ) : null}
              {rows.map((row) => (
                <View key={row.label} style={styles.row}>
                  <Text style={styles.rowLabel}>{row.label}</Text>
                  <Text style={styles.rowValue}>{row.value}</Text>
                </View>
              ))}
              {info?.file_name ? (
                <Text style={styles.fileName}>{info.file_name}</Text>
              ) : null}
            </ScrollView>
          )}

          <Pressable style={styles.close} onPress={onClose}>
            <Text style={styles.closeText}>Đóng</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    padding: 16,
    paddingBottom: 28,
    maxHeight: "75%",
    gap: 8,
  },
  title: { fontFamily: fonts.display, fontSize: 20, color: colors.ink },
  subtitle: { fontSize: 13, color: colors.inkSoft },
  center: { paddingVertical: 28, alignItems: "center" },
  error: { fontSize: 13, color: colors.danger, paddingVertical: 12 },
  list: { flexGrow: 0, marginTop: 4 },
  warn: {
    backgroundColor: colors.bgDeep,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.danger,
    padding: 10,
    marginBottom: 10,
  },
  warnText: { fontSize: 12, lineHeight: 18, color: colors.danger },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  rowLabel: { fontSize: 13, color: colors.inkSoft },
  rowValue: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.ink,
    flexShrink: 1,
    textAlign: "right",
  },
  fileName: {
    fontSize: 11,
    color: colors.inkSoft,
    marginTop: 10,
  },
  close: {
    marginTop: 6,
    borderWidth: 1,
    borderColor: colors.brand,
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: "center",
  },
  closeText: { color: colors.brand, fontWeight: "700", fontSize: 14 },
});
