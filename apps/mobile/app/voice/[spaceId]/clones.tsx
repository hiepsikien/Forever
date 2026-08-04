import {
  ElevenLabsVoice,
  VOICE_PROVIDERS,
  type VoiceProvider,
  voiceProviderLabel,
} from "@forever/api-client";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { useAuth } from "@/lib/auth";
import { elVoiceSortKey, formatElVoiceWhen } from "@/lib/elVoice";
import { useSpaceScreenOptions } from "@/lib/spaceHeader";
import { colors, fonts } from "@/lib/theme";

const SWIPE_DELETE_WIDTH = 88;
const SWIPE_OPEN_THRESHOLD = 48;

/** A clone plus the account it lives on — ids are only unique per provider. */
type Clone = ElevenLabsVoice & { provider: VoiceProvider };

type CloneRowProps = {
  item: Clone;
  active: boolean;
  busy: boolean;
  canSetDefault: boolean;
  onOpenTts: () => void;
  onSetDefault: () => void;
  onDelete: () => void;
};

function CloneRow({
  item,
  active,
  busy,
  canSetDefault,
  onOpenTts,
  onSetDefault,
  onDelete,
}: CloneRowProps) {
  const translateX = useRef(new Animated.Value(0)).current;
  const offsetRef = useRef(0);

  const closeSwipe = useCallback(() => {
    offsetRef.current = 0;
    Animated.spring(translateX, {
      toValue: 0,
      useNativeDriver: true,
      bounciness: 0,
    }).start();
  }, [translateX]);

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) =>
        Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderGrant: () => {
        translateX.stopAnimation((v) => {
          offsetRef.current = v;
        });
      },
      onPanResponderMove: (_, g) => {
        const next = Math.min(0, Math.max(-SWIPE_DELETE_WIDTH, offsetRef.current + g.dx));
        translateX.setValue(next);
      },
      onPanResponderRelease: (_, g) => {
        const projected = offsetRef.current + g.dx;
        const open = projected < -SWIPE_OPEN_THRESHOLD || g.vx < -0.4;
        const toValue = open ? -SWIPE_DELETE_WIDTH : 0;
        offsetRef.current = toValue;
        Animated.spring(translateX, {
          toValue,
          useNativeDriver: true,
          bounciness: 0,
        }).start();
      },
    }),
  ).current;

  return (
    <View style={styles.swipeWrap}>
      <View style={styles.swipeActions}>
        <Pressable
          style={[styles.swipeDelete, busy && styles.disabled]}
          onPress={() => {
            closeSwipe();
            onDelete();
          }}
          disabled={busy}
        >
          <Text style={styles.swipeDeleteText}>{busy ? "…" : "Xóa"}</Text>
        </Pressable>
      </View>
      <Animated.View
        style={[styles.card, active && styles.cardActive, { transform: [{ translateX }] }]}
        {...pan.panHandlers}
      >
        <Pressable onPress={onOpenTts} disabled={busy}>
          <Text style={styles.name}>{item.name}</Text>
          <Text style={styles.meta}>
            {voiceProviderLabel(item.provider)}
            {" · "}
            {formatElVoiceWhen(item)}
            {active ? " · đang dùng" : ""}
            {" · xem TTS"}
          </Text>
          <Text style={styles.id} numberOfLines={1}>
            {item.voice_id}
          </Text>
        </Pressable>
        <View style={styles.row}>
          {canSetDefault && !active ? (
            <Pressable
              style={[styles.actionBtn, busy && styles.disabled]}
              onPress={onSetDefault}
              disabled={busy}
            >
              <Text style={styles.actionBtnText}>Mặc định</Text>
            </Pressable>
          ) : active ? (
            <Text style={styles.activeBadge}>Đang dùng</Text>
          ) : null}
          <Pressable
            onPress={() => {
              closeSwipe();
              onDelete();
            }}
            disabled={busy}
            hitSlop={6}
          >
            <Text style={[styles.deleteLink, busy && styles.disabled]}>
              {busy ? "Đang xóa…" : "Xóa"}
            </Text>
          </Pressable>
        </View>
      </Animated.View>
    </View>
  );
}

