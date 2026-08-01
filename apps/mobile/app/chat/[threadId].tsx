import { ChatMessage } from "@forever/api-client";
import {
  requestRecordingPermissionsAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import { useNavigation } from "@react-navigation/native";
import { useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  playLocalAudio,
  preparePlaybackMode,
  prepareRecordingMode,
  stopActivePlayback,
} from "@/lib/audio";
import { RecordingLevelMeter } from "@/lib/recordingMeter";
import { VOICE_RECORDING_OPTIONS } from "@/lib/recordingOptions";
import { useAuth } from "@/lib/auth";
import { fetchAuthedMediaUri } from "@/lib/media";
import { colors } from "@/lib/theme";

function uniqueById(items: ChatMessage[]): ChatMessage[] {
  const seen = new Set<string>();
  const out: ChatMessage[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

function isVoiceMessage(item: ChatMessage): boolean {
  return (item.kind ?? "text") === "voice";
}

export default function ChatScreen() {
  const { threadId } = useLocalSearchParams<{ threadId: string }>();
  const { api, user } = useAuth();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const recorder = useAudioRecorder(VOICE_RECORDING_OPTIONS);
  const recorderState = useAudioRecorderState(recorder, 80);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [recording, setRecording] = useState(false);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [spaceId, setSpaceId] = useState<string | null>(null);
  const listRef = useRef<FlatList<ChatMessage>>(null);
  const sendingRef = useRef(false);
  const recordingRef = useRef(false);

  const load = useCallback(async () => {
    if (!threadId) return;
    try {
      const [thread, res] = await Promise.all([
        api.getThread(threadId),
        api.listMessages(threadId, { limit: 100 }),
      ]);
      navigation.setOptions({ title: thread.title });
      setSpaceId(thread.space_id);
      setMessages(uniqueById(res.messages));
    } finally {
      setLoading(false);
    }
  }, [api, navigation, threadId]);

  useLayoutEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!threadId) return;
    const timer = setInterval(async () => {
      if (sendingRef.current) return;
      try {
        const res = await api.listMessages(threadId, { limit: 100 });
        setMessages(uniqueById(res.messages));
      } catch {
        // ignore poll errors
      }
    }, 4000);
    return () => clearInterval(timer);
  }, [api, threadId]);

  useEffect(() => {
    recordingRef.current = recording;
  }, [recording]);

  useEffect(() => {
    return () => {
      void stopActivePlayback();
      if (!recordingRef.current) return;
      try {
        void recorder.stop().catch(() => undefined);
      } catch {
        // native recorder may already be released on unmount
      }
    };
  }, [recorder]);

  const send = async () => {
    const body = text.trim();
    if (!body || !threadId || sending || recording) return;
    setSending(true);
    sendingRef.current = true;
    setText("");
    try {
      await api.sendMessage(threadId, body);
      const res = await api.listMessages(threadId, { limit: 100 });
      setMessages(uniqueById(res.messages));
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    } catch {
      setText(body);
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  const startRecording = async () => {
    if (sending || recording || recorderState.isRecording) return;
    try {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) {
        Alert.alert("Cần quyền", "Cho phép micro để gửi giọng nói.");
        return;
      }
      await stopActivePlayback();
      setPlayingId(null);
      await prepareRecordingMode();
      await recorder.prepareToRecordAsync();
      recorder.record();
      setRecording(true);
    } catch (e) {
      setRecording(false);
      Alert.alert("Lỗi", e instanceof Error ? e.message : "Không ghi âm được.");
    }
  };

  const cancelRecording = async () => {
    try {
      if (recorder.isRecording) {
        await recorder.stop();
      }
    } catch {
      // ignore
    } finally {
      setRecording(false);
      await preparePlaybackMode();
    }
  };

  const stopAndSendVoice = async () => {
    if (!threadId || sending) return;
    setSending(true);
    sendingRef.current = true;
    try {
      await recorder.stop();
      setRecording(false);
      await preparePlaybackMode();
      const uri = recorder.uri;
      if (!uri) throw new Error("Không có file ghi âm.");

      await api.sendVoiceMessage(threadId, {
        uri,
        name: "voice.m4a",
        mimeType: "audio/mp4",
      });
      const res = await api.listMessages(threadId, { limit: 100 });
      setMessages(uniqueById(res.messages));
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    } catch (e) {
      Alert.alert("Lỗi", e instanceof Error ? e.message : "Không gửi được giọng nói.");
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  const playVoice = async (item: ChatMessage) => {
    if (!isVoiceMessage(item) || !item.has_media) return;
    try {
      if (playingId === item.id) {
        await stopActivePlayback();
        setPlayingId(null);
        return;
      }
      const uri = await fetchAuthedMediaUri(
        api.messageMediaUrl(item.id),
        `msg-${item.id}`,
        item.media_mime ?? "audio/mp4",
      );
      setPlayingId(item.id);
      await playLocalAudio(uri, () => setPlayingId(null));
    } catch (e) {
      setPlayingId(null);
      Alert.alert("Lỗi", e instanceof Error ? e.message : "Không phát được.");
    }
  };

  const saveToLibrary = (item: ChatMessage) => {
    if (!spaceId || item.sender_kind === "agent") return;
    const preview = isVoiceMessage(item)
      ? item.body.trim() || "Giọng nói"
      : item.body.slice(0, 120);
    Alert.alert("Lưu vào thư viện?", preview, [
      { text: "Huỷ", style: "cancel" },
      {
        text: "Lưu",
        onPress: async () => {
          try {
            await api.memoryFromMessage(spaceId, item.id, "Từ Phòng khách");
            Alert.alert("Đã lưu", "Tin nhắn đã vào Thư viện ký ức.");
          } catch (e) {
            Alert.alert("Lỗi", e instanceof Error ? e.message : "Không lưu được.");
          }
        },
      },
    ]);
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={88}
    >
      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        renderItem={({ item }) => {
          const mine = item.sender_user_id === user?.id;
          const isAgent = item.sender_kind === "agent";
          const isHeritage = item.sender_kind === "heritage";
          const voice = isVoiceMessage(item);
          return (
            <Pressable
              onLongPress={() => saveToLibrary(item)}
              delayLongPress={350}
              style={[styles.row, mine ? styles.rowMine : styles.rowTheirs]}
            >
              {!mine ? (
                <Text
                  style={[
                    styles.sender,
                    isAgent && styles.senderAgent,
                    isHeritage && styles.senderHeritage,
                  ]}
                >
                  {item.sender_name ?? (isAgent ? "Người giữ nhà" : "Thành viên")}
                  {item.sender_handle ? (
                    <Text style={styles.handle}> @{item.sender_handle}</Text>
                  ) : isAgent ? (
                    <Text style={styles.handle}> @giunhà</Text>
                  ) : null}
                </Text>
              ) : null}
              <View
                style={[
                  styles.bubble,
                  mine && styles.bubbleMine,
                  !mine && !isAgent && !isHeritage && styles.bubbleTheirs,
                  isAgent && styles.bubbleAgent,
                  isHeritage && styles.bubbleHeritage,
                ]}
              >
                {voice ? (
                  <Pressable
                    onPress={() => playVoice(item)}
                    style={styles.voiceRow}
                    hitSlop={8}
                  >
                    <Text style={[styles.voicePlay, mine && styles.bodyMine]}>
                      {playingId === item.id ? "Dừng" : "Phát"}
                    </Text>
                    <View style={styles.voiceMeta}>
                      <Text style={[styles.body, mine && styles.bodyMine]}>
                        Giọng nói
                      </Text>
                      {item.body.trim() ? (
                        <Text style={[styles.caption, mine && styles.captionMine]}>
                          {item.body.trim()}
                        </Text>
                      ) : null}
                    </View>
                  </Pressable>
                ) : (
                  <Text style={[styles.body, mine && styles.bodyMine]}>{item.body}</Text>
                )}
              </View>
            </Pressable>
          );
        }}
      />
      <Text style={styles.hint}>
        {recording
          ? "Nói vào micro — nhấn Dừng & gửi khi xong"
          : "Giữ tin nhắn để lưu vào thư viện"}
      </Text>
      <View
        style={[
          styles.composer,
          { paddingBottom: Math.max(insets.bottom, 12) },
        ]}
      >
        {recording ? (
          <>
            <Pressable
              onPress={cancelRecording}
              disabled={sending}
              style={[styles.micBtn, styles.cancelBtn]}
            >
              <Text style={styles.cancelText}>Huỷ</Text>
            </Pressable>
            <View style={styles.recordingPill}>
              <RecordingLevelMeter
                active={recording}
                metering={recorderState.metering}
                durationMillis={recorderState.durationMillis}
              />
            </View>
            <Pressable
              onPress={stopAndSendVoice}
              disabled={sending}
              style={[styles.send, sending && { opacity: 0.5 }]}
            >
              <Text style={styles.sendText}>{sending ? "…" : "Dừng & gửi"}</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Pressable
              onPress={startRecording}
              disabled={sending}
              style={[styles.micBtn, sending && { opacity: 0.5 }]}
            >
              <Text style={styles.micText}>Mic</Text>
            </Pressable>
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder="Nhắn cho cả nhà…"
              placeholderTextColor={colors.inkSoft}
              style={styles.input}
              multiline
            />
            <Pressable
              onPress={send}
              disabled={sending || !text.trim()}
              style={[styles.send, (!text.trim() || sending) && { opacity: 0.5 }]}
            >
              <Text style={styles.sendText}>Gửi</Text>
            </Pressable>
          </>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bgDeep },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bg,
  },
  list: { padding: 16, paddingBottom: 8 },
  row: { marginBottom: 12, maxWidth: "85%" },
  rowMine: { alignSelf: "flex-end" },
  rowTheirs: { alignSelf: "flex-start" },
  sender: {
    fontSize: 12,
    color: colors.inkSoft,
    marginBottom: 4,
    marginLeft: 4,
  },
  handle: {
    fontSize: 12,
    color: colors.brandSoft,
    fontWeight: "500",
  },
  senderAgent: {
    color: colors.brandSoft,
    fontWeight: "600",
  },
  senderHeritage: {
    color: colors.accent,
    fontWeight: "600",
  },
  bubble: {
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  bubbleMine: { backgroundColor: colors.bubbleMine },
  bubbleTheirs: {
    backgroundColor: colors.bubbleTheirs,
    borderWidth: 1,
    borderColor: colors.line,
  },
  bubbleAgent: {
    backgroundColor: colors.bubbleAgent,
    borderWidth: 1,
    borderColor: "rgba(45, 74, 62, 0.22)",
    borderStyle: "dashed",
  },
  bubbleHeritage: {
    backgroundColor: "#f7f1e6",
    borderWidth: 1,
    borderColor: "rgba(196, 165, 116, 0.45)",
  },
  body: { fontSize: 16, lineHeight: 22, color: colors.ink },
  bodyMine: { color: "#f4efe6" },
  voiceRow: { flexDirection: "row", alignItems: "center", gap: 10, minWidth: 140 },
  voicePlay: { fontSize: 14, fontWeight: "700", color: colors.ink, minWidth: 36 },
  voiceMeta: { flexShrink: 1 },
  caption: { fontSize: 13, color: colors.inkSoft, marginTop: 2 },
  captionMine: { color: "rgba(244, 239, 230, 0.75)" },
  hint: {
    textAlign: "center",
    fontSize: 12,
    color: colors.inkSoft,
    paddingBottom: 6,
  },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    backgroundColor: colors.bg,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: "#fff",
    color: colors.ink,
    fontSize: 16,
  },
  micBtn: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: "#fff",
  },
  micText: { color: colors.brand, fontWeight: "600" },
  cancelBtn: { borderColor: "rgba(180, 80, 60, 0.35)" },
  cancelText: { color: "#a04535", fontWeight: "600" },
  recordingPill: {
    flex: 1,
    minHeight: 44,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(180, 80, 60, 0.35)",
    backgroundColor: "#fff7f5",
    justifyContent: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  send: {
    backgroundColor: colors.brand,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  sendText: { color: "#f4efe6", fontWeight: "600" },
});
