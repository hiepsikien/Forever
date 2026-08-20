import { RecordingPresets, type RecordingOptions } from "expo-audio";
import { Platform } from "react-native";

/**
 * Voice/chat recording with live level metering for waveform UI.
 *
 * Android records **mono**: `HIGH_QUALITY` asks for two channels and Samsung's
 * MediaRecorder refuses a stereo mic — it opened the mic then died, which read
 * on screen as the red button flashing and going out. One channel is also all
 * a phone mic captures, so nothing is lost.
 */
export const VOICE_RECORDING_OPTIONS: RecordingOptions = {
  ...RecordingPresets.HIGH_QUALITY,
  isMeteringEnabled: true,
  ...(Platform.OS === "android"
    ? { numberOfChannels: 1, bitRate: 96_000 }
    : null),
};

/** Tried once when the device rejects the preferred format outright. */
export const VOICE_RECORDING_FALLBACK: RecordingOptions = {
  ...RecordingPresets.LOW_QUALITY,
  isMeteringEnabled: true,
  numberOfChannels: 1,
};
