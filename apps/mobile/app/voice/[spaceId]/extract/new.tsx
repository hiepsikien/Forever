import * as DocumentPicker from "expo-document-picker";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
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
import { useSpaceScreenOptions } from "@/lib/spaceHeader";
import { colors, fonts } from "@/lib/theme";

export default function ExtractNewScreen() {
  const { spaceId, voiceId } = useLocalSearchParams<{
    spaceId: string;
    voiceId?: string;
  }>();
  const { api } = useAuth();
  const router = useRouter();

  const [numSpeakers, setNumSpeakers] = useState("2");
  const [file, setFile] = useState<{
    uri: string;
    name: string;
    mimeType: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  useSpaceScreenOptions({
    spaceId,
    title: "Giọng từ ký ức",
    backTitle: "Nhà",
  });

  const pick = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: ["audio/*"],
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    setFile({
      uri: asset.uri,
      name: asset.name || "tape.m4a",
      mimeType: asset.mimeType || "audio/m4a",
    });
  };

  const submit = async () => {
    if (!spaceId) return;
    if (!file) {
      Alert.alert("Chưa chọn băng", "Chọn file audio nhiều người nói.");
      return;
    }
    const n = Number.parseInt(numSpeakers, 10);
    if (!Number.isFinite(n) || n < 1 || n > 20) {
      Alert.alert("Số người", "Nhập số người nói từ 1 đến 20.");
      return;
    }
    setBusy(true);
    try {
      const job = await api.createExtractJob(spaceId, {
        uri: file.uri,
        name: file.name,
        mimeType: file.mimeType,
        numSpeakers: n,
        voiceProfileId: voiceId || undefined,
      });
      const q = voiceId ? `?voiceId=${voiceId}` : "";
      router.replace(`/voice/${spaceId}/extract/${job.id}${q}` as never);
    } catch (e) {
      Alert.alert(
        "Lỗi",
        e instanceof Error ? e.message : "Không tạo được job Extract.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.root}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.title}>Pool giọng từ băng cũ</Text>
      <Text style={styles.body}>
        Chạy một lần → pool chung các SPEAKER. Sau đó gán từng người quan tâm
        vào Voice DNA riêng (có sẵn hoặc tạo mới). Người không cần thì bỏ.
      </Text>

      <Text style={styles.label}>Số người nói trong băng</Text>
      <TextInput
        style={styles.input}
        value={numSpeakers}
        onChangeText={setNumSpeakers}
        keyboardType="number-pad"
        placeholder="vd. 5"
        placeholderTextColor={colors.inkSoft}
      />

      <Pressable style={styles.pick} onPress={pick} disabled={busy}>
        <Text style={styles.pickTitle}>
          {file ? "Đổi file audio" : "Chọn file audio"}
        </Text>
        <Text style={styles.pickSub}>
          {file ? file.name : "m4a / wav / mp3 · tối đa ~80MB"}
        </Text>
      </Pressable>

      <Pressable
        style={[styles.btn, (!file || busy) && styles.disabled]}
        onPress={submit}
        disabled={!file || busy}
      >
        {busy ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.btnText}>Tạo pool & tách giọng</Text>
        )}
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  root: { padding: 20, gap: 14, paddingBottom: 40 },
  title: {
    fontFamily: fonts.display,
    fontSize: 26,
    color: colors.ink,
  },
  body: { fontSize: 15, lineHeight: 22, color: colors.inkSoft },
  label: {
    marginTop: 8,
    fontSize: 13,
    fontWeight: "700",
    color: colors.inkSoft,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.ink,
  },
  pick: {
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 16,
    gap: 4,
  },
  pickTitle: { fontSize: 16, fontWeight: "700", color: colors.brand },
  pickSub: { fontSize: 13, color: colors.inkSoft },
  btn: {
    marginTop: 8,
    backgroundColor: colors.brand,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
  },
  btnText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  disabled: { opacity: 0.45 },
});
