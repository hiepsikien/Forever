import { IdentityProfile, ThreadSummary } from "@forever/api-client";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  Text,
  View,
} from "react-native";

import { useAuth } from "@/lib/auth";
import { identityChipLabel } from "@/lib/identityDisplay";
import { useSpaceScreenOptions } from "@/lib/spaceHeader";
import { colors, fonts, createThemedStyles } from "@/lib/theme";

export default function LivingPersonProfileScreen() {
  const { spaceId, identityId } = useLocalSearchParams<{
    spaceId: string;
    identityId: string;
  }>();
  const { api, user } = useAuth();
  const router = useRouter();
  const [person, setPerson] = useState<IdentityProfile | null>(null);
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const title = person ? identityChipLabel(person, user?.id) : "Thành viên";

  useSpaceScreenOptions({
    spaceId,
    title,
    backTitle: "Thư viện",
  });

  const load = useCallback(async () => {
    if (!spaceId || !identityId) return;
    setError(null);
    try {
      const [idRes, thrRes] = await Promise.all([
        api.listIdentities(spaceId),
        api.listThreads(spaceId),
      ]);
      const found =
        idRes.identities.find((i) => i.id === identityId) ?? null;
      setPerson(found);
      setThreads(thrRes.threads ?? []);
      if (found?.status === "remembered") {
        router.replace(`/library/${spaceId}/person/${identityId}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tải được.");
    } finally {
      setLoading(false);
    }
  }, [api, identityId, router, spaceId]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }

  if (!person) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error ?? "Không tìm thấy người này."}</Text>
      </View>
    );
  }

  const heritageThread = threads.find(
    (t) =>
      t.kind === "heritage" &&
      t.heritage?.identity_id === person.id &&
      t.audience_scope === "family",
  );
  const directThread = threads.find(
    (t) =>
      t.kind === "heritage" &&
      t.heritage?.identity_id === person.id &&
      t.audience_scope === "direct",
  );

  return (
    <View style={styles.root}>
      <View style={styles.hero}>
        <Text style={styles.kicker}>Đang sống</Text>
        <Text style={styles.name}>{identityChipLabel(person, user?.id)}</Text>
        {person.relation_label &&
        person.relation_label.trim().toLowerCase() !== "tôi" ? (
          <Text style={styles.relation}>{person.relation_label}</Text>
        ) : null}
        <Text style={styles.blurb}>
          Trang hồ sơ đơn giản — ký ức về người này, nếu có, nằm trong Thư viện.
        </Text>
      </View>

      {heritageThread?.heritage?.chat_ready ? (
        <Pressable
          style={styles.action}
          onPress={() => router.push(`/call/${heritageThread.id}`)}
        >
          <Text style={styles.actionTitle}>Gọi / trò chuyện</Text>
          <Text style={styles.actionSub}>Mở phòng với {person.display_name}</Text>
        </Pressable>
      ) : null}

      {directThread ? (
        <Pressable
          style={styles.action}
          onPress={() => router.push(`/chat/${directThread.id}`)}
        >
          <Text style={styles.actionTitle}>Phòng riêng</Text>
          <Text style={styles.actionSub}>Trò chuyện riêng với người này</Text>
        </Pressable>
      ) : null}

      <Pressable
        style={styles.action}
        onPress={() => spaceId && router.push(`/library/${spaceId}`)}
      >
        <Text style={styles.actionTitle}>Thư viện</Text>
        <Text style={styles.actionSub}>Xem ký ức gia đình</Text>
      </Pressable>

      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = createThemedStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.bg, padding: 20, gap: 12 },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bg,
    padding: 20,
  },
  hero: {
    backgroundColor: colors.bgDeep,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 20,
    gap: 6,
    marginBottom: 8,
  },
  kicker: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.brandSoft,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  name: {
    fontFamily: fonts.display,
    fontSize: 28,
    color: colors.ink,
  },
  relation: { fontSize: 15, color: colors.inkSoft },
  blurb: { fontSize: 14, lineHeight: 21, color: colors.inkSoft, marginTop: 4 },
  action: {
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 16,
    gap: 4,
  },
  actionTitle: { fontSize: 16, fontWeight: "700", color: colors.ink },
  actionSub: { fontSize: 13, color: colors.inkSoft },
  error: { color: "#b3261e", fontSize: 14, marginTop: 8 },
}));
