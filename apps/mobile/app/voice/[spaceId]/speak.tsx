import {
  ElevenLabsVoice,
  minimaxEmotionLabel,
  minimaxEmotionsForModel,
  VoiceProfile,
  VOICE_PROVIDERS,
  type VoiceProvider,
  type VoiceTtsModelId,
  type VoiceTtsOptions,
  voiceProviderLabel,
  voiceTtsModelsFor,
} from "@forever/api-client";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  pauseActivePlayback,
  playLocalAudio,
  resumeActivePlayback,
  stopActivePlayback,
} from "@/lib/audio";
import { useAuth } from "@/lib/auth";
import { elVoiceSortKey, formatElVoiceWhen } from "@/lib/elVoice";
import {
  fetchAuthedMediaUri,
} from "@/lib/media";
import { useSpaceScreenOptions } from "@/lib/spaceHeader";
import { colors, fonts, createThemedStyles } from "@/lib/theme";
import {
  activeTtsValues,
  clampModify,
  clampPitch,
  clampSpeedUnit,
  clampUnit,
  DEFAULT_DRAFT_TEXT,
  DEFAULT_TTS_PROFILE_SETTINGS,
  EMOTION_AUTO,
  fromSpeedUnit,
  fromUnit,
  loadTtsSettings,
  MODIFY_MAX,
  MODIFY_MIN,
  MODIFY_STEP,
  PITCH_MAX,
  PITCH_MIN,
  PITCH_STEP,
  PRESET_VALUES,
  saveTtsSettings,
  SPEED_UNIT_MAX,
  SPEED_UNIT_MIN,
  toUnit,
  TTS_STEP,
  UNIT_MAX,
  UNIT_MIN,
  type TtsPresetName,
  type TtsProfileSettings,
  type TtsValues,
} from "@/lib/ttsSettings";

type PickerOption = {
  id: string;
  title: string;
  subtitle?: string;
};

type OpenPicker = "voice" | "model" | "profile" | "emotion" | null;

const INITIAL_VALUES = activeTtsValues(DEFAULT_TTS_PROFILE_SETTINGS, "elevenlabs");

/** A Forever Voice DNA may hold clones on more than one provider account. */
type CloneOption = ElevenLabsVoice & { provider: VoiceProvider };

function cloneKey(v: { provider: VoiceProvider; voice_id: string }): string {
  return `${v.provider}:${v.voice_id}`;
}

function formatIntLabel(value: number): string {
  return String(value);
}

/** MiniMax knobs read as offsets from the clone, so the sign carries meaning. */
function formatSignedLabel(value: number): string {
  if (value === 0) return "0";
  return value > 0 ? `+${value}` : `−${Math.abs(value)}`;
}

function TtsStepper({
  label,
  hint,
  value,
  onChange,
  min = UNIT_MIN,
  max = UNIT_MAX,
  step = TTS_STEP,
  clamp = clampUnit,
  format = formatIntLabel,
}: {
  label: string;
  hint: string;
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  step?: number;
  clamp?: (value: number) => number;
  format?: (value: number) => string;
}) {
  const dec = () => onChange(clamp(value - step));
  const inc = () => onChange(clamp(value + step));

  return (
    <View style={styles.advancedRow}>
      <View style={styles.advancedCopy}>
        <Text style={styles.advancedLabel}>{label}</Text>
        <Text style={styles.advancedHint}>{hint}</Text>
      </View>
      <View style={styles.stepper}>
        <Pressable
          style={[styles.stepBtn, value <= min && styles.stepBtnDisabled]}
          onPress={dec}
          disabled={value <= min}
          hitSlop={6}
        >
          <Text style={styles.stepBtnText}>−</Text>
        </Pressable>
        <Text style={styles.stepValue}>{format(value)}</Text>
        <Pressable
          style={[styles.stepBtn, value >= max && styles.stepBtnDisabled]}
          onPress={inc}
          disabled={value >= max}
          hitSlop={6}
        >
          <Text style={styles.stepBtnText}>+</Text>
        </Pressable>
      </View>
    </View>
  );
}

function DropdownField({
  label,
  value,
  placeholder,
  hint,
  onPress,
  disabled,
}: {
  label: string;
  value: string;
  placeholder: string;
  hint?: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <View style={styles.fieldBlock}>
      <Text style={styles.section}>{label}</Text>
      <Pressable
        style={[styles.dropdown, disabled && styles.disabled]}
        onPress={onPress}
        disabled={disabled}
      >
        <View style={styles.dropdownCopy}>
          <Text
            style={[styles.dropdownValue, !value && styles.dropdownPlaceholder]}
            numberOfLines={2}
          >
            {value || placeholder}
          </Text>
          {hint ? (
            <Text style={styles.dropdownHint} numberOfLines={1}>
              {hint}
            </Text>
          ) : null}
        </View>
        <Text style={styles.chevron}>▾</Text>
      </Pressable>
    </View>
  );
}

