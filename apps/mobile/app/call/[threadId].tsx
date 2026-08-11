import {
  ChatMessage,
  ThreadSummary,
  VoiceProfile,
  voiceProviderLabel,
  voiceTtsModelLabel,
} from "@forever/api-client";
import {
  requestRecordingPermissionsAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import { useFocusEffect } from "@react-navigation/native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  playLocalAudio,
  preparePlaybackMode,
  prepareRecordingMode,
  stopActivePlayback,
} from "@/lib/audio";
import { useAuth } from "@/lib/auth";
import {
  sentenceIndexForProgress,
  splitIntoSentences,
} from "@/lib/callFollowAlong";
import { formatMessageTime } from "@/lib/datetime";
import { fetchAuthedMediaUri } from "@/lib/media";
import {
  HOLD_TO_TALK_MAX_MS,
  HOLD_TO_TALK_MIN_MS,
  emptySpeechGate,
  gateHeardSpeech,
  noteSpeechMetering,
} from "@/lib/holdToTalk";
import { HoldToTalkTarget } from "@/lib/holdToTalkTarget";
import { RecordingLevelMeter } from "@/lib/recordingMeter";
import { VOICE_RECORDING_OPTIONS } from "@/lib/recordingOptions";
import { useSpaceScreenOptions } from "@/lib/spaceHeader";
import { colors, fonts } from "@/lib/theme";

type CallPhase =
  | "idle"
  | "listening"
  | "sending"
  | "thinking"
  | "loading"
  | "speaking"
  | "error";

type CallTurn = {
  userMessageId: string;
  userText: string;
  userAt: string;
  replyId: string;
  replyText: string;
  replyAt: string;
  hasMedia: boolean;
};

const POLL_MS = 1200;
const REPLY_TIMEOUT_MS = 90_000;
const RECENT_TURN_LIMIT = 10;

function isHeritageReply(m: ChatMessage): boolean {
  return m.sender_kind === "heritage";
}

function isUserMessage(m: ChatMessage): boolean {
  return m.sender_kind === "user" || (!!m.sender_user_id && m.sender_kind !== "heritage");
}

function shortCloneId(id: string | null | undefined): string {
  const s = (id || "").trim();
  if (!s) return "chưa chọn clone";
  if (s.length <= 14) return s;
  return `${s.slice(0, 6)}…${s.slice(-4)}`;
}

function voiceSetSummary(voice: VoiceProfile | null): string {
  if (!voice) return "Chưa có Voice DNA cho phòng này";
  const prefs = voice.tts_prefs;
  const provider = prefs?.provider || voice.provider || "elevenlabs";
  const cloneName =
    (prefs?.provider_voice_name || "").trim() ||
    shortCloneId(prefs?.provider_voice_id || voice.provider_voice_id);
  const model = prefs?.model_id
    ? voiceTtsModelLabel(prefs.model_id)
    : "mặc định";
  const speed =
    typeof prefs?.speed === "number" ? ` · tốc độ ${prefs.speed}` : "";
  return `${voiceProviderLabel(provider)} · ${cloneName} · ${model}${speed}`;
}

function buildTurns(messages: ChatMessage[], limit = RECENT_TURN_LIMIT): CallTurn[] {
  const turns: CallTurn[] = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (!isHeritageReply(m)) continue;
    let userMessageId = "";
    let userText = "";
    let userAt = "";
    for (let j = i - 1; j >= 0; j--) {
      if (isUserMessage(messages[j])) {
        userMessageId = messages[j].id;
        userText = (messages[j].body || "").trim();
        userAt = messages[j].created_at || "";
        break;
      }
    }
    turns.push({
      userMessageId,
      userText,
      userAt,
      replyId: m.id,
      replyText: (m.body || "").trim(),
      replyAt: m.created_at || "",
      hasMedia: Boolean(m.has_media),
    });
  }
  return turns.slice(-limit);
}

function FollowAlongBody({
  text,
  activeIndex,
  playing,
  onBodyY,
  onSentenceY,
}: {
  text: string;
  activeIndex: number | null;
  playing: boolean;
  onBodyY: (yInBubble: number) => void;
  /** Y of each sentence relative to the sentences body. */
  onSentenceY: (index: number, yInBody: number) => void;
}) {
  const sentences = useMemo(() => splitIntoSentences(text), [text]);

  if (!playing || activeIndex == null) {
    return (
      <Text style={[styles.bubbleText, { color: colors.ink }]}>{text}</Text>
    );
  }

  if (sentences.length <= 1) {
    return (
      <Text
        style={[styles.sentence, styles.sentenceActive]}
        onLayout={(e) => onBodyY(e.nativeEvent.layout.y)}
      >
        {text}
      </Text>
    );
  }

  return (
    <View onLayout={(e) => onBodyY(e.nativeEvent.layout.y)}>
      {sentences.map((sentence, index) => {
        const active = index === activeIndex;
        const past = index < activeIndex;
        return (
          <Text
            key={`${index}-${sentence.slice(0, 12)}`}
            onLayout={(e: LayoutChangeEvent) => {
              onSentenceY(index, e.nativeEvent.layout.y);
            }}
            style={[
              styles.sentence,
              past && styles.sentencePast,
              active && styles.sentenceActive,
            ]}
          >
            {sentence}
          </Text>
        );
      })}
    </View>
  );
}

