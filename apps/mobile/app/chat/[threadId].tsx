import { ChatMessage, ThreadSummary } from "@forever/api-client";
import {
  requestRecordingPermissionsAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useHeaderHeight } from "@react-navigation/elements";
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
import { useSpaceScreenOptions } from "@/lib/spaceHeader";
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

const POLL_IDLE_MS = 4000;
const POLL_WAITING_MS = 1200;
const HERITAGE_REPLY_TIMEOUT_MS = 60000;

function nextTypewriterChunk(full: string, from: number): string {
  if (from >= full.length) return "";
  const rest = full.slice(from);
  const word = rest.match(/^[^\s]+(?:\s+)?/);
  if (word?.[0]) return word[0];
  return rest.charAt(0);
}

function HeritageTypingRow({ label }: { label: string }) {
  const [dots, setDots] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setDots((d) => (d + 1) % 4), 420);
    return () => clearInterval(timer);
  }, []);
  return (
    <View style={[styles.row, styles.rowTheirs]}>
      <Text style={[styles.sender, styles.senderHeritage]}>{label}</Text>
      <View style={[styles.bubble, styles.bubbleHeritage, styles.typingBubble]}>
        <Text style={styles.typingText}>
          đang soạn{".".repeat(dots)}
        </Text>
      </View>
    </View>
  );
}