export default function VoiceSpeakScreen() {
  const { spaceId, voiceId: voiceIdParam } = useLocalSearchParams<{
    spaceId: string;
    voiceId: string;
  }>();
  const { api } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  const [profiles, setProfiles] = useState<VoiceProfile[]>([]);
  const [elVoices, setElVoices] = useState<CloneOption[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(
    voiceIdParam || null,
  );
  /** `${provider}:${voice_id}` so MiniMax and ElevenLabs never collide. */
  const [selectedCloneKey, setSelectedCloneKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState(DEFAULT_DRAFT_TEXT);
  const [modelId, setModelId] = useState<VoiceTtsModelId>("eleven_v3");
  const [preset, setPreset] = useState<TtsPresetName | null>(
    DEFAULT_TTS_PROFILE_SETTINGS.mode === "custom"
      ? null
      : DEFAULT_TTS_PROFILE_SETTINGS.mode,
  );
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [stability, setStability] = useState(INITIAL_VALUES.stability);
  const [similarityBoost, setSimilarityBoost] = useState(
    INITIAL_VALUES.similarityBoost,
  );
  const [styleExaggeration, setStyleExaggeration] = useState(
    INITIAL_VALUES.style,
  );
  const [speakerBoost, setSpeakerBoost] = useState(INITIAL_VALUES.speakerBoost);
  const [speed, setSpeed] = useState(INITIAL_VALUES.speed);
  const [lengthenPauses, setLengthenPauses] = useState(
    INITIAL_VALUES.lengthenPauses,
  );
  const [emotion, setEmotion] = useState(INITIAL_VALUES.emotion);
  const [pitch, setPitch] = useState(INITIAL_VALUES.pitch);
  const [intensity, setIntensity] = useState(INITIAL_VALUES.intensity);
  const [timbre, setTimbre] = useState(INITIAL_VALUES.timbre);
  const [busy, setBusy] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [paused, setPaused] = useState(false);
  const [openPicker, setOpenPicker] = useState<OpenPicker>(null);
  const [settingsReady, setSettingsReady] = useState(false);

  const selectedProfileIdRef = useRef<string | null>(selectedProfileId);
  selectedProfileIdRef.current = selectedProfileId;
  const textRef = useRef(text);
  textRef.current = text;
  /** Presets resolve per provider, and callbacks run outside render. */
  const providerRef = useRef<VoiceProvider>("elevenlabs");

  const settingsRef = useRef<TtsProfileSettings>(DEFAULT_TTS_PROFILE_SETTINGS);

  const applyValues = useCallback((values: TtsValues, mode: TtsProfileSettings["mode"]) => {
    setPreset(mode === "custom" ? null : mode);
    setStability(values.stability);
    setSimilarityBoost(values.similarityBoost);
    setStyleExaggeration(values.style);
    setSpeakerBoost(values.speakerBoost);
    setSpeed(values.speed);
    setLengthenPauses(values.lengthenPauses);
    setEmotion(values.emotion);
    setPitch(values.pitch);
    setIntensity(values.intensity);
    setTimbre(values.timbre);
  }, []);

  const commitProfileSettings = useCallback(
    (patch: Partial<TtsProfileSettings> & Pick<TtsProfileSettings, "mode" | "custom">) => {
      const next: TtsProfileSettings = {
        ...settingsRef.current,
        ...patch,
        draftText: patch.draftText ?? settingsRef.current.draftText ?? textRef.current,
      };
      settingsRef.current = next;
      applyValues(activeTtsValues(next, providerRef.current), next.mode);
      const profileId = selectedProfileIdRef.current;
      if (profileId) {
        void saveTtsSettings(profileId, next);
      }
    },
    [applyValues],
  );

  const hydrateSettings = useCallback(
    async (profileId: string) => {
      const saved =
        (await loadTtsSettings(profileId)) ?? DEFAULT_TTS_PROFILE_SETTINGS;
      settingsRef.current = saved;
      applyValues(activeTtsValues(saved, providerRef.current), saved.mode);
      setAdvancedOpen(saved.mode === "custom");
      setText(
        typeof saved.draftText === "string" && saved.draftText.length > 0
          ? saved.draftText
          : DEFAULT_DRAFT_TEXT,
      );
      setSettingsReady(true);
    },
    [applyValues],
  );

  useSpaceScreenOptions({
    spaceId,
    title: "Tạo câu nói",
    backTitle: "Nhà",
  });

  useEffect(() => {
    const show = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow",
      () => setKeyboardOpen(true),
    );
    const hide = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide",
      () => setKeyboardOpen(false),
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  const sortedElVoices = useMemo(
    () =>
      [...elVoices].sort((a, b) => elVoiceSortKey(b) - elVoiceSortKey(a)),
    [elVoices],
  );

  const selectedProfile = useMemo(
    () => profiles.find((p) => p.id === selectedProfileId) ?? null,
    [profiles, selectedProfileId],
  );
  const selectedElVoice = useMemo(
    () =>
      sortedElVoices.find((v) => cloneKey(v) === selectedCloneKey) ?? null,
    [sortedElVoices, selectedCloneKey],
  );
  const selectedElVoiceId = selectedElVoice?.voice_id ?? null;
  // The selected clone's vendor decides the model list and which knobs apply —
  // not the profile default alone, so stewards can A/B both houses in one screen.
  const provider: VoiceProvider =
    selectedElVoice?.provider ??
    (selectedProfile?.provider === "minimax" ? "minimax" : "elevenlabs");
  const isMinimax = provider === "minimax";
  providerRef.current = provider;
  const modelOptions = useMemo(() => voiceTtsModelsFor(provider), [provider]);
  const selectedModel = useMemo(
    () => modelOptions.find((m) => m.id === modelId) ?? modelOptions[0],
    [modelOptions, modelId],
  );
  const emotionOptions = useMemo(
    () => (isMinimax ? minimaxEmotionsForModel(modelId) : []),
    [isMinimax, modelId],
  );

  useEffect(() => {
    if (!modelOptions.some((m) => m.id === modelId)) {
      setModelId(modelOptions[0].id as VoiceTtsModelId);
    }
  }, [modelOptions, modelId]);

  // A preset means the same intent on both vendors but reaches it with
  // different parameters, so switching clone re-resolves it.
  useEffect(() => {
    if (!settingsReady) return;
    const mode = settingsRef.current.mode;
    if (mode === "custom") return;
    applyValues(PRESET_VALUES[provider][mode], mode);
  }, [provider, settingsReady, applyValues]);

  const pickPreferredClone = useCallback(
    (profile: VoiceProfile | null, sorted: CloneOption[]): string | null => {
      if (!sorted.length) return null;
      const profileProvider: VoiceProvider =
        profile?.provider === "minimax" ? "minimax" : "elevenlabs";
      const attached =
        profile?.provider_voice_id &&
        (sorted.find(
          (x) =>
            x.voice_id === profile.provider_voice_id &&
            x.provider === profileProvider,
        ) ||
          sorted.find((x) => x.voice_id === profile.provider_voice_id));
      if (attached) return cloneKey(attached);
      const byName = sorted.find((x) =>
        profile?.display_name
          ? x.name
              .toLowerCase()
              .includes(profile.display_name.split("(")[0].trim().toLowerCase())
          : false,
      );
      if (byName) return cloneKey(byName);
      return cloneKey(sorted[0]);
    },
    [],
  );

  const loadElVoicesForProfile = useCallback(
    async (profile: VoiceProfile | null) => {
      if (!spaceId || !profile) {
        setElVoices([]);
        setSelectedCloneKey(null);
        return;
      }
      const results = await Promise.allSettled(
        VOICE_PROVIDERS.map((p) =>
          api.listElevenLabsVoices(spaceId, {
            clonedOnly: true,
            voiceId: profile.id,
            provider: p.id,
          }),
        ),
      );
      const merged: CloneOption[] = [];
      results.forEach((result, index) => {
        if (result.status !== "fulfilled") return;
        const p = VOICE_PROVIDERS[index];
        merged.push(
          ...result.value.voices.map((v) => ({ ...v, provider: p.id })),
        );
      });
      if (
        !merged.length &&
        results.every((r) => r.status === "rejected")
      ) {
        throw new Error("Không tải được bản clone từ cả hai dịch vụ.");
      }
      const sorted = merged.sort(
        (a, b) => elVoiceSortKey(b) - elVoiceSortKey(a),
      );
      setElVoices(sorted);
      setSelectedCloneKey((prev) =>
        prev && sorted.some((v) => cloneKey(v) === prev)
          ? prev
          : pickPreferredClone(profile, sorted),
      );
    },
    [api, spaceId, pickPreferredClone],
  );

  const load = useCallback(async () => {
    if (!spaceId) return;
    setLoading(true);
    setSettingsReady(false);
    try {
      const v = await api.listVoices(spaceId);
      setProfiles(v.voices);

      const prev = selectedProfileIdRef.current;
      const resolved =
        (prev && v.voices.find((x) => x.id === prev)) ||
        (voiceIdParam ? v.voices.find((x) => x.id === voiceIdParam) : null) ||
        v.voices.find((x) => x.status === "ready") ||
        v.voices[0] ||
        null;

      setSelectedProfileId(resolved?.id ?? null);
      await loadElVoicesForProfile(resolved);
      if (resolved?.id) {
        await hydrateSettings(resolved.id);
      } else {
        setSettingsReady(true);
      }
    } catch (e) {
      Alert.alert("Lỗi", e instanceof Error ? e.message : "Không tải voices.");
    } finally {
      setLoading(false);
    }
  }, [api, spaceId, voiceIdParam, loadElVoicesForProfile, hydrateSettings]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    return () => {
      const profileId = selectedProfileIdRef.current;
      if (profileId) {
        void saveTtsSettings(profileId, {
          ...settingsRef.current,
          draftText: textRef.current,
        });
      }
    };
  }, []);

  const applyPreset = (next: TtsPresetName) => {
    setAdvancedOpen(false);
    commitProfileSettings({
      mode: next,
      custom: settingsRef.current.custom,
    });
  };

  const selectCustom = () => {
    if (preset === null) {
      setAdvancedOpen((open) => !open);
      return;
    }
    setAdvancedOpen(true);
    // Start from what is playing now, so Tùy chỉnh tweaks the preset the user
    // just heard instead of jumping to an unrelated set of numbers.
    commitProfileSettings({
      mode: "custom",
      custom: activeTtsValues(settingsRef.current, providerRef.current),
    });
  };

  const patchCustom = useCallback(
    (patch: Partial<TtsValues>) => {
      commitProfileSettings({
        mode: "custom",
        custom: { ...settingsRef.current.custom, ...patch },
      });
    },
    [commitProfileSettings],
  );

  // `fluent` / `whisper` exist only on the 2.6 line; fall back to auto rather
  // than letting the server reject a request the user cannot see is invalid.
  useEffect(() => {
    if (!isMinimax || emotion === EMOTION_AUTO) return;
    if (emotionOptions.some((e) => e.id === emotion)) return;
    patchCustom({ emotion: EMOTION_AUTO });
  }, [isMinimax, emotion, emotionOptions, patchCustom]);

  // Send only the half the provider honours, so a saved render never carries
  // numbers that never left the phone.
  const ttsOpts = useMemo<VoiceTtsOptions>(
    () => ({
      model_id: modelId,
      provider_voice_id: selectedElVoiceId || undefined,
      provider_voice_name: selectedElVoice?.name,
      speed,
      lengthen_pauses: lengthenPauses,
      ...(isMinimax
        ? { emotion, pitch, intensity, timbre }
        : {
            stability,
            similarity_boost: similarityBoost,
            style: styleExaggeration,
            use_speaker_boost: speakerBoost,
          }),
    }),
    [
      modelId,
      selectedElVoiceId,
      selectedElVoice?.name,
      speed,
      lengthenPauses,
      isMinimax,
      emotion,
      pitch,
      intensity,
      timbre,
      stability,
      similarityBoost,
      styleExaggeration,
      speakerBoost,
    ],
  );

  const selectProfile = (id: string) => {
    if (id === selectedProfileId) return;
    void stopActivePlayback();
    setPreviewing(false);
    setPaused(false);
    setSettingsReady(false);
    const leavingId = selectedProfileId;
    if (leavingId) {
      void saveTtsSettings(leavingId, {
        ...settingsRef.current,
        draftText: textRef.current,
      });
    }
    setSelectedProfileId(id);
    const profile = profiles.find((p) => p.id === id) ?? null;
    void (async () => {
      await loadElVoicesForProfile(profile);
      if (profile) {
        await hydrateSettings(profile.id);
      } else {
        setSettingsReady(true);
      }
    })();
  };

  const onChangeDraftText = (next: string) => {
    setText(next);
    settingsRef.current = {
      ...settingsRef.current,
      draftText: next,
    };
    const profileId = selectedProfileIdRef.current;
    if (profileId) {
      void saveTtsSettings(profileId, settingsRef.current);
    }
  };

  const selectElVoice = (key: string) => {
    if (key === selectedCloneKey) return;
    void stopActivePlayback();
    setPreviewing(false);
    setPaused(false);
    setSelectedCloneKey(key);
  };

  const createAndPlay = async () => {
    if (!selectedProfileId || !selectedElVoiceId || !text.trim() || busy) return;
    if (previewing) {
      if (paused) {
        if (resumeActivePlayback()) setPaused(false);
        return;
      }
      if (pauseActivePlayback()) setPaused(true);
      return;
    }
    setBusy(true);
    try {
      const render = await api.saveVoiceRender(
        selectedProfileId,
        text.trim(),
        ttsOpts,
      );
      const url = api.voiceRenderMediaUrl(render.voice_profile_id, render.id);
      const uri = await fetchAuthedMediaUri(
        url,
        `speak-render-${render.id}`,
        render.media_mime,
      );
      setPreviewing(true);
      setPaused(false);
      await playLocalAudio(uri, () => {
        setPreviewing(false);
        setPaused(false);
      });
    } catch (e) {
      setPreviewing(false);
      Alert.alert("TTS lỗi", e instanceof Error ? e.message : "Không tạo được.");
    } finally {
      setBusy(false);
    }
  };

  const applySetForCall = async () => {
    if (!selectedProfileId || !selectedElVoiceId || busy) return;
    setBusy(true);
    try {
      const provider = (selectedElVoice?.provider ||
        selectedProfile?.provider ||
        "elevenlabs") as VoiceProvider;
      const updated = await api.setChatTtsPrefs(selectedProfileId, {
        ...ttsOpts,
        provider_voice_id: selectedElVoiceId,
        provider,
        provider_voice_name: selectedElVoice?.name,
      });
      setProfiles((prev) =>
        prev.map((p) => (p.id === updated.id ? { ...p, ...updated } : p)),
      );
      Alert.alert(
        "Đã gắn cho Gọi",
        "Cuộc gọi / chat ký ức sẽ nói bằng bản clone và setting này.",
      );
    } catch (e) {
      Alert.alert(
        "Không gắn được",
        e instanceof Error ? e.message : "Thử lại sau.",
      );
    } finally {
      setBusy(false);
    }
  };

  const pickerTitle =
    openPicker === "voice"
      ? "Bản clone"
      : openPicker === "model"
        ? "TTS Model"
        : openPicker === "profile"
          ? "Voice DNA"
          : openPicker === "emotion"
            ? "Cảm xúc"
            : "";

  const pickerOptions: PickerOption[] = useMemo(() => {
    if (openPicker === "voice") {
      return sortedElVoices.map((v) => {
        const attached =
          selectedProfile?.provider_voice_id === v.voice_id &&
          (selectedProfile.provider === "minimax"
            ? "minimax"
            : "elevenlabs") === v.provider;
        return {
          id: cloneKey(v),
          title: v.name,
          subtitle: [
            voiceProviderLabel(v.provider),
            formatElVoiceWhen(v),
            attached ? "đang gắn" : null,
          ]
            .filter(Boolean)
            .join(" · "),
        };
      });
    }
    if (openPicker === "model") {
      return modelOptions.map((m) => ({
        id: m.id,
        title: m.label,
        subtitle: m.hint,
      }));
    }
    if (openPicker === "profile") {
      return profiles.map((p) => ({
        id: p.id,
        title: p.display_name,
        subtitle: `${p.subject_kind === "heritage" ? "Ký ức" : "Giọng của tôi"} · ${p.status}`,
      }));
    }
    if (openPicker === "emotion") {
      return emotionOptions.map((e) => ({
        id: e.id,
        title: e.label,
        subtitle: e.hint,
      }));
    }
    return [];
  }, [
    openPicker,
    sortedElVoices,
    selectedProfile?.provider_voice_id,
    selectedProfile?.provider,
    profiles,
    modelOptions,
    emotionOptions,
  ]);

  const pickerSelectedId =
    openPicker === "voice"
      ? selectedCloneKey
      : openPicker === "model"
        ? modelId
        : openPicker === "profile"
          ? selectedProfileId
          : openPicker === "emotion"
            ? emotion
            : null;

  const onPick = (id: string) => {
    if (openPicker === "voice") selectElVoice(id);
    else if (openPicker === "model") setModelId(id as VoiceTtsModelId);
    else if (openPicker === "profile") selectProfile(id);
    else if (openPicker === "emotion") patchCustom({ emotion: id });
    setOpenPicker(null);
  };

  if (loading || (selectedProfileId && !settingsReady)) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }

  if (!profiles.length) {
    return (
      <View style={styles.centerPad}>
        <Text style={styles.emptyTitle}>Chưa có hồ sơ Forever</Text>
        <Text style={styles.emptySub}>
          Tạo Voice DNA và Clone trước, rồi quay lại tạo giọng từ text.
        </Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 88 : 0}
    >
      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.root}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        {profiles.length > 1 ? (
          <DropdownField
            label="Voice DNA"
            value={selectedProfile?.display_name || ""}
            placeholder="Chọn Voice DNA…"
            hint={
              selectedProfile
                ? `${selectedProfile.subject_kind === "heritage" ? "Ký ức" : "Giọng của tôi"} · ${selectedProfile.status}`
                : undefined
            }
            onPress={() => setOpenPicker("profile")}
          />
        ) : null}

        <DropdownField
          label="Bản clone"
          value={selectedElVoice?.name || ""}
          placeholder="Chọn bản clone…"
          hint={
            selectedElVoice
              ? `${voiceProviderLabel(selectedElVoice.provider)} · ${formatElVoiceWhen(selectedElVoice)}`
              : "Chưa có bản clone"
          }
          onPress={() => setOpenPicker("voice")}
          disabled={!sortedElVoices.length}
        />
        {!sortedElVoices.length ? (
          <Text style={styles.helper}>
            Clone trên hub để tạo bản mới (mới nhất hiện trên cùng).
          </Text>
        ) : (
          <Pressable
            onPress={() => {
              const profile = profiles.find((p) => p.id === selectedProfileId) ?? null;
              void loadElVoicesForProfile(profile);
            }}
            disabled={busy || !selectedProfileId}
          >
            <Text style={styles.refresh}>Làm mới danh sách</Text>
          </Pressable>
        )}

        <DropdownField
          label="TTS Model"
          value={selectedModel.label}
          placeholder="Chọn model…"
          hint={selectedModel.hint}
          onPress={() => setOpenPicker("model")}
        />

        <Text style={styles.section}>Phong cách</Text>
        <View style={styles.card}>
          <Text style={styles.helper}>
            {isMinimax
              ? "Gần mẫu = chất giọng dày hơn. Bình thản = cảm xúc calm, đọc mềm hơn. Nghe trẻ hơn mẫu → mở Tùy chỉnh, hạ Cao độ."
              : "Giọng nghe trẻ hơn mẫu → tăng Similarity, bật Speaker Boost, hoặc chọn lại mẫu trầm hơn rồi clone."}
          </Text>
          <View style={styles.presetRow}>
            <Pressable
              style={[styles.chip, preset === "similar" && styles.chipActive]}
              onPress={() => applyPreset("similar")}
            >
              <Text
                style={[
                  styles.chipText,
                  preset === "similar" && styles.chipTextActive,
                ]}
              >
                {isMinimax ? "Gần mẫu" : "Gần giọng"}
              </Text>
            </Pressable>
            <Pressable
              style={[styles.chip, preset === "stable" && styles.chipActive]}
              onPress={() => applyPreset("stable")}
            >
              <Text
                style={[
                  styles.chipText,
                  preset === "stable" && styles.chipTextActive,
                ]}
              >
                {isMinimax ? "Bình thản" : "Ổn định"}
              </Text>
            </Pressable>
            <Pressable
              style={[styles.chip, preset === null && styles.chipActive]}
              onPress={selectCustom}
            >
              <Text
                style={[
                  styles.chipText,
                  preset === null && styles.chipTextActive,
                ]}
              >
                Tùy chỉnh
              </Text>
            </Pressable>
          </View>
          {isMinimax && preset === "similar" && !advancedOpen ? (
            <Text style={styles.presetSummary}>Đang dùng: Chất giọng −20</Text>
          ) : null}
          {isMinimax && preset === "stable" && !advancedOpen ? (
            <Text style={styles.presetSummary}>
              Đang dùng: Cảm xúc Bình thản · Lực đọc +20
            </Text>
          ) : null}

          {advancedOpen ? (
            <View style={styles.advancedPanel}>
              <Text style={styles.advancedHeading}>Nâng cao</Text>
              <TtsStepper
                label="Tốc độ"
                hint="Thấp = chậm hơn · 90 gần nhịp nói tự nhiên"
                value={toUnit(speed)}
                min={SPEED_UNIT_MIN}
                max={SPEED_UNIT_MAX}
                clamp={clampSpeedUnit}
                onChange={(next) => patchCustom({ speed: fromSpeedUnit(next) })}
              />
              {isMinimax ? (
                <>
                  <View style={styles.advancedRow}>
                    <View style={styles.advancedCopy}>
                      <Text style={styles.advancedLabel}>Cảm xúc</Text>
                      <Text style={styles.advancedHint}>
                        Tự động = model tự đọc cảm xúc từ câu chữ
                      </Text>
                    </View>
                    <Pressable
                      style={styles.pickerValue}
                      onPress={() => setOpenPicker("emotion")}
                    >
                      <Text style={styles.pickerValueText}>
                        {minimaxEmotionLabel(emotion)}
                      </Text>
                      <Text style={styles.pickerValueChevron}>▾</Text>
                    </Pressable>
                  </View>
                  <TtsStepper
                    label="Cao độ"
                    hint="Đơn vị nửa cung · Âm = trầm xuống (bớt cảm giác trẻ)"
                    value={pitch}
                    min={PITCH_MIN}
                    max={PITCH_MAX}
                    step={PITCH_STEP}
                    clamp={clampPitch}
                    format={formatSignedLabel}
                    onChange={(next) => patchCustom({ pitch: next })}
                  />
                  <TtsStepper
                    label="Chất giọng"
                    hint="Âm = dày, ấm hơn · Dương = trong, sáng hơn"
                    value={timbre}
                    min={MODIFY_MIN}
                    max={MODIFY_MAX}
                    step={MODIFY_STEP}
                    clamp={clampModify}
                    format={formatSignedLabel}
                    onChange={(next) => patchCustom({ timbre: next })}
                  />
                  <TtsStepper
                    label="Lực đọc"
                    hint="Âm = dứt khoát, mạnh hơn · Dương = nhẹ, dịu hơn"
                    value={intensity}
                    min={MODIFY_MIN}
                    max={MODIFY_MAX}
                    step={MODIFY_STEP}
                    clamp={clampModify}
                    format={formatSignedLabel}
                    onChange={(next) => patchCustom({ intensity: next })}
                  />
                </>
              ) : (
                <>
                  <TtsStepper
                    label="Similarity"
                    hint="Cao = sát chất giọng mẫu hơn (giảm cảm giác trẻ hóa)"
                    value={toUnit(similarityBoost)}
                    min={UNIT_MIN}
                    max={UNIT_MAX}
                    onChange={(next) =>
                      patchCustom({ similarityBoost: fromUnit(next) })
                    }
                  />
                  <TtsStepper
                    label="Stability"
                    hint="Cao = đều, trầm ổn hơn · Thấp = biểu cảm"
                    value={toUnit(stability)}
                    min={UNIT_MIN}
                    max={UNIT_MAX}
                    onChange={(next) =>
                      patchCustom({ stability: fromUnit(next) })
                    }
                  />
                  <TtsStepper
                    label="Style"
                    hint="Nhẹ = giữ đúng mẫu · Cao = phóng đại cách nói (dễ lệch)"
                    value={toUnit(styleExaggeration)}
                    min={UNIT_MIN}
                    max={UNIT_MAX}
                    onChange={(next) => patchCustom({ style: fromUnit(next) })}
                  />
                </>
              )}
              <View style={styles.advancedRow}>
                <View style={styles.advancedCopy}>
                  <Text style={styles.advancedLabel}>Nghỉ giữa câu</Text>
                  <Text style={styles.advancedHint}>
                    Thêm khoảng nghỉ nhẹ giữa các câu
                  </Text>
                </View>
                <Switch
                  value={lengthenPauses}
                  onValueChange={(next) => patchCustom({ lengthenPauses: next })}
                  trackColor={{ false: colors.line, true: colors.brandSoft }}
                  thumbColor={lengthenPauses ? colors.brand : "#f4f3f4"}
                />
              </View>
              {isMinimax ? null : (
                <View style={styles.advancedRow}>
                  <View style={styles.advancedCopy}>
                    <Text style={styles.advancedLabel}>Speaker Boost</Text>
                    <Text style={styles.advancedHint}>
                      Bám sát giọng gốc hơn — nên bật khi nghe trẻ hơn mẫu
                    </Text>
                  </View>
                  <Switch
                    value={speakerBoost}
                    onValueChange={(next) => patchCustom({ speakerBoost: next })}
                    trackColor={{ false: colors.line, true: colors.brandSoft }}
                    thumbColor={speakerBoost ? colors.brand : "#f4f3f4"}
                  />
                </View>
              )}
              <Text style={styles.advancedNote}>
                Thiết lập được ghi nhớ riêng cho từng giọng. Mỗi dịch vụ có bộ
                tuỳ chỉnh riêng — đổi bản clone sẽ hiện đúng phần{" "}
                {voiceProviderLabel(provider)} nhận được.
              </Text>
            </View>
          ) : null}
        </View>
      </ScrollView>

      <View
        style={[
          styles.composer,
          {
            // Home-indicator padding only when the keyboard is closed; with the
            // keyboard up, KeyboardAvoidingView already owns the bottom inset.
            paddingBottom: keyboardOpen ? 10 : Math.max(insets.bottom, 12),
          },
        ]}
      >
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={onChangeDraftText}
          placeholder="Nhập câu để tạo giọng…"
          placeholderTextColor={colors.inkSoft}
          multiline
        />
        <Pressable
          style={[
            styles.btn,
            (busy || !selectedElVoiceId || !text.trim()) && styles.disabled,
          ]}
          onPress={createAndPlay}
          disabled={(busy && !previewing) || !selectedElVoiceId || !text.trim()}
        >
          <Text style={styles.btnText}>
            {!previewing ? "Tạo & nghe" : paused ? "Tiếp tục" : "Tạm dừng"}
          </Text>
        </Pressable>
        <Pressable
          style={[
            styles.btnSecondary,
            (busy || !selectedElVoiceId) && styles.disabled,
          ]}
          onPress={() => void applySetForCall()}
          disabled={busy || !selectedElVoiceId}
        >
          <Text style={styles.btnSecondaryText}>Dùng cho Gọi</Text>
        </Pressable>
        <Pressable
          onPress={() => {
            if (!spaceId) return;
            const q = new URLSearchParams();
            if (selectedProfileId) q.set("voiceId", selectedProfileId);
            if (selectedElVoiceId) q.set("providerVoiceId", selectedElVoiceId);
            const qs = q.toString();
            router.push(`/voice/${spaceId}/renders${qs ? `?${qs}` : ""}`);
          }}
          hitSlop={6}
        >
          <Text style={styles.link}>Nghe các bản TTS của set này</Text>
        </Pressable>
      </View>

      <Modal
        visible={openPicker != null}
        transparent
        animationType="fade"
        onRequestClose={() => setOpenPicker(null)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setOpenPicker(null)}>
          <Pressable style={styles.modalSheet} onPress={() => undefined}>
            <Text style={styles.modalTitle}>{pickerTitle}</Text>
            <FlatList
              data={pickerOptions}
              keyExtractor={(item) => item.id}
              style={styles.modalList}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => {
                const active = item.id === pickerSelectedId;
                return (
                  <Pressable
                    style={[styles.optionRow, active && styles.optionRowActive]}
                    onPress={() => onPick(item.id)}
                  >
                    <View style={styles.dropdownCopy}>
                      <Text
                        style={[
                          styles.optionTitle,
                          active && styles.optionTitleActive,
                        ]}
                      >
                        {item.title}
                      </Text>
                      {item.subtitle ? (
                        <Text style={styles.optionSub}>{item.subtitle}</Text>
                      ) : null}
                    </View>
                    {active ? <Text style={styles.check}>✓</Text> : null}
                  </Pressable>
                );
              }}
              ListEmptyComponent={
                <Text style={styles.helper}>Không có lựa chọn.</Text>
              }
            />
            <Pressable
              style={styles.modalClose}
              onPress={() => setOpenPicker(null)}
            >
              <Text style={styles.modalCloseText}>Đóng</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = createThemedStyles((colors) => ({
  flex: { flex: 1, backgroundColor: colors.bg },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bg,
  },
  centerPad: {
    flex: 1,
    backgroundColor: colors.bg,
    padding: 24,
    justifyContent: "center",
    gap: 8,
  },
  emptyTitle: {
    fontFamily: fonts.display,
    fontSize: 20,
    color: colors.ink,
  },
  emptySub: { fontSize: 14, lineHeight: 20, color: colors.inkSoft },
  root: { padding: 20, gap: 12, paddingBottom: 24 },
  fieldBlock: { gap: 8 },
  section: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.inkSoft,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  // Flex sibling (not absolute) so ScrollView never sits under it, and
  // KeyboardAvoidingView can lift the whole composer above the keyboard.
  composer: {
    backgroundColor: colors.card,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 8,
  },
  hint: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.inkSoft,
  },
  dropdown: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  dropdownCopy: { flex: 1, gap: 2 },
  dropdownValue: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.ink,
    lineHeight: 20,
  },
  dropdownPlaceholder: { color: colors.inkSoft, fontWeight: "600" },
  dropdownHint: { fontSize: 12, color: colors.inkSoft, lineHeight: 16 },
  chevron: { fontSize: 16, color: colors.inkSoft, fontWeight: "700" },
  helper: { fontSize: 13, color: colors.inkSoft, lineHeight: 18, marginTop: -4 },
  refresh: {
    color: colors.brand,
    fontWeight: "700",
    fontSize: 13,
    marginTop: -4,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 14,
    gap: 10,
  },
  input: {
    minHeight: 72,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    padding: 12,
    fontSize: 16,
    lineHeight: 24,
    color: colors.ink,
    backgroundColor: "#fff",
    fontFamily: fonts.display,
  },
  presetRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: "#fff",
  },
  chipActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipText: { fontSize: 13, fontWeight: "600", color: colors.inkSoft },
  chipTextActive: { color: "#fff" },
  presetSummary: { fontSize: 12, color: colors.inkSoft, lineHeight: 16 },
  advancedPanel: { gap: 12, paddingTop: 4 },
  advancedHeading: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.ink,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingTop: 12,
  },
  advancedRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  advancedCopy: { flex: 1, gap: 2 },
  advancedLabel: { fontSize: 14, fontWeight: "700", color: colors.ink },
  advancedHint: { fontSize: 12, lineHeight: 16, color: colors.inkSoft },
  advancedNote: {
    fontSize: 12,
    lineHeight: 16,
    color: colors.inkSoft,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingTop: 10,
  },
  stepper: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  stepBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  stepBtnDisabled: { opacity: 0.35 },
  stepBtnText: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.brand,
    lineHeight: 20,
  },
  stepValue: {
    minWidth: 44,
    textAlign: "center",
    fontSize: 15,
    fontWeight: "700",
    color: colors.ink,
    fontVariant: ["tabular-nums"],
  },
  pickerValue: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minWidth: 116,
    justifyContent: "flex-end",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: "#fff",
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  pickerValueText: { fontSize: 15, fontWeight: "700", color: colors.ink },
  pickerValueChevron: { fontSize: 13, color: colors.inkSoft },
  btn: {
    backgroundColor: colors.brand,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  btnText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  btnSecondary: {
    backgroundColor: colors.card,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.brand,
  },
  btnSecondaryText: { color: colors.brand, fontWeight: "700", fontSize: 15 },
  link: {
    textAlign: "center",
    color: colors.brand,
    fontWeight: "700",
    fontSize: 14,
    paddingVertical: 4,
  },
  disabled: { opacity: 0.5 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    justifyContent: "flex-end",
  },
  modalSheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    padding: 16,
    paddingBottom: 28,
    maxHeight: "70%",
    gap: 10,
  },
  modalTitle: {
    fontFamily: fonts.display,
    fontSize: 20,
    color: colors.ink,
  },
  modalList: { flexGrow: 0 },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: "#fff",
    marginBottom: 8,
  },
  optionRowActive: {
    borderColor: colors.brand,
    backgroundColor: "#F7F3EE",
  },
  optionTitle: { fontSize: 14, fontWeight: "700", color: colors.ink },
  optionTitleActive: { color: colors.brand },
  optionSub: { fontSize: 12, color: colors.inkSoft, lineHeight: 16 },
  check: { color: colors.brand, fontWeight: "800", fontSize: 16 },
  modalClose: {
    alignItems: "center",
    paddingVertical: 10,
  },
  modalCloseText: { color: colors.inkSoft, fontWeight: "700", fontSize: 15 },
}));
