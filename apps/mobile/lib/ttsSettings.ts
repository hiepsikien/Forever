import AsyncStorage from "@react-native-async-storage/async-storage";

export const TTS_STEP = 0.05;
export const SPEED_MIN = 0.7;
export const SPEED_MAX = 1.2;
export const SPEED_DEFAULT = 0.9;

export type TtsPresetName = "similar" | "stable";
export type TtsMode = TtsPresetName | "custom";

export type TtsValues = {
  stability: number;
  similarityBoost: number;
  style: number;
  speakerBoost: boolean;
  speed: number;
  lengthenPauses: boolean;
};

/** Per-profile: which chip is active + custom values kept separately from presets. */
export type TtsProfileSettings = {
  mode: TtsMode;
  custom: TtsValues;
};

export const PRESET_VALUES: Record<TtsPresetName, TtsValues> = {
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
};

export const DEFAULT_CUSTOM_VALUES: TtsValues = { ...PRESET_VALUES.similar };

export const DEFAULT_TTS_PROFILE_SETTINGS: TtsProfileSettings = {
  mode: "similar",
  custom: DEFAULT_CUSTOM_VALUES,
};

export function activeTtsValues(settings: TtsProfileSettings): TtsValues {
  return settings.mode === "custom"
    ? settings.custom
    : PRESET_VALUES[settings.mode];
}

export function clampTts(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 100) / 100;
}

export function clampSpeed(value: number): number {
  return Math.round(Math.max(SPEED_MIN, Math.min(SPEED_MAX, value)) * 100) / 100;
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

  return {
    mode,
    custom: normalizeValues(customRaw, DEFAULT_CUSTOM_VALUES),
  };
}

/** Migrate v1 flat { preset, ...values } payloads. */
function migrateV1(raw: Record<string, unknown>): TtsProfileSettings {
  const preset =
    raw.preset === "similar" || raw.preset === "stable" ? raw.preset : null;
  const values = normalizeValues(raw, DEFAULT_CUSTOM_VALUES);

  if (preset === null) {
    return { mode: "custom", custom: values };
  }

  return { mode: preset, custom: { ...DEFAULT_CUSTOM_VALUES } };
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
