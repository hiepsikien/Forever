import { StoryChunkDetail } from "@forever/api-client";
import { useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";

import { playLocalAudio, stopActivePlayback } from "@/lib/audio";
import { useAuth } from "@/lib/auth";
import { fetchAuthedMediaUri } from "@/lib/media";
import { useSpaceScreenOptions } from "@/lib/spaceHeader";
import { colors, fonts, createThemedStyles } from "@/lib/theme";

export default function StoryListenScreen() {
  const { spaceId, identityId, work } = useLocalSearchParams<{
    spaceId: string;
    identityId: string;
    work?: string;
  }>();
  const { api } = useAuth();
  const [loading, setLoading] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [detail, setDetail] = useState<StoryChunkDetail | null>(null);
  const [empty, setEmpty] = useState(false);

  useSpaceScreenOptions({
    spaceId,
    title: "Nghe kể chuyện",
    backTitle: "Kệ",
  });

  const loadNext = useCallback(async () => {
    if (!spaceId || !identityId) return;
    setLoading(true);
    setEmpty(false);
    setPlaying(false);
    await stopActivePlayback();
    try {
      const next = await api.nextStoryToListen(
        spaceId,
        identityId,
        typeof work === "string" ? work : undefined,
      );
      setDetail(next);
    } catch {
      setDetail(null);
      setEmpty(true);
    } finally {
      setLoading(false);
    }
  }, [api, identityId, spaceId, work]);

  useEffect(() => {
    void loadNext();
    return () => {
      void stopActivePlayback();
    };
  }, [loadNext]);

  const play = async () => {
    if (!detail?.recording?.id) return;
    try {
      if (playing) {
        await stopActivePlayback();
        setPlaying(false);
        return;
      }
      const uri = await fetchAuthedMediaUri(
        api.storyRecordingMediaUrl(detail.recording.id),
        detail.recording.id,
        detail.recording.media_mime ?? "audio/mp4",
      );
      setPlaying(true);
      await playLocalAudio(uri, () => setPlaying(false));
    } catch (e) {
      setPlaying(false);
      Alert.alert("Lỗi", e instanceof Error ? e.message : "Không phát được.");
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }

  if (empty || !detail) {
    return (
      <View style={styles.centerPad}>
        <Text style={styles.emptyTitle}>Chưa có đoạn nào để nghe</Text>
        <Text style={styles.emptyBody}>
          Thu kể chuyện trước — app chỉ phát lại giọng đã ghi, không đọc hộ.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.work}>
          {detail.work.title}
          {detail.chunk.label ? ` · ${detail.chunk.label}` : ""}
        </Text>
        <Text style={styles.body}>{detail.chunk.body}</Text>
      </ScrollView>
      <View style={styles.footer}>
        <Pressable style={styles.primaryBtn} onPress={play}>
          <Text style={styles.primaryBtnText}>
            {playing ? "Dừng" : "Phát giọng thật"}
          </Text>
        </Pressable>
        <Pressable style={styles.secondaryBtn} onPress={() => void loadNext()}>
          <Text style={styles.secondaryBtnText}>Đoạn khác</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = createThemedStyles(() => ({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 20, paddingBottom: 24 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  centerPad: {
    flex: 1,
    padding: 28,
    justifyContent: "center",
    gap: 12,
  },
  emptyTitle: {
    fontFamily: fonts.serif,
    fontSize: 22,
    color: colors.ink,
  },
  emptyBody: {
    fontFamily: fonts.sans,
    fontSize: 15,
    lineHeight: 22,
    color: colors.muted,
  },
  work: {
    fontFamily: fonts.sansSemi,
    fontSize: 14,
    color: colors.muted,
    marginBottom: 16,
  },
  body: {
    fontFamily: fonts.serif,
    fontSize: 20,
    lineHeight: 32,
    color: colors.ink,
  },
  footer: {
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    gap: 10,
  },
  primaryBtn: {
    backgroundColor: colors.brand,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  primaryBtnText: {
    fontFamily: fonts.sansSemi,
    color: "#fff",
    fontSize: 16,
  },
  secondaryBtn: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  secondaryBtnText: {
    fontFamily: fonts.sansSemi,
    color: colors.ink,
    fontSize: 16,
  },
}));