export default function VoiceClonesScreen() {
  const { spaceId, voiceId } = useLocalSearchParams<{
    spaceId: string;
    voiceId?: string;
  }>();
  const { api } = useAuth();
  const router = useRouter();
  const [voices, setVoices] = useState<Clone[]>([]);
  const [activeProviderId, setActiveProviderId] = useState<string | null>(null);
  const [profileName, setProfileName] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [skipped, setSkipped] = useState<string[]>([]);

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
      } else {
        setActiveProviderId(null);
        setProfileName("");
      }
      // Both accounts, so a person's history stays in one place.
      const results = await Promise.allSettled(
        VOICE_PROVIDERS.map((p) =>
          api.listElevenLabsVoices(spaceId, {
            clonedOnly: true,
            voiceId: voiceId || undefined,
            provider: p.id,
          }),
        ),
      );
      const merged: Clone[] = [];
      const unreachable: string[] = [];
      results.forEach((result, index) => {
        const p = VOICE_PROVIDERS[index];
        if (result.status === "fulfilled") {
          merged.push(
            ...result.value.voices.map((v) => ({ ...v, provider: p.id })),
          );
        } else {
          unreachable.push(p.label);
        }
      });
      if (unreachable.length === VOICE_PROVIDERS.length) {
        throw new Error("Không tải được bản clone từ cả hai dịch vụ.");
      }
      setSkipped(unreachable);
      setVoices(merged.sort((a, b) => elVoiceSortKey(b) - elVoiceSortKey(a)));
    } catch (e) {
      Alert.alert("Lỗi", e instanceof Error ? e.message : "Không tải Voice DNA.");
    } finally {
      setLoading(false);
    }
  }, [api, spaceId, voiceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const openTts = (item: Clone) => {
    if (!spaceId) return;
    const params = new URLSearchParams();
    if (voiceId) params.set("voiceId", voiceId);
    params.set("providerVoiceId", item.voice_id);
    params.set("cloneName", item.name);
    router.push(`/voice/${spaceId}/renders?${params.toString()}` as never);
  };

  const setDefault = (item: Clone) => {
    if (!voiceId || busyId) return;
    Alert.alert(
      "Đặt làm mặc định?",
      `Voice DNA sẽ dùng “${item.name}” (${voiceProviderLabel(item.provider)}) khi tạo câu nói.`,
      [
        { text: "Huỷ", style: "cancel" },
        {
          text: "Mặc định",
          onPress: async () => {
            setBusyId(item.voice_id);
            try {
              await api.selectVoiceClone(voiceId, item.voice_id, item.provider);
              setActiveProviderId(item.voice_id);
            } catch (e) {
              Alert.alert("Lỗi", e instanceof Error ? e.message : "Không đặt được.");
            } finally {
              setBusyId(null);
            }
          },
        },
      ],
    );
  };

  const removeClone = (item: Clone) => {
    if (!spaceId || busyId) return;
    const active = activeProviderId === item.voice_id;
    Alert.alert(
      "Xóa bản clone?",
      active
        ? `“${item.name}” đang gắn Voice DNA — xóa sẽ gỡ gắn và cần clone lại.`
        : `Xóa “${item.name}” khỏi tài khoản? Không hoàn tác được.`,
      [
        { text: "Huỷ", style: "cancel" },
        {
          text: "Xóa",
          style: "destructive",
          onPress: async () => {
            setBusyId(item.voice_id);
            try {
              await api.deleteElevenLabsVoice(spaceId, item.voice_id, item.provider);
              if (active) setActiveProviderId(null);
              setVoices((prev) => prev.filter((v) => v.voice_id !== item.voice_id));
            } catch (e) {
              Alert.alert("Lỗi", e instanceof Error ? e.message : "Không xóa được.");
            } finally {
              setBusyId(null);
            }
          },
        },
      ],
    );
  };

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
      keyExtractor={(item) => `${item.provider}:${item.voice_id}`}
      ListHeaderComponent={
        <View style={styles.header}>
          <Text style={styles.title}>Lịch sử clone</Text>
          <Text style={styles.sub}>
            {profileName
              ? `Bản clone của ${profileName}. Chạm để xem TTS · vuốt trái để xóa.`
              : "Các bản clone trên tài khoản — mới nhất trước."}
          </Text>
          {skipped.length ? (
            <Text style={styles.warn}>
              Chưa đọc được danh sách từ {skipped.join(", ")} — kiểm tra API key.
            </Text>
          ) : null}
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
      renderItem={({ item }) => (
        <CloneRow
          item={item}
          active={activeProviderId === item.voice_id}
          busy={busyId === item.voice_id}
          canSetDefault={!!voiceId}
          onOpenTts={() => openTts(item)}
          onSetDefault={() => setDefault(item)}
          onDelete={() => removeClone(item)}
        />
      )}
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
  warn: { fontSize: 13, lineHeight: 18, color: colors.danger, fontWeight: "600" },
  refresh: {
    color: colors.brand,
    fontWeight: "700",
    fontSize: 13,
    marginTop: 4,
  },
  empty: { fontSize: 14, color: colors.inkSoft, marginTop: 16 },
  swipeWrap: {
    marginBottom: 8,
    borderRadius: 14,
    overflow: "hidden",
  },
  swipeActions: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "flex-end",
    justifyContent: "center",
    backgroundColor: colors.danger,
  },
  swipeDelete: {
    width: SWIPE_DELETE_WIDTH,
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
  },
  swipeDeleteText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  card: {
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 14,
    gap: 8,
  },
  cardActive: { borderColor: colors.brand, backgroundColor: "#F7F3EE" },
  name: { fontSize: 15, fontWeight: "700", color: colors.ink },
  meta: { fontSize: 12, color: colors.inkSoft, marginTop: 2 },
  id: { fontSize: 11, color: colors.inkSoft, marginTop: 2 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
    marginTop: 4,
  },
  actionBtn: {
    borderWidth: 1,
    borderColor: colors.brand,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 14,
    backgroundColor: colors.bgDeep,
  },
  actionBtnText: { color: colors.brand, fontWeight: "700", fontSize: 13 },
  activeBadge: { fontSize: 13, fontWeight: "700", color: colors.brand },
  deleteLink: { color: colors.danger, fontWeight: "700", fontSize: 13 },
  disabled: { opacity: 0.5 },
});
