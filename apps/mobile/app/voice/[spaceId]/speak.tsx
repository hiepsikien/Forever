import {
  ElevenLabsVoice,
  VOICE_TTS_MODELS,
  VoiceProfile,
  type VoiceTtsModelId,
} from "@forever/api-client";
import { useNavigation } from "@react-navigation/native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
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
import { writeCacheAudio } from "@/lib/media";
import { colors, fonts } from "@/lib/theme";

type PickerOption = {
  id: string;
  title: string;
  subtitle?: string;
};

type OpenPicker = "voice" | "model" | "profile" | null;

const TTS_STEP = 0.05;
const SPEED_MIN = 0.7;
const SPEED_MAX = 1.2;
const SPEED_DEFAULT = 0.9;

const PRESET_VALUES = {
  similar: {
    stability: 0.5,
    similarityBoost: 0.95,
    style: 0.15,
    speakerBoost: true,
    speed: SPEED_DEFAULT,
    lengthenPauses: true,
  },
  stable: {
    stability: 0.7,
    similarityBoost: 0.8,
    style: 0.0,
    speakerBoost: true,
    speed: SPEED_DEFAULT,
    lengthenPauses: true,
  },
} as const;

function clampTts(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 100) / 100;
}

function clampSpeed(value: number): number {
  return Math.round(Math.max(SPEED_MIN, Math.min(SPEED_MAX, value)) * 100) / 100;
}

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
  const navigation = useNavigation();
  const router = useRouter();

  const [profiles, setProfiles] = useState<VoiceProfile[]>([]);
  const [elVoices, setElVoices] = useState<ElevenLabsVoice[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(
    voiceIdParam || null,
  );
  const [selectedElVoiceId, setSelectedElVoiceId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("Con nhớ bố lắm.");
  const [modelId, setModelId] = useState<VoiceTtsModelId>("eleven_v3");
  const [preset, setPreset] = useState<"similar" | "stable" | null>("similar");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [stability, setStability] = useState(PRESET_VALUES.similar.stability);
  const [similarityBoost, setSimilarityBoost] = useState(
    PRESET_VALUES.similar.similarityBoost,
  );
  const [styleExaggeration, setStyleExaggeration] = useState(
    PRESET_VALUES.similar.style,
  );
  const [speakerBoost, setSpeakerBoost] = useState(
    PRESET_VALUES.similar.speakerBoost,
  );
  const [speed, setSpeed] = useState(PRESET_VALUES.similar.speed);
  const [lengthenPauses, setLengthenPauses] = useState(
    PRESET_VALUES.similar.lengthenPauses,
  );
  const [busy, setBusy] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [paused, setPaused] = useState(false);
  const [openPicker, setOpenPicker] = useState<OpenPicker>(null);

  useLayoutEffect(() => {
    navigation.setOptions({ title: "Tạo giọng từ text" });
  }, [navigation]);

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
    try {
      const v = await api.listVoices(spaceId);
      setProfiles(v.voices);

      const nextProfile =
        (voiceIdParam && v.voices.find((x) => x.id === voiceIdParam)) ||
        v.voices.find((x) => x.status === "ready") ||
        v.voices[0] ||
        null;
      setSelectedProfileId(nextProfile?.id ?? null);
      await loadElVoicesForProfile(nextProfile);
    } catch (e) {
      Alert.alert("Lỗi", e instanceof Error ? e.message : "Không tải voices.");
    } finally {
      setLoading(false);
    }
  }, [api, spaceId, voiceIdParam, loadElVoicesForProfile]);

  useEffect(() => {
    void load();
  }, [load]);

  const applyPreset = (next: "similar" | "stable") => {
    const values = PRESET_VALUES[next];
    setPreset(next);
    setStability(values.stability);
    setSimilarityBoost(values.similarityBoost);
    setStyleExaggeration(values.style);
    setSpeakerBoost(values.speakerBoost);
    setSpeed(values.speed);
    setLengthenPauses(values.lengthenPauses);
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
    setSelectedProfileId(id);
    const profile = profiles.find((p) => p.id === id) ?? null;
    void loadElVoicesForProfile(profile);
  };

  const selectElVoice = (id: string) => {
    if (id === selectedElVoiceId) return;
    void stopActivePlayback();
    setPreviewing(false);
    setPaused(false);
    setSelectedElVoiceId(id);
  };

  const preview = async () => {
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
      const bytes = await api.synthesizeVoiceTts(
        selectedProfileId,
        text.trim(),
        ttsOpts,
      );
      const uri = await writeCacheAudio(bytes, `speak-${Date.now()}`);
      setPreviewing(true);
      setPaused(false);
      await playLocalAudio(uri, () => {
        setPreviewing(false);
        setPaused(false);
      });
    } catch (e) {
      setPreviewing(false);
      Alert.alert("TTS lỗi", e instanceof Error ? e.message : "Không phát được.");
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!selectedProfileId || !selectedElVoiceId || !text.trim() || busy) return;
    setBusy(true);
    try {
      await stopActivePlayback();
      setPreviewing(false);
      await api.saveVoiceRender(selectedProfileId, text.trim(), ttsOpts);
      Alert.alert("Đã lưu", "Bản TTS đã vào lịch sử.", [
        {
          text: "Xem bản đã tạo",
          onPress: () =>
            spaceId &&
            router.push(
              `/voice/${spaceId}/renders?voiceId=${selectedProfileId}`,
            ),
        },
        { text: "OK" },
      ]);
    } catch (e) {
      Alert.alert("Lỗi", e instanceof Error ? e.message : "Không lưu được.");
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

  if (loading) {
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
            {preset === null ? (
              <View style={styles.customChip}>
                <Text style={styles.customChipText}>Tùy chỉnh</Text>
              </View>
            ) : null}
          </View>

          <Pressable
            style={styles.advancedToggle}
            onPress={() => setAdvancedOpen((v) => !v)}
            hitSlop={4}
          >
            <Text style={styles.advancedToggleText}>Nâng cao</Text>
            <Text style={styles.advancedChevron}>{advancedOpen ? "▴" : "▾"}</Text>
          </Pressable>

          {advancedOpen ? (
            <View style={styles.advancedPanel}>
              <TtsStepper
                label="Tốc độ"
                hint="Thấp = chậm hơn · 0.90 gần nhịp nói tự nhiên"
                value={speed}
                min={SPEED_MIN}
                max={SPEED_MAX}
                clamp={clampSpeed}
                onChange={(next) => {
                  setPreset(null);
                  setSpeed(next);
                }}
              />
              <TtsStepper
                label="Similarity"
                hint="Cao = sát chất giọng mẫu hơn (giảm cảm giác trẻ hóa)"
                value={similarityBoost}
                onChange={(next) => {
                  setPreset(null);
                  setSimilarityBoost(next);
                }}
              />
              <TtsStepper
                label="Stability"
                hint="Cao = đều, trầm ổn hơn · Thấp = biểu cảm"
                value={stability}
                onChange={(next) => {
                  setPreset(null);
                  setStability(next);
                }}
              />
              <TtsStepper
                label="Style"
                hint="Nhẹ = giữ đúng mẫu · Cao = phóng đại cách nói (dễ lệch)"
                value={styleExaggeration}
                onChange={(next) => {
                  setPreset(null);
                  setStyleExaggeration(next);
                }}
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
                  onValueChange={(next) => {
                    setPreset(null);
                    setLengthenPauses(next);
                  }}
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
                  onValueChange={(next) => {
                    setPreset(null);
                    setSpeakerBoost(next);
                  }}
                  trackColor={{ false: colors.line, true: colors.brandSoft }}
                  thumbColor={speakerBoost ? colors.brand : "#f4f3f4"}
                />
              </View>
            </View>
          ) : null}
        </View>

        <Text style={styles.section}>Nội dung</Text>
        <View style={styles.card}>
          <TextInput
            style={styles.input}
            value={text}
            onChangeText={setText}
            placeholder="Nhập câu để tạo giọng…"
            placeholderTextColor={colors.inkSoft}
            multiline
          />
        </View>

        <Text style={styles.section}>Nghe & lưu</Text>
        <View style={styles.card}>
          <Pressable
            style={[
              styles.btn,
              (busy || !selectedElVoiceId) && styles.disabled,
            ]}
            onPress={preview}
            disabled={(busy && !previewing) || !selectedElVoiceId}
          >
            <Text style={styles.btnText}>
              {!previewing ? "Nghe thử" : paused ? "Tiếp tục" : "Tạm dừng"}
            </Text>
          </Pressable>
          <Pressable
            style={[
              styles.btnGhost,
              (busy || !selectedElVoiceId) && styles.disabled,
            ]}
            onPress={save}
            disabled={busy || !selectedElVoiceId}
          >
            <Text style={styles.btnGhostText}>Lưu bản TTS</Text>
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
  customChip: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: "#f7f3ee",
  },
  customChipText: { fontSize: 12, fontWeight: "600", color: colors.inkSoft },
  advancedToggle: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: 4,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    marginTop: 2,
  },
  advancedToggleText: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.ink,
  },
  advancedChevron: {
    fontSize: 14,
    color: colors.inkSoft,
    fontWeight: "700",
  },
  advancedPanel: { gap: 12, paddingTop: 4 },
  advancedRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  advancedCopy: { flex: 1, gap: 2 },
  advancedLabel: { fontSize: 14, fontWeight: "700", color: colors.ink },
  advancedHint: { fontSize: 12, lineHeight: 16, color: colors.inkSoft },
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
