import { ChatMessage, IdentityProfile, ThreadSummary } from "@forever/api-client";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  GestureResponderEvent,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { useHeaderHeight } from "@react-navigation/elements";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { HandleSuggestBar } from "@/components/HandleSuggestBar";
import { playLocalAudio, stopActivePlayback } from "@/lib/audio";
import { useAuth } from "@/lib/auth";
import { formatMessageTime } from "@/lib/datetime";
import {
  activeHandleQuery,
  identityHandle,
  suggestHandles,
} from "@/lib/handles";
import { fetchAuthedMediaUri } from "@/lib/media";
import { useSpaceScreenOptions } from "@/lib/spaceHeader";
import { colors, createThemedStyles, useTheme } from "@/lib/theme";

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

function isImageMessage(item: ChatMessage): boolean {
  return Boolean(item.has_media && (item.media_mime || "").startsWith("image/"));
}

function ChatPhoto({ item }: { item: ChatMessage }) {
  const { api } = useAuth();
  const [uri, setUri] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    fetchAuthedMediaUri(
      api.messageMediaUrl(item.id),
      `msg-${item.id}`,
      item.media_mime,
    )
      .then((next) => {
        if (live) setUri(next);
      })
      .catch(() => {
        if (live) setUri(null);
      });
    return () => {
      live = false;
    };
  }, [api, item.id, item.media_mime]);
  if (!uri) return null;
  return <Image source={{ uri }} style={styles.chatPhoto} />;
}

