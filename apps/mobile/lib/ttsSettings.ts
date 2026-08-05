import AsyncStorage from "@react-native-async-storage/async-storage";

/** Every numeric TTS stepper advances by 1 in its displayed unit. */
export const TTS_STEP = 1;
/** Speed is stored 0.7–1.2, shown as 70–120 so step 1 still means one tick. */
export const SPEED_MIN = 0.7;
export const SPEED_MAX = 1.2;
export const SPEED_DEFAULT = 0.9;
export const SPEED_UNIT_MIN = 70;
export const SPEED_UNIT_MAX = 120;
/** ElevenLabs 0–1 knobs, shown as 0–100. */
export const UNIT_MIN = 0;
export const UNIT_MAX = 100;

/** MiniMax `voice_setting.pitch`, in semitones. */
export const PITCH_MIN = -12;
export const PITCH_MAX = 12;
export const PITCH_STEP = 1;
/** MiniMax `voice_modify` sliders. */
export const MODIFY_MIN = -100;
export const MODIFY_MAX = 100;
export const MODIFY_STEP = 1;

export const EMOTION_AUTO = "auto";

export type TtsProvider = "elevenlabs" | "minimax";
export type TtsPresetName = "similar" | "stable";
export type TtsMode = TtsPresetName | "custom";

/**
 * One flat shape for both vendors. A profile can hold clones on either account,
 * so keeping a single record lets the steward flip provider without losing the
 * tweaks they made on the other side; the server drops whichever half does not
 * apply to the provider that actually renders.
 */
export type TtsValues = {
  /** Shared. */
  speed: number;
  lengthenPauses: boolean;
  /** ElevenLabs only. */
  stability: number;
  similarityBoost: number;
  style: number;
  speakerBoost: boolean;
  /** MiniMax only. */
  emotion: string;
  pitch: number;
  intensity: number;
  timbre: number;
};

/** Per-profile: which chip is active + custom values kept separately from presets. */
export type TtsProfileSettings = {
  mode: TtsMode;
  custom: TtsValues;
  /** Last TTS input text for this Voice DNA profile. */
  draftText?: string;
};

export const DEFAULT_DRAFT_TEXT = "Con nhớ bố lắm.";

const SHARED = { speed: SPEED_DEFAULT, lengthenPauses: true };
/** MiniMax knobs at rest: nothing extra is sent to the vendor. */
const MINIMAX_NEUTRAL = {
  emotion: EMOTION_AUTO,
  pitch: 0,
  intensity: 0,
  timbre: 0,
};
/** ElevenLabs knobs at rest, reused so MiniMax presets stay readable. */
const ELEVENLABS_NEUTRAL = {
  stability: 0.5,
  similarityBoost: 0.95,
  style: 0.15,
  speakerBoost: true,
};

/**
 * The two presets mean the same thing on both vendors — stay close to the
 * sample, or read evenly — but the parameters that get there differ, because
 * MiniMax has no counterpart to stability / similarity / speaker boost.
 */
export const PRESET_VALUES: Record<
  TtsProvider,
  Record<TtsPresetName, TtsValues>
> = {
  elevenlabs: {
    similar: {
      ...SHARED,
      ...MINIMAX_NEUTRAL,
      stability: 0.5,
      similarityBoost: 0.95,
      style: 0.15,
      speakerBoost: true,
    },
    stable: {
      ...SHARED,
      ...MINIMAX_NEUTRAL,
      stability: 0.7,
      similarityBoost: 0.8,
      style: 0.0,
      speakerBoost: true,
    },
  },
  minimax: {
    // Fuller timbre is the closest MiniMax has to "less thin than the sample",
    // which is what stewards reach for when a clone sounds too young.
    similar: {
      ...SHARED,
      ...ELEVENLABS_NEUTRAL,
      ...MINIMAX_NEUTRAL,
      timbre: -20,
    },
    // A stated calm mood plus a softer delivery, instead of MiniMax guessing
    // the mood sentence by sentence.
    stable: {
      ...SHARED,
      ...ELEVENLABS_NEUTRAL,
      ...MINIMAX_NEUTRAL,
      emotion: "calm",
      intensity: 20,
    },
  },
};

export const DEFAULT_CUSTOM_VALUES: TtsValues = {
  ...PRESET_VALUES.elevenlabs.similar,
};

export const DEFAULT_TTS_PROFILE_SETTINGS: TtsProfileSettings = {
  mode: "similar",
  custom: DEFAULT_CUSTOM_VALUES,
};

