import { HeritageReadiness } from "@forever/api-client";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";

import { useAuth } from "@/lib/auth";
import { useSpaceScreenOptions } from "@/lib/spaceHeader";
import { colors, fonts, createThemedStyles } from "@/lib/theme";

function pillarLabel(done: boolean, active: boolean): string {
  if (done) return "✓";
  if (active) return "●";
  return "○";
}

export default function AwakeningScreen() {
  const { spaceId, identityId } = useLocalSearchParams<{
    spaceId: string;
    identityId: string;
  }>();
  const { api } = useAuth();
  const router = useRouter();
  const [readiness, setReadiness] = useState<HeritageReadiness | null>(null);
  const [loading, setLoading] = useState(true);
  const [activating, setActivating] = useState(false);

  const title = readiness
    ? readiness.relation_label
      ? `${readiness.display_name} · ${readiness.relation_label}`
      : readiness.display_name
    : "Thổi hồn";

  useSpaceScreenOptions({
    spaceId,
    title: "Thổi hồn",
    backTitle: "Nhà",
  });

  const load = useCallback(async () => {
    if (!spaceId || !identityId) return;
    setLoading(true);
    try {
      const res = await api.getHeritageReadiness(spaceId, identityId);
      setReadiness(res);
    } catch (e) {
      Alert.alert("Lỗi", e instanceof Error ? e.message : "Không tải được.");
    } finally {
      setLoading(false);
    }
  }, [api, spaceId, identityId]);

  useEffect(() => {
    void load();
  }, [load]);

  const activate = async () => {
    if (!spaceId || !identityId || activating) return;
    setActivating(true);
    try {
      const res = await api.activateHeritageEntity(spaceId, identityId);
      setReadiness(res);
      Alert.alert(
        "Đã kích hoạt",
        "Thực thể ký ức sẵn sàng trò chuyện (phản hồi AI sẽ bổ sung sau).",
      );
    } catch (e) {
      Alert.alert("Lỗi", e instanceof Error ? e.message : "Không kích hoạt được.");
    } finally {
      setActivating(false);
    }
  };

  if (loading || !readiness) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }

  const tagHint = `heritage:${readiness.identity_id}`;

  return (
    <ScrollView contentContainerStyle={styles.root}>
      <Text style={styles.lead}>
        {title} — thổi hồn là gom giọng nói và ký ức thật trước khi mở trò
        chuyện Ký ức. Voice DNA chỉ là một phần; cần cả tri thức và bản sắc.
      </Text>

      <View style={styles.statusCard}>
        <Text style={styles.statusTitle}>
          {readiness.entity_status === "ready"
            ? "Sẵn sàng trò chuyện"
            : readiness.entity_status === "paused"
              ? "Đã tạm dừng"
              : readiness.entity_status === "awakening"
                ? "Đủ điều kiện — chờ kích hoạt"
                : readiness.entity_status === "gathering"
                  ? "Đang thổi hồn"
                  : "Chưa bắt đầu"}
        </Text>
        <Text style={styles.statusSub}>
          Giọng {readiness.voice_ready ? "đã có" : "chưa đủ"} · Ký ức neo{" "}
          {readiness.knowledge_count}/{readiness.knowledge_target}
          {typeof readiness.poem_count === "number"
            ? ` · Thơ ${readiness.poem_count}`
            : ""}
          {" · "}
          Bản sắc {readiness.profile_ready ? "đã duyệt" : "chưa duyệt"}
        </Text>
      </View>

      <Text style={styles.section}>Ba trụ</Text>

      <View style={styles.pillar}>
        <Text style={styles.pillarMark}>
          {pillarLabel(readiness.voice_ready, !readiness.voice_ready)}
        </Text>
        <View style={styles.pillarBody}>
          <Text style={styles.pillarTitle}>Giọng nói</Text>
          <Text style={styles.pillarSub}>
            {readiness.processed_count > 0
              ? `${readiness.processed_count} mẫu sẵn sàng`
              : "Thu và duyệt ít nhất một mẫu giọng"}
          </Text>
          {readiness.voice_profile_id ? (
            <Pressable
              onPress={() =>
                router.push(
                  `/voice/${spaceId}?identityId=${identityId}` as never,
                )
              }
            >
              <Text style={styles.link}>Mở Voice DNA →</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      <View style={styles.pillar}>
        <Text style={styles.pillarMark}>
          {pillarLabel(
            readiness.knowledge_ready,
            !readiness.knowledge_ready && readiness.knowledge_count > 0,
          )}
        </Text>
        <View style={styles.pillarBody}>
          <Text style={styles.pillarTitle}>Ký ức neo</Text>
          <Text style={styles.pillarSub}>
            Cần {readiness.knowledge_target} ghi chú / mốc / time-capsule gắn tag{" "}
            <Text style={styles.mono}>{tagHint}</Text>. Thơ không tính vào cổng
            kích hoạt
            {typeof readiness.poem_count === "number"
              ? ` (đang có ${readiness.poem_count} bài).`
              : "."}
          </Text>
          <Pressable onPress={() => router.push(`/library/${spaceId}`)}>
            <Text style={styles.link}>Mở Thư viện →</Text>
          </Pressable>
          <Pressable onPress={() => router.push(`/interview/${spaceId}`)}>
            <Text style={styles.link}>Time-Capsule →</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.pillar}>
        <Text style={styles.pillarMark}>
          {pillarLabel(Boolean(readiness.profile_ready), !readiness.profile_ready)}
        </Text>
        <View style={styles.pillarBody}>
          <Text style={styles.pillarTitle}>Bản sắc</Text>
          <Text style={styles.pillarSub}>
            Identity Lock đã hiệu đính (giá trị, giọng điệu, xưng hô, taboo) —
            bắt buộc trước khi kích hoạt.
          </Text>
        </View>
      </View>

      <View style={styles.pillar}>
        <Text style={styles.pillarMark}>
          {pillarLabel(
            readiness.entity_status === "ready",
            readiness.can_activate || readiness.entity_status === "paused",
          )}
        </Text>
        <View style={styles.pillarBody}>
          <Text style={styles.pillarTitle}>Kích hoạt</Text>
          <Text style={styles.pillarSub}>
            Khi đủ giọng, {readiness.knowledge_target} ký ức neo và Bản sắc đã
            duyệt, người quản lý nhà xác nhận mở trò chuyện Ký ức. Có thể tạm
            dừng bất cứ lúc nào.
          </Text>
        </View>
      </View>

      {readiness.can_activate ? (
        <Pressable
          style={[styles.btn, activating && styles.disabled]}
          onPress={activate}
          disabled={activating}
        >
          <Text style={styles.btnText}>
            {activating ? "Đang kích hoạt…" : "Kích hoạt thực thể ký ức"}
          </Text>
        </Pressable>
      ) : readiness.chat_ready ? (
        <Pressable
          style={styles.btn}
          onPress={async () => {
            if (!spaceId || !identityId) return;
            setActivating(true);
            try {
              const res = await api.pauseHeritageEntity(spaceId, identityId);
              setReadiness(res);
            } catch (e) {
              Alert.alert(
                "Lỗi",
                e instanceof Error ? e.message : "Không tạm dừng được.",
              );
            } finally {
              setActivating(false);
            }
          }}
          disabled={activating}
        >
          <Text style={styles.btnText}>
            {activating ? "Đang tạm dừng…" : "Tạm dừng thực thể (kill switch)"}
          </Text>
        </Pressable>
      ) : readiness.entity_status === "paused" && readiness.can_resume ? (
        <Pressable
          style={[styles.btn, activating && styles.disabled]}
          onPress={async () => {
            if (!spaceId || !identityId) return;
            setActivating(true);
            try {
              const res = await api.resumeHeritageEntity(spaceId, identityId);
              setReadiness(res);
            } catch (e) {
              Alert.alert(
                "Lỗi",
                e instanceof Error ? e.message : "Không mở lại được.",
              );
            } finally {
              setActivating(false);
            }
          }}
          disabled={activating}
        >
          <Text style={styles.btnText}>
            {activating ? "Đang mở lại…" : "Mở lại thực thể ký ức"}
          </Text>
        </Pressable>
      ) : (
        <Text style={styles.footnote}>
          Hoàn thành Giọng, Ký ức neo và Bản sắc rồi quay lại kích hoạt.
        </Text>
      )}
    </ScrollView>
  );
}