/** Stable enough to skip FlatList refreshes when the poll returns the same chat. */
function messagesFingerprint(items: ChatMessage[]): string {
  return items
    .map(
      (m) =>
        `${m.id}\0${m.kind ?? ""}\0${m.body}\0${m.has_media ? 1 : 0}\0${m.sender_kind}\0${m.sender_name ?? ""}\0${m.sender_handle ?? ""}\0${citedTitles(m.meta).join(",")}`,
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

function citedTitles(meta: ChatMessage["meta"]): string[] {
  if (!meta || typeof meta !== "object") return [];
  const cited = (meta as { cited?: unknown }).cited;
  if (!Array.isArray(cited)) return [];
  const titles: string[] = [];
  for (const row of cited) {
    if (!row || typeof row !== "object") continue;
    const title = String((row as { title?: string }).title || "").trim();
    if (title) titles.push(title);
  }
  return titles;
}

type MessageRowProps = {
  item: ChatMessage;
  mine: boolean;
  playing: boolean;
  displayBody: string;
  highlighted?: boolean;
  onPlay: (item: ChatMessage) => void;
  onSave: (item: ChatMessage) => void;
  onOpenCited?: (titles: string[]) => void;
  onOpenHandle?: (handle: string) => void;
};

const LONG_PRESS_MS = 400;
const LONG_PRESS_MOVE_PX = 12;

/**
 * Long-press / tap without becoming the pan responder. Pressable around a
 * Text bubble steals the first part of a swipe, then the list catches up —
 * that is the jump when she scrolls on a message.
 */
function useRowGestures(onLongPress: () => void, onPress?: () => void) {
  const originX = useRef(0);
  const originY = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const movedRef = useRef(false);
  const firedRef = useRef(false);

  const clearTimer = useCallback(() => {
    if (!timerRef.current) return;
    clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  useEffect(() => clearTimer, [clearTimer]);

  const onTouchStart = useCallback(
    (e: GestureResponderEvent) => {
      movedRef.current = false;
      firedRef.current = false;
      originX.current = e.nativeEvent.pageX;
      originY.current = e.nativeEvent.pageY;
      clearTimer();
      timerRef.current = setTimeout(() => {
        firedRef.current = true;
        onLongPress();
      }, LONG_PRESS_MS);
    },
    [clearTimer, onLongPress],
  );

  const onTouchMove = useCallback(
    (e: GestureResponderEvent) => {
      if (
        Math.abs(e.nativeEvent.pageX - originX.current) > LONG_PRESS_MOVE_PX ||
        Math.abs(e.nativeEvent.pageY - originY.current) > LONG_PRESS_MOVE_PX
      ) {
        movedRef.current = true;
        clearTimer();
      }
    },
    [clearTimer],
  );

  const onTouchEnd = useCallback(() => {
    clearTimer();
    if (!movedRef.current && !firedRef.current) onPress?.();
  }, [clearTimer, onPress]);

  return { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel: clearTimer };
}

const ChatMessageRow = memo(function ChatMessageRow({
  item,
  mine,
  playing,
  displayBody,
  highlighted,
  onPlay,
  onSave,
  onOpenCited,
  onOpenHandle,
}: MessageRowProps) {
  useTheme();
  const isAgent = item.sender_kind === "agent";
  const isHeritage = item.sender_kind === "heritage";
  const voice = isVoiceMessage(item);
  const transcript = voice ? item.body.trim() : displayBody;
  const when = formatMessageTime(item.created_at);
  const sources = isHeritage ? citedTitles(item.meta) : [];
  const onLongPress = useCallback(() => onSave(item), [item, onSave]);
  const onPress = useCallback(() => {
    if (voice) onPlay(item);
  }, [item, onPlay, voice]);
  const gestures = useRowGestures(onLongPress, voice ? onPress : undefined);
  return (
    <View
      {...gestures}
      style={[
        styles.row,
        mine ? styles.rowMine : styles.rowTheirs,
        highlighted && styles.rowHighlight,
      ]}
      accessibilityRole={voice ? "button" : undefined}
      accessibilityLabel={
        voice ? (playing ? "Dừng phát" : "Chạm để nghe") : undefined
      }
    >
      {!mine ? (
        <Text
          selectable={false}
          style={[
            styles.sender,
            isAgent && styles.senderAgent,
            isHeritage && styles.senderHeritage,
          ]}
        >
          {item.sender_name ?? (isAgent ? "Người giữ nhà" : "Thành viên")}
          {item.sender_handle ? (
            <Text
              selectable={false}
              style={styles.handle}
              onPress={
                onOpenHandle && !isAgent
                  ? () => onOpenHandle(item.sender_handle!)
                  : undefined
              }
            >
              {" "}
              @{item.sender_handle}
            </Text>
          ) : isAgent ? (
            <Text selectable={false} style={styles.handle}>
              {" "}
              @giunhà
            </Text>
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
        pointerEvents="none"
      >
        {isImageMessage(item) ? <ChatPhoto item={item} /> : null}
        <Text
          selectable={false}
          pointerEvents="none"
          style={[styles.body, mine && styles.bodyMine]}
        >
          {transcript || (voice ? (playing ? "Đang phát…" : "Chạm để nghe") : "")}
        </Text>
      </View>
      {isHeritage && sources.length > 0 ? (
        <Pressable
          onPress={() => onOpenCited?.(sources)}
          hitSlop={8}
          style={styles.citeChip}
        >
          <Text style={styles.citeChipText}>Theo Thư viện</Text>
        </Pressable>
      ) : null}
      {when ? (
        <Text
          selectable={false}
          pointerEvents="none"
          style={[styles.time, mine && styles.timeMine]}
        >
          {playing && voice ? "Đang phát · " : ""}
          {when}
        </Text>
      ) : null}
    </View>
  );
});

export default function ChatScreen() {
  const { threadId, messageId: focusMessageId } = useLocalSearchParams<{
    threadId: string;
    messageId?: string;
  }>();
  const { api, user } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [keyboardUp, setKeyboardUp] = useState(false);
  /**
   * How far to lift the screen for the keyboard on Android.
   *
   * Edge-to-edge (SDK 53+) means `adjustResize` no longer shrinks the React
   * root, so KeyboardAvoidingView has nothing to work with. Pad by the height
   * the system reports. Do not remeasure the padded view and "subtract what
   * the window gave back" — that subtraction was our own padding, so the inset
   * fell to 0 and the keyboard covered the composer again.
   */
  const [keyboardInset, setKeyboardInset] = useState(0);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [spaceId, setSpaceId] = useState<string | null>(null);
  const [threadMeta, setThreadMeta] = useState<ThreadSummary | null>(null);
  const [identities, setIdentities] = useState<IdentityProfile[]>([]);
  const [highlightId, setHighlightId] = useState<string | null>(
    typeof focusMessageId === "string" ? focusMessageId : null,
  );
  const focusedOnceRef = useRef(false);
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
  /**
   * Until this moment, keep pinning the list to the newest message. Cells are
   * measured over several frames, so a single scrollToEnd on load lands
   * wherever the list happened to be — she opened the room high up and had to
   * drag a long way down to reach today.
   */
  const settleUntilRef = useRef(0);
  /** Finger or fling in progress — never call scrollToEnd over that. */
  const scrollingRef = useRef(false);
  const sendingRef = useRef(false);
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

  const noteScrollPosition = useCallback(
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

  const onListScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      noteScrollPosition(e);
    },
    [noteScrollPosition],
  );

  const onScrollBeginDrag = useCallback(() => {
    scrollingRef.current = true;
    // Her finger outranks the opening scroll.
    settleUntilRef.current = 0;
    // The first pixels of a swipe used to still count as "at the bottom",
    // so onContentSizeChange yanked the list back to the newest message.
    stickToBottomRef.current = false;
  }, []);

  const onScrollEndDrag = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      noteScrollPosition(e);
      if (e.nativeEvent.velocity && Math.abs(e.nativeEvent.velocity.y) > 0.05) {
        return;
      }
      scrollingRef.current = false;
    },
    [noteScrollPosition],
  );

  const onMomentumScrollBegin = useCallback(() => {
    scrollingRef.current = true;
  }, []);

  const onMomentumScrollEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      scrollingRef.current = false;
      noteScrollPosition(e);
    },
    [noteScrollPosition],
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
      settleUntilRef.current = Date.now() + 1500;
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
    if (!spaceId) return;
    void api
      .listIdentities(spaceId)
      .then((res) => setIdentities(res.identities))
      .catch(() => setIdentities([]));
  }, [api, spaceId]);

  const handleQuery = useMemo(() => activeHandleQuery(text), [text]);
  const handleSuggestions = useMemo(
    () =>
      handleQuery == null
        ? []
        : suggestHandles(identities, handleQuery, user?.id),
    [handleQuery, identities, user?.id],
  );

  const openHandle = useCallback(
    async (handle: string) => {
      if (!spaceId) return;
      try {
        const resolved = await api.resolveHandle(spaceId, handle);
        router.push(resolved.library_path as never);
      } catch {
        Alert.alert("Không tìm thấy", `Không có @${handle.replace(/^@/, "")} trong nhà này.`);
      }
    },
    [api, router, spaceId],
  );

  const pickHandleSuggestion = useCallback((ident: IdentityProfile) => {
    const handle = identityHandle(ident);
    if (!handle) return;
    setText((prev) => {
      const replaced = prev.replace(/@([a-z0-9_]*)$/i, `@${handle} `);
      return replaced === prev ? `${prev}@${handle} ` : replaced;
    });
  }, []);

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
      if (stickToBottomRef.current && !scrollingRef.current) {
        requestAnimationFrame(() =>
          listRef.current?.scrollToEnd({ animated: false }),
        );
      }
    }, delay);
    return () => clearTimeout(timer);
  }, [typewriter]);

  // Opening the keyboard shortens the list without changing its content, so
  // nothing else would scroll — and the reply just read disappears behind the
  // composer.
  useEffect(() => {
    const shown = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hidden = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const subs = [
      Keyboard.addListener(shown, (e) => {
        setKeyboardUp(true);
        if (Platform.OS === "android") {
          setKeyboardInset(Math.max(0, e.endCoordinates?.height ?? 0));
        }
        // Opening the keyboard means she is writing, not reading back.
        jumpToLatest();
      }),
      Keyboard.addListener(hidden, () => {
        setKeyboardUp(false);
        setKeyboardInset(0);
      }),
    ];
    return () => subs.forEach((sub) => sub.remove());
  }, [jumpToLatest]);

  useEffect(() => {
    return () => {
      void stopActivePlayback();
    };
  }, []);

  const send = async () => {
    const body = text.trim();
    if (!body || !threadId || sending || !user) return;
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

  const openCited = useCallback(
    (titles: string[]) => {
      Alert.alert(
        "Theo Thư viện",
        titles.slice(0, 6).join("\n"),
        [
          { text: "Đóng", style: "cancel" },
          ...(spaceId
            ? [
                {
                  text: "Mở Thư viện",
                  onPress: () => router.push(`/library/${spaceId}` as never),
                },
              ]
            : []),
        ],
      );
    },
    [router, spaceId],
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
          highlighted={highlightId === item.id}
          onPlay={playVoice}
          onSave={saveToLibrary}
          onOpenCited={openCited}
          onOpenHandle={openHandle}
        />
      );
    },
    [
      highlightId,
      openCited,
      openHandle,
      playingId,
      playVoice,
      saveToLibrary,
      typewriter,
      user?.id,
    ],
  );

  useEffect(() => {
    if (!highlightId || loading || focusedOnceRef.current || !messages.length) {
      return;
    }
    const index = messages.findIndex((m) => m.id === highlightId);
    if (index < 0) return;
    focusedOnceRef.current = true;
    stickToBottomRef.current = false;
    // Arriving from the library at one message beats opening at today.
    settleUntilRef.current = 0;
    const t = setTimeout(() => {
      listRef.current?.scrollToIndex({
        index,
        animated: true,
        viewPosition: 0.35,
      });
    }, 120);
    const clear = setTimeout(() => setHighlightId(null), 4000);
    return () => {
      clearTimeout(t);
      clearTimeout(clear);
    };
  }, [highlightId, loading, messages]);

  const onContentSizeChange = useCallback((_w: number, h: number) => {
    const grew = h > lastContentHeightRef.current + 1;
    lastContentHeightRef.current = h;
    // Opening the room: follow every remeasure to the bottom, even the ones
    // that arrive while the list settles.
    if (Date.now() < settleUntilRef.current && !focusedOnceRef.current) {
      listRef.current?.scrollToEnd({ animated: false });
      return;
    }
    // Remeasure noise from cell recycle used to call scrollToEnd and fight her
    // finger. Only follow when content actually grew, she is at the bottom,
    // and she is not currently scrolling.
    if (
      grew &&
      stickToBottomRef.current &&
      !scrollingRef.current &&
      !focusedOnceRef.current
    ) {
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

  const screen = (
    <>
      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        onScroll={onListScroll}
        onScrollBeginDrag={onScrollBeginDrag}
        onScrollEndDrag={onScrollEndDrag}
        onMomentumScrollBegin={onMomentumScrollBegin}
        onMomentumScrollEnd={onMomentumScrollEnd}
        scrollEventThrottle={16}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        onContentSizeChange={onContentSizeChange}
        onLayout={() => {
          if (Date.now() < settleUntilRef.current && !focusedOnceRef.current) {
            listRef.current?.scrollToEnd({ animated: false });
          }
        }}
        // Variable-height bubbles + a tiny window recycles cells and the
        // list jumps because estimated heights are wrong. Cap is 100
        // messages; keep a wide window so recycle almost never happens
        // while she is reading.
        initialNumToRender={24}
        windowSize={21}
        maxToRenderPerBatch={12}
        updateCellsBatchingPeriod={50}
        removeClippedSubviews={false}
        ListFooterComponent={
          heritageTyping ? <HeritageTypingRow label={heritageTypingLabel} /> : null
        }
        renderItem={renderMessage}
        extraData={`${playingId ?? ""}:${typewriter?.id ?? ""}:${typewriter?.pos ?? 0}:${highlightId ?? ""}`}
        onScrollToIndexFailed={(info) => {
          setTimeout(() => {
            listRef.current?.scrollToIndex({
              index: info.index,
              animated: true,
              viewPosition: 0.35,
            });
          }, 250);
        }}
      />
      {newBelow ? (
        <Pressable style={styles.newBelow} onPress={() => jumpToLatest()}>
          <Text style={styles.newBelowText}>Tin mới ↓</Text>
        </Pressable>
      ) : null}
      <Text style={styles.hint}>
        {heritageBlocked
          ? "Cần thổi hồn trước khi trò chuyện Ký ức"
          : isHeritageThread
            ? "Giữ tin nhắn để lưu · Chạm tin giọng để nghe"
            : "Giữ tin nhắn để lưu vào thư viện · Chạm tin giọng để nghe"}
      </Text>
      {isHeritageThread && !heritageBlocked ? (
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
        <>
          <HandleSuggestBar
            suggestions={handleSuggestions}
            userId={user?.id}
            onPick={pickHandleSuggestion}
          />
          <View
            style={[
              styles.composer,
              // The keyboard already covers the home indicator, so reserving room
              // for it as well leaves a dead band under the input.
              { paddingBottom: keyboardUp ? 12 : Math.max(insets.bottom, 12) },
            ]}
          >
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder="Nhắn cho cả nhà… (@tên để gắn)"
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
          </View>
        </>
      )}
    </>
  );

  // Android: plain View + bottom padding. KeyboardAvoidingView is a no-op when
  // the window does not resize, and measuring a padded root wiped the pad.
  if (Platform.OS === "android") {
    return (
      <View style={[styles.root, { paddingBottom: keyboardInset }]}>
        {screen}
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior="padding"
      keyboardVerticalOffset={headerHeight}
    >
      {screen}
    </KeyboardAvoidingView>
  );
}

const styles = createThemedStyles((colors) => ({
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
  rowHighlight: {
    backgroundColor: "rgba(139, 105, 20, 0.12)",
    borderRadius: 14,
    marginHorizontal: -4,
    paddingHorizontal: 4,
  },
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
  citeChip: {
    alignSelf: "flex-start",
    marginTop: 6,
    marginLeft: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: "rgba(196, 165, 116, 0.22)",
  },
  citeChipText: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.accent,
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
  chatPhoto: {
    width: "100%",
    height: 200,
    borderRadius: 10,
    marginBottom: 8,
    backgroundColor: colors.line,
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
    ...(Platform.OS === "android"
      ? { elevation: 16, zIndex: 20 }
      : null),
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
}));
