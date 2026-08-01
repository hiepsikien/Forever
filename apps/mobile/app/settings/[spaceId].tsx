import { SpaceSettings } from "@forever/api-client";
import { useNavigation } from "@react-navigation/native";
import { useLocalSearchParams } from "expo-router";
import { useCallback, useLayoutEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { useAuth } from "@/lib/auth";
import { colors, fonts } from "@/lib/theme";

export default function SettingsScreen() {
  const { spaceId } = useLocalSearchParams<{ spaceId: string }>();
  const { api } = useAuth();
  const navigation = useNavigation();
  const [settings, setSettings] = useState<SpaceSettings | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useLayoutEffect(() => {
    navigation.setOptions({ title: "Cài đặt" });
  }, [navigation]);

  const load = useCallback(async () => {
    if (!spaceId) return;
    setLoading(true);
    try {
      const res = await api.getSpaceSettings(spaceId);
      setSettings(res);
    } catch (e) {
      Alert.alert("Lỗi", e instanceof Error ? e.message : "Không tải cài đặt.");
    } finally {
      setLoading(false);
    }
  }, [api, spaceId]);

  useLayoutEffect(() => {
    load();
  }, [load]);

  const saveKey = async () => {
    if (!spaceId || saving) return;
    if (!settings?.can_edit) {
      Alert.alert("Không đủ quyền", "Chỉ Steward hoặc Owner mới đổi API key.");
      return;
    }
    setSaving(true);
    try {
      const res = await api.updateSpaceSettings(spaceId, {
        elevenlabs_api_key: apiKey.trim() || null,
      });
      setSettings(res);
      setApiKey("");
      Alert.alert(
        "Đã lưu",
        res.elevenlabs_api_key_set
          ? "ElevenLabs API key đã cập nhật."
          : "Đã xóa API key khỏi không gian này.",
      );
    } catch (e) {
      Alert.alert("Lỗi", e instanceof Error ? e.message : "Không lưu được.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.root}>
      <Text style={styles.section}>Voice DNA · ElevenLabs</Text>
      <Text style={styles.help}>
        Key dùng để clone giọng và TTS trong không gian này. Chỉ Steward / Owner
        được sửa. Key không hiện lại đầy đủ sau khi lưu.
      </Text>

      <View style={styles.card}>
        <Text style={styles.label}>Trạng thái</Text>
        <Text style={styles.value}>
          {settings?.elevenlabs_api_key_set
            ? `Đã cấu hình${settings.elevenlabs_api_key_hint ? ` ${settings.elevenlabs_api_key_hint}` : ""}`
            : "Chưa có API key"}
        </Text>

        {settings?.can_edit ? (
          <>
            <Text style={[styles.label, { marginTop: 16 }]}>API key mới</Text>
            <TextInput
              style={styles.input}
              value={apiKey}
              onChangeText={setApiKey}
              placeholder="sk_… (để trống rồi Lưu để xóa)"
              placeholderTextColor={colors.inkSoft}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
            />
            <Pressable
              style={[styles.btn, saving && styles.btnDisabled]}
              onPress={saveKey}
              disabled={saving}
            >
              <Text style={styles.btnText}>{saving ? "Đang lưu…" : "Lưu API key"}</Text>
            </Pressable>
          </>
        ) : (
          <Text style={styles.locked}>
            Bạn chỉ xem được trạng thái. Nhờ Steward nhập key nếu cần Voice DNA.
          </Text>
        )}
      </View>

      <Text style={styles.footnote}>
        Lấy key tại elevenlabs.io → Profile → API Keys. Gói Starter trở lên để
        Instant Voice Clone qua API.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg },
  root: { padding: 20, gap: 12, backgroundColor: colors.bg },
  section: {
    fontFamily: fonts.display,
    fontSize: 22,
    color: colors.ink,
    marginBottom: 4,
  },
  help: { fontSize: 14, lineHeight: 20, color: colors.inkSoft, marginBottom: 8 },
  card: {
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.line,
    gap: 8,
  },
  label: { fontSize: 12, fontWeight: "600", color: colors.inkSoft, textTransform: "uppercase" },
  value: { fontSize: 16, color: colors.ink },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.ink,
    backgroundColor: "#fff",
  },
  btn: {
    marginTop: 8,
    backgroundColor: colors.brand,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  locked: { marginTop: 8, fontSize: 14, color: colors.inkSoft, lineHeight: 20 },
  footnote: { fontSize: 12, color: colors.inkSoft, lineHeight: 18, marginTop: 8 },
});
