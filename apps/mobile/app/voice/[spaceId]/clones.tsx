import { ElevenLabsVoice } from "@forever/api-client";
import { useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { useAuth } from "@/lib/auth";
import { elVoiceSortKey, formatElVoiceWhen } from "@/lib/elVoice";
import { useSpaceScreenOptions } from "@/lib/spaceHeader";
import { colors, fonts } from "@/lib/theme";

export default function VoiceClonesScreen() {
  const { spaceId, voiceId } = useLocalSearchParams<{
    spaceId: string;
    voiceId?: string;
  }>();
  const { api } = useAuth();
  const [voices, setVoices] = useState<ElevenLabsVoice[]>([]);
  const [activeProviderId, setActiveProviderId] = useState<string | null>(null);
  const [profileName, setProfileName] = useState("");
  const [loading, setLoading] = useState(true);

  useSpaceScreenOptions({ spaceId, title: "Lịch sử clone", backTitle: "Nhà" });

  const load = useCallback(async () => {
    if (!spaceId) return;
    setLoading(true);
    try {
      let providerId: string | null = null;
      let name = "";
      if (voiceId) {
        const profile = await api.getVoice(voiceId);
        providerId = profile.provider_voice_id ?? null;
        name = profile.display_name;
        setActiveProviderId(providerId);
        setProfileName(name);
      }
      const res = await api.listElevenLabsVoices(spaceId, {
        clonedOnly: true,
        voiceId: voiceId || undefined,
      });
      const sorted = [...res.voices].sort((a, b) => elVoiceSortKey(b) - elVoiceSortKey(a));
      setVoices(sorted);
    } catch (e) {
      Alert.alert("Lỗi", e instanceof Error ? e.message : "Không tải Voice DNA.");
    } finally {
      setLoading(false);
    }
  }, [api, spaceId, voiceId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }

  return (
    <FlatList
      style={styles.root}
      contentContainerStyle={styles.content}
      data={voices}
      keyExtractor={(item) => item.voice_id}
      ListHeaderComponent={
        <View style={styles.header}>
          <Text style={styles.title}>Lịch sử clone</Text>
          <Text style={styles.sub}>
            {profileName
              ? `Các bản Instant Clone của ${profileName} — mới nhất trước.`
              : "Các bản Instant Clone trên ElevenLabs — mới nhất trước."}
          </Text>
          <Pressable onPress={() => void load()}>
            <Text style={styles.refresh}>Làm mới</Text>
          </Pressable>
        </View>
      }
      ListEmptyComponent={
        <Text style={styles.empty}>
          Chưa có bản clone. Quay lại hub và bấm Clone Voice DNA.
        </Text>
      }
      renderItem={({ item }) => {
        const active = activeProviderId === item.voice_id;
        return (
          <View style={[styles.card, active && styles.cardActive]}>
            <Text style={styles.name}>{item.name}</Text>
            <Text style={styles.meta}>
              {formatElVoiceWhen(item)}
              {active ? " · đang gắn" : ""}
            </Text>
            <Text style={styles.id} numberOfLines={1}>
              {item.voice_id}
            </Text>
          </View>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 20, paddingBottom: 40 },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bg,
  },
  header: { gap: 6, marginBottom: 12 },
  title: { fontFamily: fonts.display, fontSize: 24, color: colors.ink },
  sub: { fontSize: 14, lineHeight: 20, color: colors.inkSoft },
  refresh: {
    color: colors.brand,
    fontWeight: "700",
    fontSize: 13,
    marginTop: 4,
  },
  empty: { fontSize: 14, color: colors.inkSoft, marginTop: 16 },
  card: {
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 14,
    gap: 4,
    marginBottom: 8,
  },
  cardActive: { borderColor: colors.brand, backgroundColor: "#F7F3EE" },
  name: { fontSize: 15, fontWeight: "700", color: colors.ink },
  meta: { fontSize: 12, color: colors.inkSoft },
  id: { fontSize: 11, color: colors.inkSoft, marginTop: 2 },
});
