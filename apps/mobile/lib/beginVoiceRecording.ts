import type { AudioRecorder, RecordingOptions } from "expo-audio";
import { Platform } from "react-native";

import { prepareRecordingMode } from "@/lib/audio";
import {
  VOICE_RECORDING_FALLBACK,
  VOICE_RECORDING_OPTIONS,
} from "@/lib/recordingOptions";

/** Flip audio session after playback stops — both platforms need a beat. */
const SESSION_SETTLE_MS = Platform.OS === "android" ? 280 : 200;
/** How long MediaRecorder may take to report itself as running. */
const RECORD_READY_MS = Platform.OS === "android" ? 900 : 250;

/**
 * Whether the mic is open right now. Reads the native status as well as the
 * cached getter, which lags on Android. Deliberately ignores `durationMillis`:
 * it keeps the last take's length after stop, which would read as «still live»
 * forever and block the next hold.
 */
export function recorderLooksLive(recorder: AudioRecorder): boolean {
  try {
    if (recorder.getStatus().isRecording) return true;
  } catch {
    // getStatus can throw while native is still wiring up.
  }
  return recorder.isRecording;
}

function durationMillis(recorder: AudioRecorder): number {
  try {
    return recorder.getStatus().durationMillis || 0;
  } catch {
    return 0;
  }
}

async function tryOpen(
  recorder: AudioRecorder,
  options: RecordingOptions,
): Promise<boolean> {
  await recorder.prepareToRecordAsync(options);
  const before = durationMillis(recorder);
  recorder.record();
  const deadline = Date.now() + RECORD_READY_MS;
  while (Date.now() < deadline) {
    // A growing clock counts as started even while the flag lags.
    if (recorderLooksLive(recorder) || durationMillis(recorder) > before) {
      return true;
    }
    await new Promise((r) => setTimeout(r, 40));
  }
  return false;
}

/**
 * Open the mic for a hold-to-talk take.
 *
 * Throws only when the device refuses to record at all. A slow `isRecording`
 * flag is not a failure: Samsung can lag a few hundred ms, and killing the take
 * over that is what made the mic flash on and off.
 */
export async function beginVoiceRecording(recorder: AudioRecorder): Promise<void> {
  await prepareRecordingMode();
  await new Promise((r) => setTimeout(r, SESSION_SETTLE_MS));

  let firstError: unknown = null;
  try {
    if (await tryOpen(recorder, VOICE_RECORDING_OPTIONS)) return;
  } catch (e) {
    firstError = e;
  }

  // Format refused (stereo, sample rate, container): retry once, plainer.
  try {
    if (recorder.isRecording) await recorder.stop();
  } catch {
    // ignore
  }
  try {
    if (await tryOpen(recorder, VOICE_RECORDING_FALLBACK)) return;
  } catch (e) {
    firstError = firstError ?? e;
  }

  // Nothing reported running. If `record()` never threw the mic may still be
  // live with a lagging flag, so let the take continue and judge it on stop.
  if (!firstError) return;
  throw new Error("Micro không ghi được. Thử giữ lại nút hoặc mở lại app.");
}