const styles = createThemedStyles((colors) => ({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bg,
  },
  root: { padding: 20, gap: 12, paddingBottom: 48, backgroundColor: colors.bg },
  lead: {
    fontFamily: fonts.display,
    fontSize: 18,
    lineHeight: 26,
    color: colors.ink,
  },
  statusCard: {
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 16,
    gap: 4,
  },
  statusTitle: {
    fontFamily: fonts.display,
    fontSize: 20,
    color: colors.ink,
  },
  statusSub: { fontSize: 14, lineHeight: 20, color: colors.inkSoft },
  section: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.inkSoft,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginTop: 8,
  },
  pillar: {
    flexDirection: "row",
    gap: 12,
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 14,
  },
  pillarMark: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.brand,
    width: 22,
    textAlign: "center",
  },
  pillarBody: { flex: 1, gap: 6 },
  pillarTitle: { fontSize: 16, fontWeight: "700", color: colors.ink },
  pillarSub: { fontSize: 14, lineHeight: 20, color: colors.inkSoft },
  mono: { fontFamily: "Menlo", fontSize: 12, color: colors.ink },
  link: { fontSize: 14, fontWeight: "700", color: colors.brand },
  btn: {
    marginTop: 8,
    backgroundColor: colors.brand,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  btnText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  disabled: { opacity: 0.6 },
  footnote: {
    fontSize: 13,
    lineHeight: 19,
    color: colors.inkSoft,
    marginTop: 8,
  },
}));
