import { RecordingPresets } from "expo-audio";

/** Voice/chat recording with live level metering for waveform UI. */
export const VOICE_RECORDING_OPTIONS = {
  ...RecordingPresets.HIGH_QUALITY,
  isMeteringEnabled: true,
};
