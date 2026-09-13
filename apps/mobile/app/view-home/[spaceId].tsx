import { HomeCameraStatus } from "@forever/api-client";
import { useFocusEffect } from "@react-navigation/native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useVideoPlayer, VideoView } from "expo-video";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { useAuth } from "@/lib/auth";
import { useSpaceScreenOptions } from "@/lib/spaceHeader";
import { colors, fonts, createThemedStyles } from "@/lib/theme";

function LivePlayer({
  uri,
  onError,
}: {
  uri: string;
  onError: (message: string) => void;
}) {
  const [buffering, setBuffering] = useState(true);
  const player = useVideoPlayer(uri, (p) => {
    p.loop = false;
    p.muted = false;
  });

  useEffect(() => {
    const sub = player.addListener("statusChange", ({ status, error }) => {
      if (status === "readyToPlay") {
        setBuffering(false);
        player.play();
      }
      if (status === "error") {
        setBuffering(false);
        onError(
          error?.message ||
            "Không phát được hình. Kiểm tra camera Ezviz hoặc thử lại.",
        );
      }
    });
    return () => {
      sub.remove();
      try {
        player.pause();
      } catch {
        // ignore
      }
    };
  }, [player, onError]);

  return (
    <View style={styles.videoWrap}>
      <VideoView
        player={player}
        style={styles.video}
        contentFit="contain"
        nativeControls
        allowsFullscreen
      />
      {buffering ? (
        <View style={styles.bufferOverlay}>
          <ActivityIndicator color="#fff" size="large" />
          <Text style={styles.bufferText}>Đang kết nối camera…</Text>
        </View>
      ) : null}
    </View>
  );
}

export default function ViewHomeScreen() {
  const { spaceId } = useLocalSearchParams<{ spaceId: string }>();
  const { api } = useAuth();
  const router = useRouter();
  const [status, setStatus] = useState<HomeCameraStatus | null>(null);
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [streamLoading, setStreamLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playbackError, setPlaybackError] = useState<string | null>(null);

  useSpaceScreenOptions({
    spaceId,
    title: "Phòng Xem nhà",
    backTitle: "Nhà",
  });

  const loadStatus = useCallback(async () => {
    if (!spaceId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.getHomeCameraStatus(spaceId);
      setStatus(res);
      if (!res.can_view) {
        setStreamUrl(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tải được trạng thái camera.");
    } finally {
      setLoading(false);
    }
  }, [api, spaceId]);

  const loadStream = useCallback(async () => {
    if (!spaceId) return;
    setStreamLoading(true);
    setPlaybackError(null);
    setError(null);
    try {
      const res = await api.getHomeCameraStream(spaceId);
      setStreamUrl(res.url);
    } catch (e) {
      setStreamUrl(null);
      setError(e instanceof Error ? e.message : "Không lấy được luồng hình.");
    } finally {
      setStreamLoading(false);
    }
  }, [api, spaceId]);

  useFocusEffect(
    useCallback(() => {
      void loadStatus();
    }, [loadStatus]),
  );

  useEffect(() => {
    if (status?.can_view) {
      void loadStream();
    }
  }, [status?.can_view, loadStream]);

  if (loading && !status) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }

  const displayError = error || playbackError;
  const roomLabel = status?.room_label || "Phòng mẹ";

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      {!status?.pro_tier ? (
        <View style={styles.notice}>
          <Text style={styles.noticeTitle}>Forever Pro</Text>
          <Text style={styles.noticeBody}>
            Phòng Xem nhà cần bật Forever Pro trong Cài đặt → AI (Steward).
          </Text>
        </View>
      ) : !status.configured || !status.enabled ? (
        <View style={styles.notice}>
          <Text style={styles.noticeTitle}>Chưa sẵn sàng</Text>
          <Text style={styles.noticeBody}>
            Steward cần cấu hình camera Ezviz và bật Phòng Xem nhà trong Cài đặt.
          </Text>
        </View>
      ) : !status.server_ready ? (
        <View style={styles.notice}>
          <Text style={styles.noticeTitle}>Server chưa kết nối Ezviz</Text>
          <Text style={styles.noticeBody}>
            API Forever cần EZVIZ_APP_KEY và EZVIZ_APP_SECRET trên server.
          </Text>
        </View>
      ) : streamLoading && !streamUrl ? (
        <View style={styles.videoPlaceholder}>
          <ActivityIndicator color={colors.brand} size="large" />
          <Text style={styles.placeholderText}>Đang mở luồng hình…</Text>
        </View>
      ) : displayError ? (
        <View style={styles.notice}>
          <Text style={styles.noticeTitle}>Không xem được</Text>
          <Text style={styles.noticeBody}>{displayError}</Text>
          <Pressable style={styles.retryBtn} onPress={() => void loadStream()}>
            <Text style={styles.retryText}>Thử lại →</Text>
          </Pressable>
        </View>
      ) : streamUrl ? (
        <LivePlayer uri={streamUrl} onError={setPlaybackError} />
      ) : null}

      <View style={styles.metaCard}>
        <Text style={styles.metaKicker}>Đang xem</Text>
        <Text style={styles.metaTitle}>{roomLabel}</Text>
        <Text style={styles.metaHelp}>
          Chỉ thành viên nhà. Không ghi hình mặc động — xem khi cần, không giám sát
          24/7. Mẹ phải biết camera có trong phòng.
        </Text>
      </View>

      <Text style={styles.sectionLabel}>Trò chuyện song song</Text>
      <View style={styles.linkRow}>
        <Pressable
          style={styles.linkTile}
          onPress={() => spaceId && router.push(`/space/${spaceId}` as never)}
        >
          <Text style={styles.linkTitle}>Về nhà</Text>
          <Text style={styles.linkSub}>Gọi Bố · Bà Nội →</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = createThemedStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, gap: 16, paddingBottom: 32 },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bg,
  },
  videoWrap: {
    aspectRatio: 16 / 9,
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: "#000",
  },
  video: { width: "100%", height: "100%" },
  bufferOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.45)",
    gap: 12,
  },
  bufferText: { color: "#f4efe6", fontSize: 15 },
  videoPlaceholder: {
    aspectRatio: 16 / 9,
    borderRadius: 12,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  placeholderText: { color: colors.inkSoft, fontSize: 15 },
  notice: {
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 16,
    gap: 8,
  },
  noticeTitle: {
    fontFamily: fonts.display,
    fontSize: 20,
    color: colors.ink,
  },
  noticeBody: { fontSize: 14, lineHeight: 21, color: colors.inkSoft },
  retryBtn: { marginTop: 4 },
  retryText: { fontSize: 15, fontWeight: "700", color: colors.brand },
  metaCard: {
    backgroundColor: colors.bgDeep,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 16,
    gap: 6,
  },
  metaKicker: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.brandSoft,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  metaTitle: {
    fontFamily: fonts.display,
    fontSize: 22,
    color: colors.ink,
  },
  metaHelp: { fontSize: 13, lineHeight: 20, color: colors.inkSoft },
  sectionLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.inkSoft,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  linkRow: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  linkTile: {
    flexGrow: 1,
    minWidth: "45%",
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 14,
    gap: 4,
  },
  linkTitle: { fontSize: 15, fontWeight: "700", color: colors.ink },
  linkSub: { fontSize: 13, color: colors.brand },
}));
