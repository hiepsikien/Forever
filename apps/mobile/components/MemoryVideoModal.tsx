import { useVideoPlayer, VideoView } from "expo-video";
import { useEffect } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors, fonts } from "@/lib/theme";

type Props = {
  visible: boolean;
  uri: string | null;
  title?: string;
  loading?: boolean;
  error?: string | null;
  onClose: () => void;
};

function VideoPlayerBody({ uri, title, onClose }: { uri: string; title?: string; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const player = useVideoPlayer(uri, (p) => {
    p.loop = false;
    p.play();
  });

  useEffect(() => {
    return () => {
      try {
        player.pause();
      } catch {
        // ignore
      }
    };
  }, [player]);

  return (
    <View style={[styles.playerRoot, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 12 }]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle} numberOfLines={2}>
          {title || "Video ký ức"}
        </Text>
        <Pressable onPress={onClose} hitSlop={12}>
          <Text style={styles.closeText}>Đóng</Text>
        </Pressable>
      </View>
      <VideoView
        player={player}
        style={styles.video}
        contentFit="contain"
        nativeControls
        allowsFullscreen
        allowsPictureInPicture
      />
    </View>
  );
}

export function MemoryVideoModal({
  visible,
  uri,
  title,
  loading = false,
  error = null,
  onClose,
}: Props) {
  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.brand} size="large" />
            <Text style={styles.loadingText}>Đang tải video…</Text>
          </View>
        ) : error ? (
          <View style={styles.center}>
            <Text style={styles.errorText}>{error}</Text>
            <Pressable style={styles.retryClose} onPress={onClose}>
              <Text style={styles.retryCloseText}>Đóng</Text>
            </Pressable>
          </View>
        ) : uri ? (
          <VideoPlayerBody uri={uri} title={title} onClose={onClose} />
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "#0f0f0f",
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    gap: 16,
  },
  loadingText: { color: "#e8e0d4", fontSize: 16 },
  errorText: {
    color: colors.danger,
    fontSize: 16,
    textAlign: "center",
    lineHeight: 24,
  },
  retryClose: {
    marginTop: 8,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: colors.brand,
  },
  retryCloseText: { color: "#f4efe6", fontWeight: "600" },
  playerRoot: { flex: 1, gap: 12, paddingHorizontal: 12 },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  headerTitle: {
    flex: 1,
    fontFamily: fonts.display,
    fontSize: 20,
    color: "#f4efe6",
  },
  closeText: { color: colors.brandSoft, fontSize: 16, fontWeight: "600" },
  video: {
    flex: 1,
    width: "100%",
    borderRadius: 12,
    backgroundColor: "#000",
  },
});
