import {
  ElevenLabsVoice,
  VOICE_TTS_MODELS,
  VoiceProfile,
  VoiceRender,
  type VoiceTtsModelId,
} from "@forever/api-client";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";

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
  prepareAudioExport,
  shareLocalAudio,
} from "@/lib/media";
import { useSpaceScreenOptions } from "@/lib/spaceHeader";
import { colors, fonts } from "@/lib/theme";
import {
  activeTtsValues,
  clampSpeed,
  clampTts,
  DEFAULT_DRAFT_TEXT,
  DEFAULT_TTS_PROFILE_SETTINGS,
  loadTtsSettings,
  saveTtsSettings,
  SPEED_MAX,
  SPEED_MIN,
  TTS_STEP,
  type TtsPresetName,
  type TtsProfileSettings,
  type TtsValues,
} from "@/lib/ttsSettings";

type PickerOption = {
  id: string;
  title: string;
  subtitle?: string;
};

type OpenPicker = "voice" | "model" | "profile" | null;

function formatTtsLabel(value: number): string {
  return value.toFixed(2);
}

function TtsStepper({
  label,
  hint,
  value,
  onChange,
  min = 0,
  max = 1,
  clamp = clampTts,
}: {
  label: string;
  hint: string;
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  clamp?: (value: number) => number;
}) {
  const dec = () => onChange(clamp(value - TTS_STEP));
  const inc = () => onChange(clamp(value + TTS_STEP));

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
        <Text style={styles.stepValue}>{formatTtsLabel(value)}</Text>
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

  const [profiles, setProfiles] = useState<VoiceProfile[]>([]);
  const [elVoices, setElVoices] = useState<ElevenLabsVoice[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(
    voiceIdParam || null,
  );
  const [selectedElVoiceId, setSelectedElVoiceId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState(DEFAULT_DRAFT_TEXT);
  const [modelId, setModelId] = useState<VoiceTtsModelId>("eleven_v3");
  const [preset, setPreset] = useState<TtsPresetName | null>(
    DEFAULT_TTS_PROFILE_SETTINGS.mode === "custom"
      ? null
      : DEFAULT_TTS_PROFILE_SETTINGS.mode,
  );
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [stability, setStability] = useState(
    activeTtsValues(DEFAULT_TTS_PROFILE_SETTINGS).stability,
  );
  const [similarityBoost, setSimilarityBoost] = useState(
    activeTtsValues(DEFAULT_TTS_PROFILE_SETTINGS).similarityBoost,
  );
  const [styleExaggeration, setStyleExaggeration] = useState(
    activeTtsValues(DEFAULT_TTS_PROFILE_SETTINGS).style,
  );
  const [speakerBoost, setSpeakerBoost] = useState(
    activeTtsValues(DEFAULT_TTS_PROFILE_SETTINGS).speakerBoost,
  );
  const [speed, setSpeed] = useState(
    activeTtsValues(DEFAULT_TTS_PROFILE_SETTINGS).speed,
  );
  const [lengthenPauses, setLengthenPauses] = useState(
    activeTtsValues(DEFAULT_TTS_PROFILE_SETTINGS).lengthenPauses,
  );
  const [busy, setBusy] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [paused, setPaused] = useState(false);
  const [lastRender, setLastRender] = useState<VoiceRender | null>(null);
  const [openPicker, setOpenPicker] = useState<OpenPicker>(null);
  const [settingsReady, setSettingsReady] = useState(false);

  const selectedProfileIdRef = useRef<string | null>(selectedProfileId);
  selectedProfileIdRef.current = selectedProfileId;
  const textRef = useRef(text);
  textRef.current = text;

  const settingsRef = useRef<TtsProfileSettings>(DEFAULT_TTS_PROFILE_SETTINGS);

  const applyValues = useCallback((values: TtsValues, mode: TtsProfileSettings["mode"]) => {
    setPreset(mode === "custom" ? null : mode);
    setStability(values.stability);
    setSimilarityBoost(values.similarityBoost);
    setStyleExaggeration(values.style);
    setSpeakerBoost(values.speakerBoost);
    setSpeed(values.speed);
    setLengthenPauses(values.lengthenPauses);
  }, []);

  const commitProfileSettings = useCallback(
    (patch: Partial<TtsProfileSettings> & Pick<TtsProfileSettings, "mode" | "custom">) => {
      const next: TtsProfileSettings = {
        ...settingsRef.current,
        ...patch,
        draftText: patch.draftText ?? settingsRef.current.draftText ?? textRef.current,
      };
      settingsRef.current = next;
      applyValues(activeTtsValues(next), next.mode);
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
      applyValues(activeTtsValues(saved), saved.mode);
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
    () => sortedElVoices.find((v) => v.voice_id === selectedElVoiceId) ?? null,
    [sortedElVoices, selectedElVoiceId],
  );
  const selectedModel = useMemo(
    () => VOICE_TTS_MODELS.find((m) => m.id === modelId) ?? VOICE_TTS_MODELS[0],
    [modelId],
  );

  const pickPreferredElVoice = useCallback(
    (profile: VoiceProfile | null, sorted: ElevenLabsVoice[]) =>
      (profile?.provider_voice_id &&
        sorted.find((x) => x.voice_id === profile.provider_voice_id)?.voice_id) ||
      sorted.find((x) =>
        profile?.display_name
          ? x.name
              .toLowerCase()
              .includes(profile.display_name.split("(")[0].trim().toLowerCase())
          : false,
      )?.voice_id ||
      sorted[0]?.voice_id ||
      profile?.provider_voice_id ||
      null,
    [],
  );

  const loadElVoicesForProfile = useCallback(
    async (profile: VoiceProfile | null) => {
      if (!spaceId || !profile) {
        setElVoices([]);
        setSelectedElVoiceId(null);
        return;
      }
      const el = await api.listElevenLabsVoices(spaceId, {
        clonedOnly: true,
        voiceId: profile.id,
      });
      const sorted = [...el.voices].sort(
        (a, b) => elVoiceSortKey(b) - elVoiceSortKey(a),
      );
      setElVoices(sorted);
      setSelectedElVoiceId((prev) =>
        prev && sorted.some((v) => v.voice_id === prev)
          ? prev
          : pickPreferredElVoice(profile, sorted),
      );
    },
    [api, spaceId, pickPreferredElVoice],
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
    commitProfileSettings({
      mode: "custom",
      custom: settingsRef.current.custom,
    });
  };

  const patchCustom = (patch: Partial<TtsValues>) => {
    commitProfileSettings({
      mode: "custom",
      custom: { ...settingsRef.current.custom, ...patch },
    });
  };

  const ttsOpts = useMemo(
    () => ({
      model_id: modelId,
      provider_voice_id: selectedElVoiceId || undefined,
      provider_voice_name: selectedElVoice?.name,
      stability,
      similarity_boost: similarityBoost,
      style: styleExaggeration,
      use_speaker_boost: speakerBoost,
      speed,
      lengthen_pauses: lengthenPauses,
    }),
    [
      modelId,
      selectedElVoiceId,
      selectedElVoice?.name,
      stability,
      similarityBoost,
      styleExaggeration,
      speakerBoost,
      speed,
      lengthenPauses,
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

  const selectElVoice = (id: string) => {
    if (id === selectedElVoiceId) return;
    void stopActivePlayback();
    setPreviewing(false);
    setPaused(false);
    setSelectedElVoiceId(id);
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
      setLastRender(render);
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

  const shareLast = async () => {
    if (!lastRender || busy) return;
    setBusy(true);
    try {
      const url = api.voiceRenderMediaUrl(
        lastRender.voice_profile_id,
        lastRender.id,
      );
      const cached = await fetchAuthedMediaUri(
        url,
        `share-render-${lastRender.id}`,
        lastRender.media_mime,
      );
      const voiceName = selectedProfile?.display_name || "Voice-DNA";
      const stamp = lastRender.created_at.slice(0, 16).replace("T", "-");
      const base = `Forever-TTS-${voiceName}-${stamp}-${lastRender.id.slice(-6)}`;
      const uri = await prepareAudioExport(cached, base, lastRender.media_mime);
      await shareLocalAudio(uri, {
        mimeType: lastRender.media_mime,
        dialogTitle: base,
      });
    } catch (e) {
      Alert.alert("Lỗi", e instanceof Error ? e.message : "Không chia sẻ được.");
    } finally {
      setBusy(false);
    }
  };

  const pickerTitle =
    openPicker === "voice"
      ? "Voice DNA"
      : openPicker === "model"
        ? "TTS Model"
        : openPicker === "profile"
          ? "Hồ sơ Forever"
          : "";

  const pickerOptions: PickerOption[] = useMemo(() => {
    if (openPicker === "voice") {
      return sortedElVoices.map((v) => ({
        id: v.voice_id,
        title: v.name,
        subtitle:
          formatElVoiceWhen(v) +
          (selectedProfile?.provider_voice_id === v.voice_id
            ? " · đang gắn"
            : ""),
      }));
    }
    if (openPicker === "model") {
      return VOICE_TTS_MODELS.map((m) => ({
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
    return [];
  }, [openPicker, sortedElVoices, selectedProfile?.provider_voice_id, profiles]);

  const pickerSelectedId =
    openPicker === "voice"
      ? selectedElVoiceId
      : openPicker === "model"
        ? modelId
        : openPicker === "profile"
          ? selectedProfileId
          : null;

  const onPick = (id: string) => {
    if (openPicker === "voice") selectElVoice(id);
    else if (openPicker === "model") setModelId(id as VoiceTtsModelId);
    else if (openPicker === "profile") selectProfile(id);
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
      keyboardVerticalOffset={88}
    >
      <ScrollView
        contentContainerStyle={styles.root}
        keyboardShouldPersistTaps="handled"
      >
        {profiles.length > 1 ? (
          <DropdownField
            label="Hồ sơ Forever"
            value={selectedProfile?.display_name || ""}
            placeholder="Chọn hồ sơ…"
            hint={
              selectedProfile
                ? `${selectedProfile.subject_kind === "heritage" ? "Ký ức" : "Giọng của tôi"} · ${selectedProfile.status}`
                : undefined
            }
            onPress={() => setOpenPicker("profile")}
          />
        ) : null}

        <DropdownField
          label="Voice DNA"
          value={selectedElVoice?.name || ""}
          placeholder="Chọn Voice DNA…"
          hint={
            selectedElVoice
              ? formatElVoiceWhen(selectedElVoice)
              : "Chưa có clone trên ElevenLabs"
          }
          onPress={() => setOpenPicker("voice")}
          disabled={!sortedElVoices.length}
        />
        {!sortedElVoices.length ? (
          <Text style={styles.helper}>
            Clone Voice DNA trên hub để tạo bản mới (mới nhất hiện trên cùng).
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
            Không có chỉnh tuổi/pitch riêng. Giọng nghe trẻ hơn mẫu → tăng
            Similarity, bật Speaker Boost; nếu vẫn lệch thì chọn lại mẫu trầm hơn
            rồi clone lại.
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
                Gần giọng
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
                Ổn định
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

          {advancedOpen ? (
            <View style={styles.advancedPanel}>
              <Text style={styles.advancedHeading}>Nâng cao</Text>
              <TtsStepper
                label="Tốc độ"
                hint="Thấp = chậm hơn · 0.90 gần nhịp nói tự nhiên"
                value={speed}
                min={SPEED_MIN}
                max={SPEED_MAX}
                clamp={clampSpeed}
                onChange={(next) => patchCustom({ speed: next })}
              />
              <TtsStepper
                label="Similarity"
                hint="Cao = sát chất giọng mẫu hơn (giảm cảm giác trẻ hóa)"
                value={similarityBoost}
                onChange={(next) => patchCustom({ similarityBoost: next })}
              />
              <TtsStepper
                label="Stability"
                hint="Cao = đều, trầm ổn hơn · Thấp = biểu cảm"
                value={stability}
                onChange={(next) => patchCustom({ stability: next })}
              />
              <TtsStepper
                label="Style"
                hint="Nhẹ = giữ đúng mẫu · Cao = phóng đại cách nói (dễ lệch)"
                value={styleExaggeration}
                onChange={(next) => patchCustom({ style: next })}
              />
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
              <Text style={styles.advancedNote}>
                Thiết lập được ghi nhớ riêng cho từng giọng.
              </Text>
            </View>
          ) : null}
        </View>

        <Text style={styles.section}>Nội dung</Text>
        <View style={styles.card}>
          <TextInput
            style={styles.input}
            value={text}
            onChangeText={onChangeDraftText}
            placeholder="Nhập câu để tạo giọng…"
            placeholderTextColor={colors.inkSoft}
            multiline
          />
        </View>

        <Text style={styles.section}>Tạo giọng</Text>
        <View style={styles.card}>
          <Text style={styles.hint}>
            Mỗi lần tạo đều lưu tự động vào Bản đã tạo.
          </Text>
          <Pressable
            style={[
              styles.btn,
              (busy || !selectedElVoiceId) && styles.disabled,
            ]}
            onPress={createAndPlay}
            disabled={(busy && !previewing) || !selectedElVoiceId}
          >
            <Text style={styles.btnText}>
              {!previewing ? "Tạo & nghe" : paused ? "Tiếp tục" : "Tạm dừng"}
            </Text>
          </Pressable>
          <Pressable
            style={[
              styles.btnGhost,
              (busy || !lastRender) && styles.disabled,
            ]}
            onPress={shareLast}
            disabled={busy || !lastRender}
          >
            <Text style={styles.btnGhostText}>Chia sẻ</Text>
          </Pressable>
          <Pressable
            onPress={() =>
              spaceId &&
              router.push(
                `/voice/${spaceId}/renders${
                  selectedProfileId ? `?voiceId=${selectedProfileId}` : ""
                }`,
              )
            }
          >
            <Text style={styles.link}>Xem bản đã tạo</Text>
          </Pressable>
        </View>
      </ScrollView>

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

const styles = StyleSheet.create({
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
  root: { padding: 20, gap: 12, paddingBottom: 40 },
  fieldBlock: { gap: 8 },
  section: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.inkSoft,
    textTransform: "uppercase",
    letterSpacing: 0.4,
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
    minHeight: 120,
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
  btn: {
    backgroundColor: colors.brand,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  btnText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  btnGhost: {
    borderWidth: 1,
    borderColor: colors.brand,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  btnGhostText: { color: colors.brand, fontWeight: "700", fontSize: 15 },
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
});
