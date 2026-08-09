import { ChatMessage, ThreadSummary } from "@forever/api-client";
import {
  AudioRecorder,
  requestRecordingPermissionsAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  NativeScrollEvent,
  NativeSyntheticEvent,
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
import { formatMessageTime } from "@/lib/datetime";
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

/** Stable enough to skip FlatList refreshes when the poll returns the same chat. */
function messagesFingerprint(items: ChatMessage[]): string {
  return items
    .map(
      (m) =>
        `${m.id}\0${m.kind ?? ""}\0${m.body}\0${m.has_media ? 1 : 0}\0${m.sender_kind}\0${m.sender_name ?? ""}\0${m.sender_handle ?? ""}`,
    )
    .join("\n");
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
          {`đang soạn${".".repeat(dots)}${"\u00a0".repeat(3 - dots)}`}
        </Text>
      </View>
    </View>
  );
}

type MessageRowProps = {
  item: ChatMessage;
  mine: boolean;
  playing: boolean;
  displayBody: string;
  onPlay: (item: ChatMessage) => void;
  onSave: (item: ChatMessage) => void;
};

const ChatMessageRow = memo(function ChatMessageRow({
  item,
  mine,
  playing,
  displayBody,
  onPlay,
  onSave,
}: MessageRowProps) {
  const isAgent = item.sender_kind === "agent";
  const isHeritage = item.sender_kind === "heritage";
  const voice = isVoiceMessage(item);
  const transcript = voice ? item.body.trim() : displayBody;
  const when = formatMessageTime(item.created_at);
  return (
    <Pressable
      onPress={voice ? () => onPlay(item) : undefined}
      onLongPress={() => onSave(item)}
      delayLongPress={350}
      style={[styles.row, mine ? styles.rowMine : styles.rowTheirs]}
      accessibilityRole={voice ? "button" : undefined}
      accessibilityLabel={
        voice ? (playing ? "Dừng phát" : "Chạm để nghe") : undefined
      }
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
          voice && playing && styles.bubblePlaying,
        ]}
      >
        <Text style={[styles.body, mine && styles.bodyMine]}>
          {transcript || (voice ? (playing ? "Đang phát…" : "Chạm để nghe") : "")}
        </Text>
      </View>
      {when ? (
        <Text style={[styles.time, mine && styles.timeMine]}>
          {playing && voice ? "Đang phát · " : ""}
          {when}
        </Text>
      ) : null}
    </Pressable>
  );
});

/** Owns the 80ms metering subscription so the message list is not redrawn with it. */
function ActiveRecordingBar({
  recorder,
  sending,
  onCancel,
  onSend,
}: {
  recorder: AudioRecorder;
  sending: boolean;
  onCancel: () => void;
  onSend: () => void;
}) {
  const recorderState = useAudioRecorderState(recorder, 80);
  return (
    <>
      <Pressable
        onPress={onCancel}
        disabled={sending}
        style={[styles.micBtn, styles.cancelBtn]}
      >
        <Text style={styles.cancelText}>Huỷ</Text>
      </Pressable>
      <View style={styles.recordingPill}>
        <RecordingLevelMeter
          active
          metering={recorderState.metering}
          durationMillis={recorderState.durationMillis}
        />
      </View>
      <Pressable
        onPress={onSend}
        disabled={sending}
        style={[styles.send, sending && { opacity: 0.5 }]}
      >
        <Text style={styles.sendText}>{sending ? "…" : "Dừng & gửi"}</Text>
      </Pressable>
    </>
  );
}