export default function ChatScreen() {
  const { threadId } = useLocalSearchParams<{ threadId: string }>();
  const { api, user } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const recorder = useAudioRecorder(VOICE_RECORDING_OPTIONS);
  const recorderState = useAudioRecorderState(recorder, 80);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [recording, setRecording] = useState(false);
  const [keyboardUp, setKeyboardUp] = useState(false);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [spaceId, setSpaceId] = useState<string | null>(null);
  const [threadMeta, setThreadMeta] = useState<ThreadSummary | null>(null);
  const listRef = useRef<FlatList<ChatMessage>>(null);
  const sendingRef = useRef(false);
  const recordingRef = useRef(false);
  const knownMessageIdsRef = useRef<Set<string>>(new Set());
  const pendingMessageRef = useRef<ChatMessage | null>(null);
  const listSeqRef = useRef(0);
  const replyDeadlineRef = useRef(0);
  const [heritageTyping, setHeritageTyping] = useState(false);
  const [typewriter, setTypewriter] = useState<{ id: string; full: string; pos: number } | null>(
    null,
  );

  const isHeritageThread = threadMeta?.kind === "heritage";
  const heritageTypingLabel =
    threadMeta?.title ?? threadMeta?.heritage?.display_name ?? "Ký ức";

  /** Replaces the list with a server snapshot, keeping the in-flight optimistic
   * message and animating a heritage reply only the first time we see it. */
  const applyMessages = useCallback(
    (incoming: ChatMessage[], options?: { animateNewHeritage?: boolean }) => {
      let next = uniqueById(incoming);
      const pending = pendingMessageRef.current;
      if (pending && !next.some((m) => m.id === pending.id)) {
        next = [...next, pending];
      }
      const known = knownMessageIdsRef.current;
      const freshHeritage = options?.animateNewHeritage
        ? [...next]
            .reverse()
            .find((m) => m.sender_kind === "heritage" && !known.has(m.id))
        : undefined;
      knownMessageIdsRef.current = new Set(next.map((m) => m.id));
      setMessages(next);
      if (freshHeritage) {
        replyDeadlineRef.current = 0;
        setHeritageTyping(false);
        if ((freshHeritage.kind ?? "text") === "text" && freshHeritage.body) {
          setTypewriter({
            id: freshHeritage.id,
            full: freshHeritage.body,
            pos: 0,
          });
        }
      }
    },
    [],
  );

  /** Returns null when a newer fetch has already been issued, so a slow response
   * can never overwrite the list with an older snapshot. */
  const fetchMessages = useCallback(async () => {
    if (!threadId) return null;
    const seq = listSeqRef.current + 1;
    listSeqRef.current = seq;
    const res = await api.listMessages(threadId, { limit: 100 });
    if (seq !== listSeqRef.current) return null;
    return res.messages;
  }, [api, threadId]);

  const load = useCallback(async () => {
    if (!threadId) return;
    try {
      const [thread, res] = await Promise.all([
        api.getThread(threadId),
        api.listMessages(threadId, { limit: 100 }),
      ]);
      setThreadMeta(thread);
      setSpaceId(thread.space_id);
      listSeqRef.current += 1;
      applyMessages(res.messages);
    } finally {
      setLoading(false);
    }
  }, [api, threadId, applyMessages]);

  const isDirectThread = threadMeta?.audience_scope === "direct";

  useSpaceScreenOptions({
    spaceId: spaceId ?? undefined,
    title: threadMeta
      ? `${threadMeta.title}${isDirectThread ? " · riêng" : ""}`
      : "Trò chuyện",
    backTitle: "Nhà",
  });

  useLayoutEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!threadId) return;
    const timer = setInterval(async () => {
      if (sendingRef.current) return;
      if (replyDeadlineRef.current && Date.now() > replyDeadlineRef.current) {
        replyDeadlineRef.current = 0;
        setHeritageTyping(false);
      }
      try {
        const list = await fetchMessages();
        if (list) applyMessages(list, { animateNewHeritage: true });
      } catch {
        // ignore poll errors
      }
    }, heritageTyping ? POLL_WAITING_MS : POLL_IDLE_MS);
    return () => clearInterval(timer);
  }, [threadId, heritageTyping, fetchMessages, applyMessages]);

  useEffect(() => {
    if (!typewriter) return;
    if (typewriter.pos >= typewriter.full.length) {
      setTypewriter(null);
      return;
    }
    const chunk = nextTypewriterChunk(typewriter.full, typewriter.pos);
    const delay = 24 + Math.min(chunk.length * 8, 48);
    const timer = setTimeout(() => {
      setTypewriter((prev) =>
        prev ? { ...prev, pos: Math.min(prev.pos + chunk.length, prev.full.length) } : null,
      );
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: false }));
    }, delay);
    return () => clearTimeout(timer);
  }, [typewriter]);

  useEffect(() => {
    recordingRef.current = recording;
  }, [recording]);

  // Opening the keyboard shortens the list without changing its content, so
  // nothing else would scroll — and the reply just read disappears behind the
  // composer.
  useEffect(() => {
    const shown = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hidden = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const subs = [
      Keyboard.addListener(shown, () => {
        setKeyboardUp(true);
        requestAnimationFrame(() =>
          listRef.current?.scrollToEnd({ animated: true }),
        );
      }),
      Keyboard.addListener(hidden, () => setKeyboardUp(false)),
    ];
    return () => subs.forEach((sub) => sub.remove());
  }, []);

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
    if (!body || !threadId || sending || recording || !user) return;
    const optimistic: ChatMessage = {
      id: `local-${Date.now()}`,
      thread_id: threadId,
      sender_user_id: user.id,
      sender_kind: "user",
      sender_name: user.name,
      sender_handle: user.handle ?? null,
      kind: "text",
      body,
      created_at: new Date().toISOString(),
    };
    setSending(true);
    sendingRef.current = true;
    setText("");
    pendingMessageRef.current = optimistic;
    setMessages((prev) => uniqueById([...prev, optimistic]));
    if (isHeritageThread) {
      setHeritageTyping(true);
      replyDeadlineRef.current = Date.now() + HERITAGE_REPLY_TIMEOUT_MS;
    }
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    try {
      await api.sendMessage(threadId, body);
      pendingMessageRef.current = null;
      const list = await fetchMessages();
      if (list) applyMessages(list, { animateNewHeritage: true });
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    } catch {
      pendingMessageRef.current = null;
      replyDeadlineRef.current = 0;
      setText(body);
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
      setHeritageTyping(false);
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

      if (isHeritageThread) {
        setHeritageTyping(true);
        replyDeadlineRef.current = Date.now() + HERITAGE_REPLY_TIMEOUT_MS;
      }

      await api.sendVoiceMessage(threadId, {
        uri,
        name: "voice.m4a",
        mimeType: "audio/mp4",
      });
      const list = await fetchMessages();
      if (list) applyMessages(list, { animateNewHeritage: true });
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    } catch (e) {
      replyDeadlineRef.current = 0;
      setHeritageTyping(false);
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

  const heritageBlocked =
    threadMeta?.kind === "heritage" &&
    threadMeta.heritage &&
    !threadMeta.heritage.chat_ready;

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={Platform.OS === "ios" ? headerHeight : 0}
    >
      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        ListFooterComponent={
          heritageTyping ? <HeritageTypingRow label={heritageTypingLabel} /> : null
        }
        renderItem={({ item }) => {
          const mine = item.sender_user_id === user?.id;
          const isAgent = item.sender_kind === "agent";
          const isHeritage = item.sender_kind === "heritage";
          const voice = isVoiceMessage(item);
          const displayBody =
            typewriter && typewriter.id === item.id
              ? typewriter.full.slice(0, typewriter.pos)
              : item.body;
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
                  <Text style={[styles.body, mine && styles.bodyMine]}>{displayBody}</Text>
                )}
              </View>
            </Pressable>
          );
        }}
      />
      <Text style={styles.hint}>
        {heritageBlocked
          ? "Cần thổi hồn trước khi trò chuyện Ký ức"
          : recording
            ? "Nói vào micro — nhấn Dừng & gửi khi xong"
            : isHeritageThread
              ? "Giữ tin nhắn để lưu · Gọi bằng giọng nếu không muốn gõ"
              : "Giữ tin nhắn để lưu vào thư viện"}
      </Text>
      {isHeritageThread && !heritageBlocked && !recording ? (
        <Pressable
          onPress={() => threadId && router.push(`/call/${threadId}`)}
          style={styles.callHint}
        >
          <Text style={styles.callHintText}>Gọi bằng giọng →</Text>
        </Pressable>
      ) : null}
      {heritageBlocked ? (
        <View
          style={[
            styles.blockedBar,
            { paddingBottom: Math.max(insets.bottom, 12) },
          ]}
        >
          <Text style={styles.blockedText}>
            Giọng {threadMeta!.heritage!.voice_ready ? "✓" : "…"} · Ký ức{" "}
            {threadMeta!.heritage!.knowledge_count}/
            {threadMeta!.heritage!.knowledge_target}
          </Text>
          <Pressable
            style={styles.blockedBtn}
            onPress={() =>
              router.push(
                `/awakening/${spaceId}?identityId=${threadMeta!.heritage!.identity_id}` as never,
              )
            }
          >
            <Text style={styles.blockedBtnText}>Mở Thổi hồn →</Text>
          </Pressable>
        </View>
      ) : (
      <View
        style={[
          styles.composer,
          // The keyboard already covers the home indicator, so reserving room
          // for it as well leaves a dead band under the input.
          { paddingBottom: keyboardUp ? 12 : Math.max(insets.bottom, 12) },
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
              <Text style={styles.sendText}>{sending ? "…" : "Gửi"}</Text>
            </Pressable>
          </>
        )}
      </View>
      )}
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
  list: { padding: 16, paddingBottom: 20 },
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
  typingBubble: {
    paddingVertical: 12,
    minWidth: 96,
  },
  typingText: {
    fontSize: 15,
    lineHeight: 20,
    color: colors.inkSoft,
    fontStyle: "italic",
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
  callHint: {
    alignSelf: "center",
    paddingBottom: 8,
  },
  callHintText: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.brand,
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
  blockedBar: {
    borderTopWidth: 1,
    borderTopColor: colors.line,
    backgroundColor: colors.card,
    paddingHorizontal: 16,
    paddingTop: 14,
    gap: 10,
  },
  blockedText: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.inkSoft,
    textAlign: "center",
  },
  blockedBtn: {
    backgroundColor: colors.brand,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
  },
  blockedBtnText: { color: "#fff", fontWeight: "700", fontSize: 15 },
});