export default function CallScreen() {
  const { threadId } = useLocalSearchParams<{ threadId: string }>();
  const { api, user } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const recorder = useAudioRecorder(VOICE_RECORDING_OPTIONS);
  const recorderState = useAudioRecorderState(recorder, 80);

  const [threadMeta, setThreadMeta] = useState<ThreadSummary | null>(null);
  const [voice, setVoice] = useState<VoiceProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [phase, setPhase] = useState<CallPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [turns, setTurns] = useState<CallTurn[]>([]);
  const [voiceStripOpen, setVoiceStripOpen] = useState(false);
  const [pendingUserText, setPendingUserText] = useState("");
  const [playingReplyId, setPlayingReplyId] = useState<string | null>(null);
  const [activeSentence, setActiveSentence] = useState<number | null>(null);

  const awaitingAfterIdRef = useRef<string | null>(null);
  const replyDeadlineRef = useRef(0);
  const mediaCacheRef = useRef<Map<string, string>>(new Map());
  const playLockRef = useRef(false);
  /** Remaining father clips to play after the one currently speaking. */
  const replayQueueRef = useRef<CallTurn[]>([]);
  const phaseRef = useRef<CallPhase>("idle");
  const holdGenRef = useRef(0);
  const holdingRef = useRef(false);
  const recordStartedAtRef = useRef(0);
  const cancelArmedRef = useRef(false);
  const finishingHoldRef = useRef(false);
  const speechGateRef = useRef(emptySpeechGate());
  const [cancelArmed, setCancelArmed] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  /** Content Y of each turn block inside the ScrollView. */
  const turnOffsetsRef = useRef<Map<string, number>>(new Map());
  const turnHeightsRef = useRef<Map<string, number>>(new Map());
  const stickTranscriptRef = useRef(true);
  const [scrollY, setScrollY] = useState(0);
  const [viewportH, setViewportH] = useState(0);
  const [layoutTick, setLayoutTick] = useState(0);
  /** Frozen list while a replay is running so follow-along scroll does not shrink the count. */
  const [replaySession, setReplaySession] = useState<CallTurn[] | null>(null);
  /** Heritage bubble Y relative to its turn block. */
  const bubbleOffsetsRef = useRef<Map<string, number>>(new Map());
  /** Follow-along body Y relative to the heritage bubble. */
  const bodyOffsetsRef = useRef<Map<string, number>>(new Map());
  /** Sentence Y relative to the follow-along body. */
  const sentenceOffsetsRef = useRef<Map<string, number>>(new Map());
  phaseRef.current = phase;

  const displayName =
    threadMeta?.heritage?.display_name || threadMeta?.title || "Bố";
  const relation =
    threadMeta?.heritage?.relation_label ||
    (displayName.startsWith("Bố") ? "Bố" : "Người thân");
  const spaceId = threadMeta?.space_id;
  const identityId = threadMeta?.heritage?.identity_id;

  const latestTurn = turns.length ? turns[turns.length - 1] : null;
  /** Father clips from the oldest turn still on screen down to the latest. */
  const replayClips = useMemo(() => {
    const withVoice = (list: CallTurn[]) =>
      list.filter((turn) => turn.hasMedia && turn.replyId);
    if (!turns.length) return [];
    if (viewportH <= 0) return withVoice(turns.slice(-1));
    const viewTop = scrollY + 8;
    const firstVisible = turns.findIndex((turn) => {
      const y = turnOffsetsRef.current.get(turn.replyId);
      const h = turnHeightsRef.current.get(turn.replyId);
      if (y == null || h == null) return false;
      return y + h > viewTop;
    });
    const start = firstVisible >= 0 ? firstVisible : Math.max(0, turns.length - 1);
    return withVoice(turns.slice(start));
  }, [turns, scrollY, viewportH, layoutTick]);
  const replayPlaylist = replaySession ?? replayClips;
  const replayCount = replayPlaylist.length;
  const replayIndex = replayPlaylist.findIndex(
    (turn) => turn.replyId === playingReplyId,
  );

  useSpaceScreenOptions({
    spaceId,
    title: "Gọi",
    backTitle: "Nhà",
  });

  const loadVoice = useCallback(
    async (space: string, identity: string) => {
      try {
        const res = await api.listVoices(space);
        const match =
          res.voices.find(
            (v) =>
              v.identity_profile_id === identity &&
              (v.subject_kind === "heritage" || v.status === "ready"),
          ) ||
          res.voices.find((v) => v.identity_profile_id === identity) ||
          null;
        setVoice(match);
      } catch {
        setVoice(null);
      }
    },
    [api],
  );

  const refreshTurns = useCallback(async () => {
    if (!threadId) return [];
    const res = await api.listMessages(threadId, { limit: 40 });
    const next = buildTurns(res.messages);
    setTurns(next);
    return next;
  }, [api, threadId]);

  const load = useCallback(async () => {
    if (!threadId) return;
    try {
      const thread = await api.getThread(threadId);
      setThreadMeta(thread);
      await refreshTurns();
      if (thread.space_id && thread.heritage?.identity_id) {
        await loadVoice(thread.space_id, thread.heritage.identity_id);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không mở được cuộc gọi.");
      setPhase("error");
    } finally {
      setLoading(false);
    }
  }, [api, threadId, loadVoice, refreshTurns]);

  useEffect(() => {
    void load();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      if (spaceId && identityId) void loadVoice(spaceId, identityId);
    }, [spaceId, identityId, loadVoice]),
  );

  const scrollToSentence = useCallback(
    (replyId: string, sentenceIndex: number) => {
      const turnY = turnOffsetsRef.current.get(replyId) ?? 0;
      const bubbleY = bubbleOffsetsRef.current.get(replyId) ?? 0;
      const bodyY = bodyOffsetsRef.current.get(replyId) ?? 0;
      const sentenceY =
        sentenceOffsetsRef.current.get(`${replyId}:${sentenceIndex}`) ?? 0;
      const y = Math.max(0, turnY + bubbleY + bodyY + sentenceY - 24);
      scrollRef.current?.scrollTo({ y, animated: true });
    },
    [],
  );

  const finishPlayback = useCallback(() => {
    replayQueueRef.current = [];
    playLockRef.current = false;
    setReplaySession(null);
    setPlayingReplyId(null);
    setActiveSentence(null);
    setPhase("idle");
  }, []);

  // Keep the spoken sentence in view while audio plays.
  useEffect(() => {
    if (phase !== "speaking" || !playingReplyId || activeSentence == null) {
      return;
    }
    scrollToSentence(playingReplyId, activeSentence);
  }, [phase, playingReplyId, activeSentence, scrollToSentence]);

  const playReply = useCallback(
    async (
      messageId: string,
      replyText: string,
      opts?: { auto?: boolean; fromQueue?: boolean; queue?: CallTurn[] },
    ): Promise<boolean> => {
      if (!messageId || playLockRef.current) return false;
      if (phaseRef.current === "listening") return false;
      // The reply to the turn she just spoke arrives while the phase is still
      // "thinking", so only a manual tap waits for the turn to settle.
      if (!opts?.auto && phaseRef.current === "thinking") return false;
      if (!opts?.fromQueue) {
        replayQueueRef.current = opts?.queue ? [...opts.queue] : [];
      }

      playLockRef.current = true;
      setError(null);
      setPlayingReplyId(messageId);
      setActiveSentence(0);
      setPhase("loading");

      const playNextOrFinish = () => {
        const next = replayQueueRef.current.shift();
        if (!next) {
          finishPlayback();
          return;
        }
        playLockRef.current = false;
        void playReply(next.replyId, next.replyText, {
          auto: true,
          fromQueue: true,
        });
      };

      try {
        let uri = mediaCacheRef.current.get(messageId);
        if (!uri) {
          uri = await fetchAuthedMediaUri(
            api.messageMediaUrl(messageId),
            `call-${messageId}`,
          );
          mediaCacheRef.current.set(messageId, uri);
        }

        const sentences = splitIntoSentences(replyText);
        await preparePlaybackMode();
        setPhase("speaking");

        // Bring the reply into view before audio starts.
        requestAnimationFrame(() => scrollToSentence(messageId, 0));

        await playLocalAudio(uri, {
          updateInterval: 180,
          onProgress: ({ currentTime, duration }) => {
            if (duration <= 0) return;
            const idx = sentenceIndexForProgress(
              currentTime,
              duration,
              sentences,
            );
            setActiveSentence((prev) => {
              if (prev === idx) return prev;
              return idx;
            });
          },
          onFinish: playNextOrFinish,
        });
        return true;
      } catch (e) {
        playLockRef.current = false;
        if (replayQueueRef.current.length) {
          playNextOrFinish();
          return false;
        }
        setPlayingReplyId(null);
        setActiveSentence(null);
        setError(
          e instanceof Error
            ? e.message
            : opts?.auto
              ? "Không phát được giọng."
              : "Không tải được giọng. Thử lại nhé.",
        );
        setPhase("idle");
        return false;
      }
    },
    [api, finishPlayback, scrollToSentence],
  );

  useEffect(() => {
    if (!threadId || phase !== "thinking") return;
    const timer = setInterval(async () => {
      if (!awaitingAfterIdRef.current) return;
      if (replyDeadlineRef.current && Date.now() > replyDeadlineRef.current) {
        awaitingAfterIdRef.current = null;
        replyDeadlineRef.current = 0;
        setPendingUserText("");
        setError("Bố chưa trả lời kịp. Con thử nói lại nhé.");
        setPhase("idle");
        return;
      }
      try {
        const res = await api.listMessages(threadId, { limit: 40 });
        const afterId = awaitingAfterIdRef.current;
        const messages = res.messages;
        let seenUser = false;
        for (const m of messages) {
          if (m.id === afterId) {
            seenUser = true;
            if ((m.body || "").trim()) setPendingUserText(m.body.trim());
            continue;
          }
          if (!seenUser) continue;
          if (!isHeritageReply(m)) continue;
          awaitingAfterIdRef.current = null;
          replyDeadlineRef.current = 0;
          setPendingUserText("");
          const nextTurns = buildTurns(messages);
          setTurns(nextTurns);
          if (m.has_media) {
            const started = await playReply(m.id, (m.body || "").trim(), {
              auto: true,
            });
            // Never strand the screen on «đang nghĩ» when the reply is here.
            if (!started) setPhase("idle");
          } else {
            setPhase("idle");
          }
          return;
        }
      } catch {
        // keep polling
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [api, threadId, phase, playReply]);

  useEffect(() => {
    return () => {
      void stopActivePlayback();
      try {
        if (recorder.isRecording) void recorder.stop();
      } catch {
        // ignore
      }
    };
  }, [recorder]);

  const abortListening = useCallback(async () => {
    try {
      if (recorder.isRecording) await recorder.stop();
    } catch {
      // ignore
    }
    recordStartedAtRef.current = 0;
    cancelArmedRef.current = false;
    setCancelArmed(false);
    await preparePlaybackMode();
    if (phaseRef.current === "listening") {
      phaseRef.current = "idle";
      setPhase("idle");
    }
  }, [recorder]);

  const startListening = async (gen: number) => {
    const canStart =
      phaseRef.current === "idle" || phaseRef.current === "error";
    if (!canStart || recorder.isRecording) return;
    setError(null);
    try {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) {
        holdingRef.current = false;
        setError("Cho phép micro để nói với Bố.");
        setPhase("error");
        return;
      }
      if (!holdingRef.current || holdGenRef.current !== gen) return;
      await stopActivePlayback();
      replayQueueRef.current = [];
      playLockRef.current = false;
      setReplaySession(null);
      setPlayingReplyId(null);
      setActiveSentence(null);
      await prepareRecordingMode();
      // iOS needs a beat after flipping the audio session before record.
      await new Promise((r) => setTimeout(r, 200));
      if (!holdingRef.current || holdGenRef.current !== gen) {
        await preparePlaybackMode();
        return;
      }
      await recorder.prepareToRecordAsync();
      recorder.record();
      if (!holdingRef.current || holdGenRef.current !== gen) {
        await abortListening();
        return;
      }
      recordStartedAtRef.current = Date.now();
      speechGateRef.current = emptySpeechGate();
      phaseRef.current = "listening";
      setPhase("listening");
    } catch (e) {
      holdingRef.current = false;
      setError(e instanceof Error ? e.message : "Không ghi âm được.");
      setPhase("error");
    }
  };

  const stopAndSend = async () => {
    if (phaseRef.current !== "listening" || !threadId) return;
    if (!user) {
      await abortListening();
      setError("Chưa đăng nhập. Mở lại app rồi thử nói lại.");
      setPhase("error");
      return;
    }
    try {
      await recorder.stop();
      recordStartedAtRef.current = 0;
      cancelArmedRef.current = false;
      setCancelArmed(false);
      await preparePlaybackMode();
      const uri = recorder.uri;
      if (!uri) throw new Error("Không có file ghi âm.");

      // Upload first — do not poll for a reply until the voice POST finishes.
      phaseRef.current = "sending";
      setPhase("sending");
      setPendingUserText("…");
      const sent = await api.sendVoiceMessage(threadId, {
        uri,
        name: "voice.m4a",
        mimeType: "audio/mp4",
      });
      awaitingAfterIdRef.current = sent.id;
      replyDeadlineRef.current = Date.now() + REPLY_TIMEOUT_MS;
      if ((sent.body || "").trim()) setPendingUserText(sent.body.trim());
      setPhase("thinking");
    } catch (e) {
      awaitingAfterIdRef.current = null;
      setPendingUserText("");
      setError(e instanceof Error ? e.message : "Không gửi được giọng nói.");
      setPhase("error");
    }
  };

  const finishHold = async () => {
    if (finishingHoldRef.current) return;
    finishingHoldRef.current = true;
    holdingRef.current = false;
    try {
      if (phaseRef.current !== "listening") {
        holdGenRef.current += 1;
        if (recorder.isRecording) await abortListening();
        return;
      }
      if (
        cancelArmedRef.current ||
        Date.now() - recordStartedAtRef.current < HOLD_TO_TALK_MIN_MS
      ) {
        await abortListening();
        return;
      }
      if (!gateHeardSpeech(speechGateRef.current)) {
        await abortListening();
        setError("Không nghe thấy câu nói. Giữ nút và nói rồi thả tay.");
        setPhase("idle");
        return;
      }
      await stopAndSend();
    } finally {
      cancelArmedRef.current = false;
      setCancelArmed(false);
      finishingHoldRef.current = false;
    }
  };

  const onHoldStart = () => {
    if (phaseRef.current !== "idle" && phaseRef.current !== "error") return;
    if (holdingRef.current) return;
    holdingRef.current = true;
    cancelArmedRef.current = false;
    setCancelArmed(false);
    finishingHoldRef.current = false;
    const gen = ++holdGenRef.current;
    void startListening(gen);
  };

  const onHoldCancelArmed = (armed: boolean) => {
    if (armed === cancelArmedRef.current) return;
    cancelArmedRef.current = armed;
    setCancelArmed(armed);
  };

  const onHoldEnd = (cancelled: boolean) => {
    if (!holdingRef.current) return;
    if (cancelled) cancelArmedRef.current = true;
    void finishHold();
  };

  useEffect(() => {
    if (phase !== "listening") return;
    noteSpeechMetering(speechGateRef.current, recorderState.metering);
  }, [phase, recorderState.metering]);

  useEffect(() => {
    if (phase !== "listening") return;
    const timer = setTimeout(() => {
      if (phaseRef.current !== "listening") return;
      cancelArmedRef.current = false;
      void finishHold();
    }, HOLD_TO_TALK_MAX_MS);
    return () => clearTimeout(timer);
  }, [phase]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") return;
      if (!holdingRef.current && phaseRef.current !== "listening") return;
      holdingRef.current = false;
      void abortListening();
    });
    return () => sub.remove();
  }, [abortListening]);

  const onReplayFather = () => {
    if (!replayClips.length) return;
    const [first, ...rest] = replayClips;
    setReplaySession(replayClips);
    void playReply(first.replyId, first.replyText, { queue: rest });
  };

  const openSpeakSettings = () => {
    if (!spaceId) return;
    const q = voice?.id ? `?voiceId=${voice.id}` : "";
    router.push(`/voice/${spaceId}/speak${q}` as never);
  };

  const openRenders = () => {
    if (!spaceId || !voice?.id) return;
    const cloneId =
      voice.tts_prefs?.provider_voice_id || voice.provider_voice_id || "";
    const q = new URLSearchParams({ voiceId: voice.id });
    if (cloneId) q.set("providerVoiceId", cloneId);
    router.push(`/voice/${spaceId}/renders?${q.toString()}` as never);
  };

  const phaseLabel = (() => {
    switch (phase) {
      case "listening":
        return cancelArmed
          ? "Thả tay để huỷ"
          : "Đang nghe con — thả tay để gửi";
      case "sending":
        return "Đang gửi giọng…";
      case "thinking":
        return `${relation} đang nghĩ…`;
      case "loading":
        return "Đang tải giọng…";
      case "speaking":
        return `${relation} đang nói`;
      case "error":
        return "Có lỗi — giữ để thử lại";
      default:
        return "Giữ để nói";
    }
  })();

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }

  if (threadMeta && threadMeta.kind !== "heritage") {
    return (
      <View style={[styles.center, { padding: 24 }]}>
        <Text style={styles.errorText}>
          Màn này chỉ dành cho phòng ký ức.
        </Text>
        <Pressable onPress={() => router.back()} style={styles.secondaryBtn}>
          <Text style={styles.secondaryBtnText}>Quay lại</Text>
        </Pressable>
      </View>
    );
  }

  const micBusy =
    phase === "sending" ||
    phase === "thinking" ||
    phase === "loading" ||
    phase === "speaking";
  const prefsReady = Boolean(
    voice?.tts_prefs?.provider_voice_id || voice?.provider_voice_id,
  );
  const showPending =
    Boolean(pendingUserText) &&
    (phase === "sending" ||
      phase === "thinking" ||
      !latestTurn ||
      latestTurn.userText !== pendingUserText);

  return (
    <View style={[styles.root, { paddingBottom: Math.max(insets.bottom, 12) }]}>
      <View style={styles.metaBar}>
        <Text style={styles.metaLine} numberOfLines={1}>
          Ký ức của {relation.toLowerCase()} · {displayName}
        </Text>
        <Pressable
          onPress={() => setVoiceStripOpen((v) => !v)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={
            prefsReady ? "Cài đặt giọng, đã sẵn sàng" : "Cài đặt giọng, chưa gắn set"
          }
        >
          <Text style={styles.voiceStripToggleText}>
            {prefsReady ? "Giọng ✓" : "Giọng…"}
            {voiceStripOpen ? " ▲" : " ▼"}
          </Text>
        </Pressable>
      </View>
      {voiceStripOpen ? (
        <View style={styles.voiceStrip}>
          <Text style={styles.voiceStripValue} numberOfLines={3}>
            {voiceSetSummary(voice)}
          </Text>
          {!prefsReady ? (
            <Text style={styles.voiceStripWarn}>
              Chưa gắn set cho Gọi — mở Cài đặt, chọn clone, rồi «Dùng cho Gọi».
            </Text>
          ) : null}
          <View style={styles.voiceStripActions}>
            <Pressable onPress={openSpeakSettings} hitSlop={8}>
              <Text style={styles.voiceStripLink}>Cài đặt giọng →</Text>
            </Pressable>
            {voice?.id ? (
              <Pressable onPress={openRenders} hitSlop={8}>
                <Text style={styles.voiceStripLink}>Nghe bản TTS →</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}

      <ScrollView
        ref={scrollRef}
        style={styles.transcriptScroll}
        contentContainerStyle={styles.transcriptContent}
        keyboardShouldPersistTaps="handled"
        scrollEventThrottle={16}
        onLayout={(e) => setViewportH(e.nativeEvent.layout.height)}
        onScroll={(e: NativeSyntheticEvent<NativeScrollEvent>) => {
          const { contentOffset, contentSize, layoutMeasurement } =
            e.nativeEvent;
          setScrollY(contentOffset.y);
          const fromBottom =
            contentSize.height - layoutMeasurement.height - contentOffset.y;
          stickTranscriptRef.current = fromBottom < 72;
        }}
        onContentSizeChange={() => {
          if (stickTranscriptRef.current) {
            scrollRef.current?.scrollToEnd({ animated: false });
          }
        }}
      >
        {!turns.length && !showPending ? (
          <Text style={styles.emptyHint}>
            Giữ nút bên dưới để nói với {relation.toLowerCase()}. Vuốt lên để huỷ.
          </Text>
        ) : null}

        {turns.length > 1 ? (
          <Text style={styles.historyLabel}>Hội thoại gần đây</Text>
        ) : null}

        {turns.map((turn, turnIndex) => {
          const isLatest = turnIndex === turns.length - 1;
          const playingThis = playingReplyId === turn.replyId;
          return (
            <View
              key={turn.replyId}
              style={[styles.turnBlock, !isLatest && styles.turnPast]}
              onLayout={(e) => {
                const { y, height } = e.nativeEvent.layout;
                const prevY = turnOffsetsRef.current.get(turn.replyId);
                const prevH = turnHeightsRef.current.get(turn.replyId);
                turnOffsetsRef.current.set(turn.replyId, y);
                turnHeightsRef.current.set(turn.replyId, height);
                if (prevY !== y || prevH !== height) {
                  setLayoutTick((n) => n + 1);
                }
              }}
            >
              {turn.userText ? (
                <View style={styles.bubbleMine}>
                  <Text style={[styles.bubbleLabel, { color: "#fff" }]}>
                    Con nói
                  </Text>
                  <Text style={[styles.bubbleText, { color: "#fff" }]}>
                    {turn.userText}
                  </Text>
                  {turn.userAt ? (
                    <Text style={[styles.bubbleTime, { color: "rgba(244,239,230,0.7)" }]}>
                      {formatMessageTime(turn.userAt)}
                    </Text>
                  ) : null}
                </View>
              ) : null}
              {turn.replyText ? (
                <Pressable
                  style={[
                    styles.bubbleHeritage,
                    playingThis && styles.bubbleHeritagePlaying,
                  ]}
                  onLayout={(e) => {
                    bubbleOffsetsRef.current.set(
                      turn.replyId,
                      e.nativeEvent.layout.y,
                    );
                  }}
                  onPress={
                    turn.hasMedia && phase === "idle"
                      ? () => void playReply(turn.replyId, turn.replyText)
                      : undefined
                  }
                  accessibilityRole={turn.hasMedia ? "button" : undefined}
                  accessibilityLabel={
                    turn.hasMedia ? "Chạm để nghe lại" : undefined
                  }
                >
                  <Text style={[styles.bubbleLabel, { color: colors.brandSoft }]}>
                    {relation} trả lời
                  </Text>
                  <FollowAlongBody
                    text={turn.replyText}
                    playing={playingThis}
                    activeIndex={playingThis ? activeSentence : null}
                    onBodyY={(yInBubble) => {
                      bodyOffsetsRef.current.set(turn.replyId, yInBubble);
                    }}
                    onSentenceY={(index, yInBody) => {
                      sentenceOffsetsRef.current.set(
                        `${turn.replyId}:${index}`,
                        yInBody,
                      );
                    }}
                  />
                  {turn.replyAt || playingThis ? (
                    <Text style={styles.bubbleTime}>
                      {playingThis && phase !== "loading"
                        ? "Đang phát"
                        : ""}
                      {playingThis && phase !== "loading" && turn.replyAt
                        ? " · "
                        : ""}
                      {turn.replyAt ? formatMessageTime(turn.replyAt) : ""}
                    </Text>
                  ) : null}
                  {playingThis && phase === "loading" ? (
                    <View style={styles.inlineLoading}>
                      <ActivityIndicator color={colors.brand} />
                      <Text style={styles.inlineLoadingText}>Đang tải…</Text>
                    </View>
                  ) : null}
                </Pressable>
              ) : null}
            </View>
          );
        })}

        {showPending ? (
          <View style={styles.bubbleMine}>
            <Text style={[styles.bubbleLabel, { color: "#fff" }]}>Con nói</Text>
            <Text style={[styles.bubbleText, { color: "#fff" }]}>
              {pendingUserText}
            </Text>
          </View>
        ) : null}

        {error ? <Text style={styles.errorText}>{error}</Text> : null}
      </ScrollView>

      <View style={styles.footer}>
        {phase === "listening" ? (
          <View style={styles.meterFloat} pointerEvents="none">
            <RecordingLevelMeter
              active
              variant="compact"
              metering={recorderState.metering}
              durationMillis={recorderState.durationMillis}
            />
          </View>
        ) : null}

        <HoldToTalkTarget
          disabled={micBusy}
          cancelDirection="up"
          onHoldStart={onHoldStart}
          onCancelArmedChange={onHoldCancelArmed}
          onHoldEnd={onHoldEnd}
          style={[
            styles.mainBtnHit,
            phase === "listening" && styles.mainBtnHitListening,
            phase === "listening" && cancelArmed && styles.mainBtnHitCancel,
            micBusy && styles.mainBtnBusy,
            phase === "error" && styles.mainBtnHitError,
          ]}
          accessibilityLabel={phaseLabel}
          accessibilityHint="Giữ để nói, thả tay để gửi, vuốt khỏi nút để huỷ"
        >
          <View
            style={[
              styles.mainBtn,
              phase === "listening" && styles.mainBtnListening,
              phase === "listening" && cancelArmed && styles.mainBtnCancel,
              phase === "error" && styles.mainBtnError,
            ]}
          >
            {phase === "sending" ||
            phase === "thinking" ||
            phase === "loading" ? (
              <ActivityIndicator color="#fff" size="large" />
            ) : (
              <Text style={styles.mainBtnGlyph}>
                {phase === "listening"
                  ? cancelArmed
                    ? "×"
                    : "■"
                  : phase === "speaking"
                    ? "♪"
                    : "●"}
              </Text>
            )}
          </View>
        </HoldToTalkTarget>
        <Text style={styles.phaseLabel} numberOfLines={1}>
          {phaseLabel}
        </Text>

        <View style={styles.replaySlot}>
          {phase === "loading" ? (
            <View style={styles.replayBtnLoading}>
              <ActivityIndicator color={colors.brand} />
              <Text style={styles.replayLoadingText}>Đang tải giọng…</Text>
            </View>
          ) : phase === "speaking" ? (
            <View style={styles.replayBtnPlaying}>
              <Text style={styles.replayPlayingText}>
                {replayCount > 1 && replayIndex >= 0
                  ? `Đang phát ${replayIndex + 1}/${replayCount}`
                  : "Đang phát…"}
              </Text>
            </View>
          ) : replayClips.length > 0 ? (
            <Pressable
              onPress={onReplayFather}
              disabled={phase !== "idle"}
              style={[styles.replayBtn, phase !== "idle" && { opacity: 0.45 }]}
              accessibilityRole="button"
              accessibilityLabel={`Nghe lại ${replayCount} câu của ${relation}`}
            >
              <Text style={styles.replayText}>
                ▶  Nghe lại{" "}
                <Text style={styles.replayCount}>{replayCount}</Text>
              </Text>
            </Pressable>
          ) : null}
        </View>

        <Pressable
          onPress={() => threadId && router.push(`/chat/${threadId}`)}
          style={styles.chatLink}
          disabled={phase === "loading" || phase === "listening"}
        >
          <Text style={styles.chatLinkText}>Xem hội thoại chữ →</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingHorizontal: 12,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bg,
  },
  metaBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingTop: 2,
    paddingBottom: 6,
  },
  metaLine: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 14,
    fontWeight: "600",
    color: colors.ink,
  },
  voiceStripToggleText: {
    fontFamily: fonts.body,
    fontSize: 13,
    fontWeight: "600",
    color: colors.brand,
  },
  voiceStrip: {
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 6,
    gap: 4,
  },
  voiceStripValue: {
    fontFamily: fonts.body,
    fontSize: 14,
    lineHeight: 20,
    color: colors.ink,
  },
  voiceStripWarn: {
    fontFamily: fonts.body,
    fontSize: 13,
    lineHeight: 18,
    color: colors.danger,
    marginTop: 2,
  },
  voiceStripActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 16,
    marginTop: 6,
  },
  voiceStripLink: {
    fontFamily: fonts.body,
    fontSize: 14,
    fontWeight: "700",
    color: colors.brand,
  },
  transcriptScroll: {
    flex: 1,
    minHeight: 0,
  },
  transcriptContent: {
    paddingVertical: 8,
    gap: 16,
    paddingBottom: 16,
  },
  historyLabel: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.inkSoft,
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  turnBlock: {
    gap: 12,
  },
  turnPast: {
    opacity: 0.78,
  },
  emptyHint: {
    fontFamily: fonts.body,
    fontSize: 17,
    color: colors.inkSoft,
    textAlign: "center",
    marginTop: 20,
    lineHeight: 26,
  },
  bubbleMine: {
    alignSelf: "stretch",
    backgroundColor: colors.bubbleMine,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  bubbleHeritage: {
    alignSelf: "stretch",
    backgroundColor: colors.bubbleAgent,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    gap: 8,
  },
  bubbleHeritagePlaying: {
    borderColor: colors.brand,
    borderWidth: 1.5,
    backgroundColor: "#e4efe8",
  },
  bubbleLabel: {
    fontFamily: fonts.body,
    fontSize: 13,
    opacity: 0.75,
    marginBottom: 2,
  },
  bubbleText: {
    fontFamily: fonts.body,
    fontSize: 19,
    lineHeight: 28,
  },
  bubbleTime: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.inkSoft,
    marginTop: 6,
  },
  sentence: {
    fontFamily: fonts.body,
    fontSize: 19,
    lineHeight: 28,
    color: colors.ink,
    paddingVertical: 4,
    paddingHorizontal: 6,
    marginHorizontal: -6,
    borderRadius: 8,
  },
  sentencePast: {
    color: colors.inkSoft,
  },
  sentenceActive: {
    backgroundColor: "rgba(45, 74, 62, 0.14)",
    color: colors.ink,
    fontWeight: "600",
  },
  inlineLoading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
  },
  inlineLoadingText: {
    fontFamily: fonts.body,
    fontSize: 16,
    color: colors.brand,
  },
  footer: {
    alignItems: "center",
    paddingTop: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
    position: "relative",
  },
  meterFloat: {
    position: "absolute",
    left: 0,
    right: 0,
    top: -36,
    height: 36,
    justifyContent: "center",
  },
  mainBtnHit: {
    padding: 22,
    borderRadius: 80,
    backgroundColor: "rgba(45, 74, 62, 0.14)",
    alignItems: "center",
    justifyContent: "center",
  },
  mainBtnHitListening: {
    backgroundColor: "rgba(139, 58, 58, 0.22)",
  },
  mainBtnHitCancel: {
    backgroundColor: "rgba(138, 58, 50, 0.28)",
  },
  mainBtnHitError: {
    backgroundColor: "rgba(139, 58, 58, 0.22)",
  },
  mainBtn: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.brand,
    alignItems: "center",
    justifyContent: "center",
  },
  mainBtnListening: {
    backgroundColor: colors.danger,
  },
  mainBtnCancel: {
    backgroundColor: "#8a3a32",
  },
  mainBtnBusy: {
    opacity: 0.85,
  },
  mainBtnError: {
    backgroundColor: colors.danger,
  },
  mainBtnGlyph: {
    fontSize: 30,
    color: "#fff",
  },
  phaseLabel: {
    marginTop: 8,
    height: 24,
    fontFamily: fonts.display,
    fontSize: 18,
    lineHeight: 24,
    color: colors.ink,
    textAlign: "center",
  },
  replaySlot: {
    alignSelf: "stretch",
    minHeight: 58,
    marginTop: 8,
    justifyContent: "center",
  },
  replayBtn: {
    alignSelf: "stretch",
    backgroundColor: colors.card,
    borderWidth: 2,
    borderColor: colors.brand,
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 20,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 58,
  },
  replayBtnLoading: {
    alignSelf: "stretch",
    flexDirection: "row",
    gap: 12,
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 20,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 58,
    backgroundColor: colors.bgDeep,
  },
  replayBtnPlaying: {
    alignSelf: "stretch",
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 20,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 58,
    backgroundColor: colors.bgDeep,
  },
  replayText: {
    fontFamily: fonts.body,
    fontSize: 20,
    fontWeight: "700",
    color: colors.brand,
  },
  replayCount: {
    fontFamily: fonts.body,
    fontSize: 22,
    fontWeight: "800",
    color: colors.brand,
  },
  replayLoadingText: {
    fontFamily: fonts.body,
    fontSize: 18,
    color: colors.brand,
  },
  replayPlayingText: {
    fontFamily: fonts.body,
    fontSize: 18,
    color: colors.inkSoft,
  },
  chatLink: {
    marginTop: 2,
    paddingVertical: 6,
  },
  chatLinkText: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.inkSoft,
  },
  errorText: {
    fontFamily: fonts.body,
    fontSize: 16,
    color: colors.danger,
    textAlign: "center",
    lineHeight: 24,
  },
  secondaryBtn: {
    marginTop: 16,
    paddingVertical: 12,
    paddingHorizontal: 20,
  },
  secondaryBtnText: {
    fontFamily: fonts.body,
    fontSize: 16,
    color: colors.brand,
  },
});
