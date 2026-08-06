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
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
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
import { fetchAuthedMediaUri } from "@/lib/media";
import { RecordingLevelMeter } from "@/lib/recordingMeter";
import { VOICE_RECORDING_OPTIONS } from "@/lib/recordingOptions";
import { useSpaceScreenOptions } from "@/lib/spaceHeader";
import { colors, fonts } from "@/lib/theme";

type CallPhase = "idle" | "listening" | "thinking" | "speaking" | "error";

const POLL_MS = 1200;
const REPLY_TIMEOUT_MS = 90_000;

function isHeritageReply(m: ChatMessage): boolean {
  return m.sender_kind === "heritage";
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
  const [lastUserText, setLastUserText] = useState("");
  const [lastReplyText, setLastReplyText] = useState("");
  const [canReplay, setCanReplay] = useState(false);

  const awaitingAfterIdRef = useRef<string | null>(null);
  const replyDeadlineRef = useRef(0);
  const lastReplyMediaIdRef = useRef<string | null>(null);
  const prefetchUriRef = useRef<string | null>(null);
  const phaseRef = useRef<CallPhase>("idle");
  phaseRef.current = phase;

  const displayName =
    threadMeta?.heritage?.display_name || threadMeta?.title || "Bố";
  const relation =
    threadMeta?.heritage?.relation_label ||
    (displayName.startsWith("Bố") ? "Bố" : "Người thân");
  const spaceId = threadMeta?.space_id;
  const identityId = threadMeta?.heritage?.identity_id;

  useSpaceScreenOptions({
    spaceId,
    title: `Gọi · ${displayName}`,
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

  const load = useCallback(async () => {
    if (!threadId) return;
    try {
      const thread = await api.getThread(threadId);
      setThreadMeta(thread);
      if (thread.space_id && thread.heritage?.identity_id) {
        await loadVoice(thread.space_id, thread.heritage.identity_id);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không mở được cuộc gọi.");
      setPhase("error");
    } finally {
      setLoading(false);
    }
  }, [api, threadId, loadVoice]);

  useEffect(() => {
    void load();
  }, [load]);

  // Refresh voice prefs when returning from Speak / renders.
  useFocusEffect(
    useCallback(() => {
      if (spaceId && identityId) void loadVoice(spaceId, identityId);
    }, [spaceId, identityId, loadVoice]),
  );

  const playReply = useCallback(
    async (message: ChatMessage) => {
      if (!message.has_media) return;
      try {
        setPhase("speaking");
        setCanReplay(false);
        let uri = prefetchUriRef.current;
        if (!uri || lastReplyMediaIdRef.current !== message.id) {
          uri = await fetchAuthedMediaUri(
            api.messageMediaUrl(message.id),
            `call-${message.id}`,
          );
          prefetchUriRef.current = uri;
          lastReplyMediaIdRef.current = message.id;
        }
        await preparePlaybackMode();
        await playLocalAudio(uri, () => {
          setPhase("idle");
          setCanReplay(true);
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Không phát được giọng.");
        setPhase("idle");
        setCanReplay(true);
      }
    },
    [api],
  );

  useEffect(() => {
    if (!threadId || phase !== "thinking") return;
    const timer = setInterval(async () => {
      if (!awaitingAfterIdRef.current) return;
      if (replyDeadlineRef.current && Date.now() > replyDeadlineRef.current) {
        awaitingAfterIdRef.current = null;
        replyDeadlineRef.current = 0;
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
            if ((m.body || "").trim()) setLastUserText(m.body.trim());
            continue;
          }
          if (!seenUser) continue;
          if (!isHeritageReply(m)) continue;
          awaitingAfterIdRef.current = null;
          replyDeadlineRef.current = 0;
          setLastReplyText((m.body || "").trim());
          if (m.has_media) {
            void fetchAuthedMediaUri(
              api.messageMediaUrl(m.id),
              `call-${m.id}`,
            )
              .then((uri) => {
                prefetchUriRef.current = uri;
                lastReplyMediaIdRef.current = m.id;
              })
              .catch(() => undefined);
            await playReply(m);
          } else {
            setPhase("idle");
            setCanReplay(false);
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

  const startListening = async () => {
    if (phase !== "idle" && phase !== "error") return;
    setError(null);
    try {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) {
        setError("Cho phép micro để nói với Bố.");
        setPhase("error");
        return;
      }
      await stopActivePlayback();
      await prepareRecordingMode();
      await recorder.prepareToRecordAsync();
      recorder.record();
      setPhase("listening");
      setCanReplay(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không ghi âm được.");
      setPhase("error");
    }
  };

  const stopAndSend = async () => {
    if (phase !== "listening" || !threadId || !user) return;
    try {
      await recorder.stop();
      await preparePlaybackMode();
      const uri = recorder.uri;
      if (!uri) throw new Error("Không có file ghi âm.");

      setPhase("thinking");
      setLastUserText("…");
      setLastReplyText("");
      const sent = await api.sendVoiceMessage(threadId, {
        uri,
        name: "voice.m4a",
        mimeType: "audio/mp4",
      });
      awaitingAfterIdRef.current = sent.id;
      replyDeadlineRef.current = Date.now() + REPLY_TIMEOUT_MS;
      if ((sent.body || "").trim()) setLastUserText(sent.body.trim());
    } catch (e) {
      awaitingAfterIdRef.current = null;
      setError(e instanceof Error ? e.message : "Không gửi được giọng nói.");
      setPhase("error");
    }
  };

  const onMainPress = () => {
    if (phase === "listening") {
      void stopAndSend();
      return;
    }
    if (phase === "idle" || phase === "error") {
      void startListening();
    }
  };

  const onReplay = async () => {
    const id = lastReplyMediaIdRef.current;
    if (!id || !canReplay) return;
    try {
      setPhase("speaking");
      setCanReplay(false);
      let uri = prefetchUriRef.current;
      if (!uri) {
        uri = await fetchAuthedMediaUri(api.messageMediaUrl(id), `call-${id}`);
        prefetchUriRef.current = uri;
      }
      await preparePlaybackMode();
      await playLocalAudio(uri, () => {
        setPhase("idle");
        setCanReplay(true);
      });
    } catch {
      setPhase("idle");
      setCanReplay(true);
    }
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
        return "Đang nghe con";
      case "thinking":
        return `${relation} đang nghĩ…`;
      case "speaking":
        return `${relation} đang nói`;
      case "error":
        return "Có lỗi — chạm để thử lại";
      default:
        return "Chạm để nói";
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

  const busy = phase === "thinking" || phase === "speaking";
  const prefsReady = Boolean(
    voice?.tts_prefs?.provider_voice_id || voice?.provider_voice_id,
  );

  return (
    <View style={[styles.root, { paddingBottom: Math.max(insets.bottom, 16) }]}>
      <View style={styles.banner}>
        <Text style={styles.bannerKicker}>Ký ức của {relation.toLowerCase()}</Text>
        <Text style={styles.bannerName} numberOfLines={1}>
          {displayName}
        </Text>
      </View>

      <View style={styles.voiceStrip}>
        <Text style={styles.voiceStripLabel}>Giọng đang dùng</Text>
        <Text style={styles.voiceStripValue} numberOfLines={2}>
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

      <ScrollView
        style={styles.transcriptScroll}
        contentContainerStyle={styles.transcriptContent}
        keyboardShouldPersistTaps="handled"
      >
        {lastUserText ? (
          <View style={styles.bubbleMine}>
            <Text style={[styles.bubbleLabel, { color: "#fff" }]}>Con nói</Text>
            <Text style={[styles.bubbleText, { color: "#fff" }]}>
              {lastUserText}
            </Text>
          </View>
        ) : (
          <Text style={styles.emptyHint}>
            Chạm nút bên dưới để nói với {relation.toLowerCase()}.
          </Text>
        )}
        {lastReplyText ? (
          <View style={styles.bubbleHeritage}>
            <Text style={[styles.bubbleLabel, { color: colors.brandSoft }]}>
              {relation} trả lời
            </Text>
            <Text style={[styles.bubbleText, { color: colors.ink }]}>
              {lastReplyText}
            </Text>
          </View>
        ) : null}
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
      </ScrollView>

      <View style={styles.footer}>
        {phase === "listening" ? (
          <RecordingLevelMeter
            active
            variant="large"
            metering={recorderState.metering}
            durationMillis={recorderState.durationMillis}
            style={styles.meter}
          />
        ) : null}

        <Pressable
          onPress={onMainPress}
          disabled={busy}
          style={[
            styles.mainBtn,
            phase === "listening" && styles.mainBtnListening,
            busy && styles.mainBtnBusy,
            phase === "error" && styles.mainBtnError,
          ]}
          accessibilityRole="button"
          accessibilityLabel={phaseLabel}
        >
          {phase === "thinking" ? (
            <ActivityIndicator color="#fff" size="large" />
          ) : (
            <Text style={styles.mainBtnGlyph}>
              {phase === "listening" ? "■" : phase === "speaking" ? "♪" : "●"}
            </Text>
          )}
        </Pressable>
        <Text style={styles.phaseLabel}>{phaseLabel}</Text>

        {canReplay && lastReplyMediaIdRef.current ? (
          <Pressable onPress={() => void onReplay()} style={styles.replayBtn}>
            <Text style={styles.replayText}>Nghe lại</Text>
          </Pressable>
        ) : (
          <View style={styles.replayPlaceholder} />
        )}

        <Pressable
          onPress={() => threadId && router.push(`/chat/${threadId}`)}
          style={styles.chatLink}
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
    paddingHorizontal: 20,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bg,
  },
  banner: {
    paddingTop: 8,
    paddingBottom: 8,
  },
  bannerKicker: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.inkSoft,
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  bannerName: {
    fontFamily: fonts.display,
    fontSize: 24,
    color: colors.ink,
    marginTop: 2,
  },
  voiceStrip: {
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
    gap: 4,
  },
  voiceStripLabel: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.inkSoft,
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  voiceStripValue: {
    fontFamily: fonts.body,
    fontSize: 15,
    lineHeight: 22,
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
    marginTop: 8,
  },
  voiceStripLink: {
    fontFamily: fonts.body,
    fontSize: 15,
    fontWeight: "700",
    color: colors.brand,
  },
  transcriptScroll: {
    flex: 1,
    minHeight: 0,
  },
  transcriptContent: {
    paddingVertical: 12,
    gap: 14,
    paddingBottom: 8,
  },
  emptyHint: {
    fontFamily: fonts.body,
    fontSize: 16,
    color: colors.inkSoft,
    textAlign: "center",
    marginTop: 24,
    lineHeight: 24,
  },
  bubbleMine: {
    alignSelf: "flex-end",
    maxWidth: "92%",
    backgroundColor: colors.bubbleMine,
    borderRadius: 18,
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  bubbleHeritage: {
    alignSelf: "flex-start",
    maxWidth: "92%",
    backgroundColor: colors.bubbleAgent,
    borderRadius: 18,
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
  bubbleLabel: {
    fontFamily: fonts.body,
    fontSize: 13,
    opacity: 0.75,
    marginBottom: 4,
  },
  bubbleText: {
    fontFamily: fonts.body,
    fontSize: 20,
    lineHeight: 30,
  },
  footer: {
    alignItems: "center",
    paddingTop: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
  },
  meter: {
    marginBottom: 12,
    width: "100%",
  },
  mainBtn: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: colors.brand,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 10,
  },
  mainBtnListening: {
    backgroundColor: colors.danger,
  },
  mainBtnBusy: {
    opacity: 0.85,
  },
  mainBtnError: {
    backgroundColor: colors.danger,
  },
  mainBtnGlyph: {
    fontSize: 32,
    color: "#fff",
  },
  phaseLabel: {
    marginTop: 12,
    fontFamily: fonts.display,
    fontSize: 20,
    color: colors.ink,
    textAlign: "center",
  },
  replayBtn: {
    marginTop: 10,
    paddingVertical: 10,
    paddingHorizontal: 28,
  },
  replayPlaceholder: {
    height: 40,
    marginTop: 10,
  },
  replayText: {
    fontFamily: fonts.body,
    fontSize: 17,
    color: colors.brand,
  },
  chatLink: {
    marginTop: 0,
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
