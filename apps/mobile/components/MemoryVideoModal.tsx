import { useVideoPlayer, VideoView } from "expo-video";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors, fonts, createThemedStyles } from "@/lib/theme";

type Props = {
  visible: boolean;
  uri: string | null;
  title?: string;
  loading?: boolean;
  loadingHint?: string;
  error?: string | null;
  onClose: () => void;
};

function VideoPlayerBody({
  uri,
  title,
  onClose,
  onPlaybackError,
}: {
  uri: string;
  title?: string;
  onClose: () => void;
  onPlaybackError: (message: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const [buffering, setBuffering] = useState(true);
  const translateY = useRef(new Animated.Value(0)).current;
  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) =>
          g.dy > 8 && Math.abs(g.dy) > Math.abs(g.dx),
        onPanResponderMove: (_, g) => {
          if (g.dy > 0) translateY.setValue(g.dy);
        },
        onPanResponderRelease: (_, g) => {
          if (g.dy > 80 || g.vy > 0.9) onClose();
          else {
            Animated.spring(translateY, {
              toValue: 0,
              useNativeDriver: true,
              bounciness: 0,
            }).start();
          }
        },
      }),
    [onClose, translateY],
  );
  const player = useVideoPlayer(uri, (p) => {
    p.loop = false;
  });

  useEffect(() => {
    const subStatus = player.addListener("statusChange", ({ status, error }) => {
      if (status === "readyToPlay") {
        setBuffering(false);
        player.play();
      }
      if (status === "error") {
        setBuffering(false);
        onPlaybackError(
          error?.message ||
            "Không phát được video. Thử mở bằng ứng dụng Files/VLC.",
        );
      }
    });
    return () => {
      subStatus.remove();
      try {
        player.pause();
      } catch {
        // ignore
      }
    };
  }, [player, onPlaybackError]);

  return (
    <Animated.View
      style={[
        styles.playerRoot,
        {
          paddingTop: insets.top + 8,
          paddingBottom: insets.bottom + 12,
          transform: [{ translateY }],
        },
      ]}
    >
      <View style={styles.header} {...pan.panHandlers}>
        <View style={styles.handle} />
        <Text style={styles.headerTitle} numberOfLines={2}>
          {title || "Video ký ức"}
        </Text>
      </View>
      <View style={styles.videoWrap}>
        <VideoView
          player={player}
          style={styles.video}
          contentFit="contain"
          nativeControls
          allowsFullscreen
          allowsPictureInPicture
        />
        {buffering ? (
          <View style={styles.bufferOverlay}>
            <ActivityIndicator color="#fff" size="large" />
            <Text style={styles.bufferText}>Đang mở video…</Text>
          </View>
        ) : null}
      </View>
    </Animated.View>
  );
}

export function MemoryVideoModal({
  visible,
  uri,
  title,
  loading = false,
  loadingHint = "Đang tải video…",
  error = null,
  onClose,
}: Props) {
  const [playbackError, setPlaybackError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) setPlaybackError(null);
  }, [visible, uri]);

  const displayError = error || playbackError;

  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.brand} size="large" />
            <Text style={styles.loadingText}>{loadingHint}</Text>
          </View>
        ) : displayError ? (
          <Pressable style={styles.center} onPress={onClose}>
            <Text style={styles.errorText}>{displayError}</Text>
          </Pressable>
        ) : uri ? (
          <VideoPlayerBody
            uri={uri}
            title={title}
            onClose={onClose}
            onPlaybackError={setPlaybackError}
          />
        ) : null}
      </View>
    </Modal>
  );
}

const styles = createThemedStyles((colors) => ({
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
  loadingText: {
    color: "#e8e0d4",
    fontSize: 16,
    textAlign: "center",
    lineHeight: 24,
    paddingHorizontal: 16,
  },
  errorText: {
    color: colors.danger,
    fontSize: 16,
    textAlign: "center",
    lineHeight: 24,
  },
  playerRoot: { flex: 1, gap: 12, paddingHorizontal: 12 },
  header: {
    alignItems: "center",
    gap: 10,
    paddingBottom: 4,
  },
  handle: {
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: "rgba(244, 239, 230, 0.35)",
  },
  headerTitle: {
    alignSelf: "stretch",
    fontFamily: fonts.display,
    fontSize: 20,
    color: "#f4efe6",
    textAlign: "center",
  },
  videoWrap: {
    flex: 1,
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: "#000",
  },
  video: {
    flex: 1,
    width: "100%",
  },
  bufferOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.45)",
    gap: 12,
  },
  bufferText: { color: "#f4efe6", fontSize: 15 },
}));
