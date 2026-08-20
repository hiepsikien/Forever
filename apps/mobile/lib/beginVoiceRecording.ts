import type { AudioRecorder } from "expo-audio";
import { Platform } from "react-native";

import { prepareRecordingMode } from "@/lib/audio";
import { VOICE_RECORDING_OPTIONS } from "@/lib/recordingOptions";

/** Flip audio session after playback stops — both platforms need a beat. */
const SESSION_SETTLE_MS = Platform.OS === "android" ? 280 : 200;

/**
 * Open the mic for a hold-to-talk take. Throws if MediaRecorder never starts —
 * expo-audio on Android can report isRecording=true even when start() no-ops,
 * so we re-read status after a short pause.
 */
export async function beginVoiceRecording(recorder: AudioRecorder): Promise<void> {
  await prepareRecordingMode();
  await new Promise((r) => setTimeout(r, SESSION_SETTLE_MS));
  await recorder.prepareToRecordAsync(VOICE_RECORDING_OPTIONS);
  recorder.record();
  await new Promise((r) => setTimeout(r, Platform.OS === "android" ? 80 : 40));
  if (!recorder.isRecording) {
    throw new Error("Micro không ghi được. Thử giữ lại nút hoặc mở lại app.");
  }
}
