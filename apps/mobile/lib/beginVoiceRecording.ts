import type { AudioRecorder } from "expo-audio";
import { Platform } from "react-native";

import { prepareRecordingMode } from "@/lib/audio";
import { VOICE_RECORDING_OPTIONS } from "@/lib/recordingOptions";

/** Flip audio session after playback stops — both platforms need a beat. */
const SESSION_SETTLE_MS = Platform.OS === "android" ? 280 : 200;
const RECORD_READY_MS = Platform.OS === "android" ? 700 : 200;

/**
 * Open the mic for a hold-to-talk take. Throws if MediaRecorder never starts.
 * Samsung can report isRecording=false for a few hundred ms after record().
 */
export async function beginVoiceRecording(recorder: AudioRecorder): Promise<void> {
  await prepareRecordingMode();
  await new Promise((r) => setTimeout(r, SESSION_SETTLE_MS));
  await recorder.prepareToRecordAsync(VOICE_RECORDING_OPTIONS);
  recorder.record();
  const deadline = Date.now() + RECORD_READY_MS;
  while (Date.now() < deadline) {
    if (recorder.isRecording) return;
    await new Promise((r) => setTimeout(r, 40));
  }
  throw new Error("Micro không ghi được. Thử giữ lại nút hoặc mở lại app.");
}