export default function ChatScreen() {
  const { threadId } = useLocalSearchParams<{ threadId: string }>();
  const { api, user } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const recorder = useAudioRecorder(VOICE_RECORDING_OPTIONS);
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
  /**
   * Whether the list should follow new content.
   *
   * The list used to scroll to the end on every content size change. Polling
   * replaces the array every few seconds, and Android re-measures on that,
   * so reading back through the conversation kept snapping to the newest
   * message. Only follow when she is already at the bottom.
   */
  const stickToBottomRef = useRef(true);
  const lastContentHeightRef = useRef(0);
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
  const [newBelow, setNewBelow] = useState(false);

  /** Follow the conversation again, after sending or on request. */
  const jumpToLatest = useCallback((animated = true) => {
    stickToBottomRef.current = true;
    setNewBelow(false);
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated }));
  }, []);

  const onListScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
      const fromBottom =
        contentSize.height - layoutMeasurement.height - contentOffset.y;
      // A little slack so a rounding wobble does not read as "scrolled away".
      const atBottom = fromBottom <= 48;
      stickToBottomRef.current = atBottom;
      if (atBottom) setNewBelow(false);
    },
    [],
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
      // Something arrived while she was reading further up: say so rather than
      // dragging her down to it.
      if (!stickToBottomRef.current && next.some((m) => !known.has(m.id))) {
        setNewBelow(true);
      }
      knownMessageIdsRef.current = new Set(next.map((m) => m.id));
      // Polling used to feed FlatList a fresh array every few seconds even when
      // nothing changed — green voice bubbles remounted and looked like they
      // were blinking while she scrolled.
      setMessages((prev) =>
        messagesFingerprint(prev) === messagesFingerprint(next) ? prev : next,
      );
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
      if (stickToBottomRef.current) {
        requestAnimationFrame(() =>
          listRef.current?.scrollToEnd({ animated: false }),
        );
      }
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
        // Opening the keyboard means she is writing, not reading back.
        jumpToLatest();
      }),
      Keyboard.addListener(hidden, () => setKeyboardUp(false)),
    ];
    return () => subs.forEach((sub) => sub.remove());
  }, [jumpToLatest]);

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
    jumpToLatest();
    try {
      await api.sendMessage(threadId, body);
      pendingMessageRef.current = null;
      const list = await fetchMessages();
      if (list) applyMessages(list, { animateNewHeritage: true });
      jumpToLatest();
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
    if (sending || recording || recorder.isRecording) return;
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
      jumpToLatest();
    } catch (e) {
      replyDeadlineRef.current = 0;
      setHeritageTyping(false);
      Alert.alert("Lỗi", e instanceof Error ? e.message : "Không gửi được giọng nói.");
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  const saveToLibrary = useCallback(
    (item: ChatMessage) => {
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
    },
    [api, spaceId],
  );

  const playVoice = useCallback(
    async (item: ChatMessage) => {
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
    },
    [api, playingId],
  );

  const renderMessage = useCallback(
    ({ item }: { item: ChatMessage }) => {
      const displayBody =
        typewriter && typewriter.id === item.id
          ? typewriter.full.slice(0, typewriter.pos)
          : item.body;
      return (
        <ChatMessageRow
          item={item}
          mine={item.sender_user_id === user?.id}
          playing={playingId === item.id}
          displayBody={displayBody}
          onPlay={playVoice}
          onSave={saveToLibrary}
        />
      );
    },
    [playingId, playVoice, saveToLibrary, typewriter, user?.id],
  );

  const onContentSizeChange = useCallback((_w: number, h: number) => {
    const grew = h > lastContentHeightRef.current + 1;
    lastContentHeightRef.current = h;
    // Remeasure noise from cell recycle used to call scrollToEnd and fight her
    // finger. Only follow when content actually grew and she is at the bottom.
    if (grew && stickToBottomRef.current) {
      listRef.current?.scrollToEnd({ animated: false });
    }
  }, []);

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
        onScroll={onListScroll}
        scrollEventThrottle={32}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        onContentSizeChange={onContentSizeChange}
        windowSize={9}
        maxToRenderPerBatch={6}
        updateCellsBatchingPeriod={50}
        removeClippedSubviews={Platform.OS === "android"}
        ListFooterComponent={
          heritageTyping ? <HeritageTypingRow label={heritageTypingLabel} /> : null
        }
        renderItem={renderMessage}
        extraData={`${playingId ?? ""}:${typewriter?.id ?? ""}:${typewriter?.pos ?? 0}`}
      />
      {newBelow ? (
        <Pressable style={styles.newBelow} onPress={() => jumpToLatest()}>
          <Text style={styles.newBelowText}>Tin mới ↓</Text>
        </Pressable>
      ) : null}
      <Text style={styles.hint}>
        {heritageBlocked
          ? "Cần thổi hồn trước khi trò chuyện Ký ức"
          : recording
            ? "Nói vào micro — nhấn Dừng & gửi khi xong"
            : isHeritageThread
              ? "Giữ tin nhắn để lưu · Chạm tin giọng để nghe"
              : "Giữ tin nhắn để lưu vào thư viện · Chạm tin giọng để nghe"}
      </Text>
      {isHeritageThread && !heritageBlocked && !recording ? (
        <Pressable
          onPress={() => threadId && router.push(`/call/${threadId}`)}
          style={styles.callHint}
        >
          <Text style={styles.callHintText}>← Quay lại gọi bằng giọng</Text>
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
          <ActiveRecordingBar
            recorder={recorder}
            sending={sending}
            onCancel={cancelRecording}
            onSend={stopAndSendVoice}
          />
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
  bubblePlaying: {
    opacity: 0.88,
  },
  time: {
    fontSize: 11,
    lineHeight: 14,
    color: colors.inkSoft,
    marginTop: 4,
    marginLeft: 4,
  },
  timeMine: {
    alignSelf: "flex-end",
    marginLeft: 0,
    marginRight: 4,
  },
  hint: {
    textAlign: "center",
    fontSize: 12,
    color: colors.inkSoft,
    paddingBottom: 6,
  },
  newBelow: {
    alignSelf: "center",
    backgroundColor: colors.brand,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginBottom: 8,
  },
  newBelowText: { color: "#f4efe6", fontWeight: "700", fontSize: 13 },
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
