import { InterviewPrompt } from "@forever/api-client";
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  useAudioRecorder,
} from "expo-audio";
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { preparePlaybackMode, prepareRecordingMode } from "@/lib/audio";
import { useAuth } from "@/lib/auth";
import { colors, fonts } from "@/lib/theme";

export default function InterviewScreen() {
  const { spaceId } = useLocalSearchParams<{ spaceId: string }>();
  const { api } = useAuth();
  const navigation = useNavigation();
  const router = useRouter();
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [prompts, setPrompts] = useState<InterviewPrompt[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [recording, setRecording] = useState(false);

  useLayoutEffect(() => {
    navigation.setOptions({ title: "Time-Capsule" });
  }, [navigation]);

  const load = useCallback(async () => {
    if (!spaceId) return;
    setLoading(true);
    try {
      const res = await api.listInterviewPrompts(spaceId);
      setPrompts(res.prompts);
    } catch (e) {
      Alert.alert("Lỗi", e instanceof Error ? e.message : "Không tải câu hỏi.");
    } finally {
      setLoading(false);
    }
  }, [api, spaceId]);

  useEffect(() => {
    load();
  }, [load]);

  const submitText = async (prompt: InterviewPrompt) => {
    if (!spaceId || !answer.trim() || submitting) return;
    setSubmitting(true);
    try {
      await api.answerInterviewText(spaceId, prompt.id, { body: answer.trim() });
      setAnswer("");
      setActiveId(null);
      await load();
      Alert.alert("Đã lưu", "Câu trả lời đã vào Thư viện ký ức.", [
        {
          text: "Xem thư viện",
          onPress: () => router.push(`/library/${spaceId}`),
        },
        { text: "OK" },
      ]);
    } catch (e) {
      Alert.alert("Lỗi", e instanceof Error ? e.message : "Không gửi được.");
    } finally {
      setSubmitting(false);
    }
  };

  const startRecording = async (promptId: string) => {
    try {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) {
        Alert.alert("Cần quyền", "Cho phép micro để ghi voice note.");
        return;
      }
      await prepareRecordingMode();
      await recorder.prepareToRecordAsync();
      recorder.record();
      setActiveId(promptId);
      setRecording(true);
    } catch (e) {
      setRecording(false);
      Alert.alert("Lỗi", e instanceof Error ? e.message : "Không ghi âm được.");
    }
  };

  const stopAndSubmitVoice = async (prompt: InterviewPrompt) => {
    if (!spaceId || submitting) return;
    setSubmitting(true);
    try {
      await recorder.stop();
      setRecording(false);
      await preparePlaybackMode();
      const uri = recorder.uri;
      if (!uri) throw new Error("Không có file ghi âm.");

      await api.answerInterviewVoice(spaceId, prompt.id, {
        uri,
        name: "answer.m4a",
        mimeType: "audio/mp4",
        body: prompt.body,
        title: "Voice Time-Capsule",
      });
      setActiveId(null);
      await load();
      Alert.alert("Đã lưu", "Giọng nói đã vào Thư viện ký ức.", [
        {
          text: "Xem thư viện",
          onPress: () => router.push(`/library/${spaceId}`),
        },
        { text: "OK" },
      ]);
    } catch (e) {
      Alert.alert("Lỗi", e instanceof Error ? e.message : "Không gửi voice được.");
    } finally {
      setSubmitting(false);
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
    <View style={styles.root}>
      <Text style={styles.intro}>
        Một câu hỏi cội nguồn. Trả lời bằng chữ hoặc giọng nói — không cần dài.
      </Text>
      <FlatList
        data={prompts}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => {
          const open = activeId === item.id && !item.answered;
          return (
            <View style={[styles.card, item.answered && styles.cardDone]}>
              <Text style={styles.prompt}>{item.body}</Text>
              {item.answered ? (
                <Text style={styles.done}>Đã trả lời · đã lưu vào thư viện</Text>
              ) : (
                <>
                  <Pressable
                    style={styles.openBtn}
                    onPress={() => {
                      setActiveId(open ? null : item.id);
                      setAnswer("");
                    }}
                  >
                    <Text style={styles.openText}>{open ? "Thu gọn" : "Trả lời"}</Text>
                  </Pressable>
                  {open ? (
                    <View style={styles.answerBox}>
                      <TextInput
                        value={answer}
                        onChangeText={setAnswer}
                        placeholder="Viết vài câu…"
                        placeholderTextColor={colors.inkSoft}
                        style={styles.input}
                        multiline
                      />
                      <View style={styles.row}>
                        <Pressable
                          style={[
                            styles.primary,
                            (!answer.trim() || submitting) && { opacity: 0.5 },
                          ]}
                          onPress={() => submitText(item)}
                          disabled={!answer.trim() || submitting}
                        >
                          <Text style={styles.primaryText}>Gửi chữ</Text>
                        </Pressable>
                        {!recording ? (
                          <Pressable
                            style={styles.secondary}
                            onPress={() => startRecording(item.id)}
                            disabled={submitting}
                          >
                            <Text style={styles.secondaryText}>Ghi giọng nói</Text>
                          </Pressable>
                        ) : (
                          <Pressable
                            style={styles.recordStop}
                            onPress={() => stopAndSubmitVoice(item)}
                            disabled={submitting}
                          >
                            <Text style={styles.primaryText}>Dừng & gửi</Text>
                          </Pressable>
                        )}
                      </View>
                    </View>
                  ) : null}
                </>
              )}
            </View>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bg,
  },
  intro: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
    color: colors.inkSoft,
    lineHeight: 22,
  },
  list: { padding: 16, paddingBottom: 40 },
  card: {
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.line,
  },
  cardDone: { opacity: 0.85 },
  prompt: {
    fontFamily: fonts.display,
    fontSize: 20,
    color: colors.ink,
    lineHeight: 28,
  },
  done: { marginTop: 10, color: colors.brandSoft, fontWeight: "600" },
  openBtn: { marginTop: 12, alignSelf: "flex-start" },
  openText: { color: colors.brand, fontWeight: "600" },
  answerBox: { marginTop: 12, gap: 10 },
  input: {
    minHeight: 90,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: "#fff",
    color: colors.ink,
    fontSize: 16,
    textAlignVertical: "top",
  },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  primary: {
    backgroundColor: colors.brand,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  primaryText: { color: "#f4efe6", fontWeight: "600" },
  secondary: {
    backgroundColor: colors.bgDeep,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: colors.line,
  },
  secondaryText: { color: colors.brand, fontWeight: "600" },
  recordStop: {
    backgroundColor: colors.danger,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
});