export function activeTtsValues(
  settings: TtsProfileSettings,
  provider: TtsProvider,
): TtsValues {
  return settings.mode === "custom"
    ? settings.custom
    : PRESET_VALUES[provider][settings.mode];
}

export function clampTts(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 100) / 100;
}

export function clampSpeed(value: number): number {
  return Math.round(Math.max(SPEED_MIN, Math.min(SPEED_MAX, value)) * 100) / 100;
}

export function clampPitch(value: number): number {
  return Math.max(PITCH_MIN, Math.min(PITCH_MAX, Math.round(value)));
}

export function clampModify(value: number): number {
  return Math.max(MODIFY_MIN, Math.min(MODIFY_MAX, Math.round(value)));
}

/** Round a 0–1 value to the integer unit shown in the stepper. */
export function toUnit(value: number): number {
  return Math.round(value * 100);
}

export function fromUnit(value: number): number {
  return clampTts(Math.round(value) / 100);
}

export function clampUnit(value: number): number {
  return Math.max(UNIT_MIN, Math.min(UNIT_MAX, Math.round(value)));
}

export function clampSpeedUnit(value: number): number {
  return Math.max(SPEED_UNIT_MIN, Math.min(SPEED_UNIT_MAX, Math.round(value)));
}

export function fromSpeedUnit(value: number): number {
  return clampSpeed(Math.round(value) / 100);
}

function storageKey(profileId: string): string {
  return `forever_tts_settings_${profileId}`;
}

function num(
  value: unknown,
  fallback: number,
  clamp: (n: number) => number,
): number {
  return typeof value === "number" && Number.isFinite(value)
    ? clamp(value)
    : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeValues(raw: Record<string, unknown>, fallback: TtsValues): TtsValues {
  return {
    stability: num(raw.stability, fallback.stability, clampTts),
    similarityBoost: num(raw.similarityBoost, fallback.similarityBoost, clampTts),
    style: num(raw.style, fallback.style, clampTts),
    speakerBoost: bool(raw.speakerBoost, fallback.speakerBoost),
    speed: num(raw.speed, fallback.speed, clampSpeed),
    lengthenPauses: bool(raw.lengthenPauses, fallback.lengthenPauses),
    emotion:
      typeof raw.emotion === "string" && raw.emotion.trim()
        ? raw.emotion.trim()
        : fallback.emotion,
    pitch: num(raw.pitch, fallback.pitch, clampPitch),
    intensity: num(raw.intensity, fallback.intensity, clampModify),
    timbre: num(raw.timbre, fallback.timbre, clampModify),
  };
}

function normalizeV2(raw: Record<string, unknown>): TtsProfileSettings | null {
  const mode =
    raw.mode === "similar" || raw.mode === "stable" || raw.mode === "custom"
      ? raw.mode
      : null;
  if (!mode) return null;

  const customRaw =
    raw.custom && typeof raw.custom === "object"
      ? (raw.custom as Record<string, unknown>)
      : raw;

  const draftText =
    typeof raw.draftText === "string" ? raw.draftText : undefined;

  return {
    mode,
    custom: normalizeValues(customRaw, DEFAULT_CUSTOM_VALUES),
    draftText,
  };
}

/** Migrate v1 flat { preset, ...values } payloads. */
function migrateV1(raw: Record<string, unknown>): TtsProfileSettings {
  const preset =
    raw.preset === "similar" || raw.preset === "stable" ? raw.preset : null;
  const values = normalizeValues(raw, DEFAULT_CUSTOM_VALUES);
  const draftText =
    typeof raw.draftText === "string" ? raw.draftText : undefined;

  if (preset === null) {
    return { mode: "custom", custom: values, draftText };
  }

  return { mode: preset, custom: { ...DEFAULT_CUSTOM_VALUES }, draftText };
}

function normalize(raw: unknown): TtsProfileSettings | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  return normalizeV2(r) ?? migrateV1(r);
}

export async function loadTtsSettings(
  profileId: string,
): Promise<TtsProfileSettings | null> {
  try {
    const raw = await AsyncStorage.getItem(storageKey(profileId));
    return raw ? normalize(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export async function saveTtsSettings(
  profileId: string,
  settings: TtsProfileSettings,
): Promise<void> {
  try {
    await AsyncStorage.setItem(storageKey(profileId), JSON.stringify(settings));
  } catch {
    // Losing a remembered tweak is not worth interrupting playback.
  }
}
