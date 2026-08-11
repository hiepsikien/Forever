/** Accidental tap, not an utterance. */
export const HOLD_TO_TALK_MIN_MS = 500;
/** Even a stuck finger must not leave the mic open. */
export const HOLD_TO_TALK_MAX_MS = 60_000;
/** Slide this far from the press origin to cancel instead of send. */
export const HOLD_TO_TALK_CANCEL_PX = 72;

/** expo-audio dB; room tone sits well below this, speech peaks above. */
const SPEECH_DB = -34;
/** Same floor when the native meter reports 0..1 instead of dB. */
const SPEECH_LINEAR = 0.43;
/** ~240ms of voice at the 80ms meter tick — a tap or breath is one spike. */
export const SPEECH_MIN_HITS = 3;

export type SpeechGate = { samples: number; hits: number };

export function emptySpeechGate(): SpeechGate {
  return { samples: 0, hits: 0 };
}

export function meteringLooksLikeSpeech(
  metering?: number | null,
): boolean {
  if (metering == null || Number.isNaN(metering)) return false;
  if (metering > 0 && metering <= 1) return metering >= SPEECH_LINEAR;
  return metering >= SPEECH_DB;
}

export function noteSpeechMetering(
  gate: SpeechGate,
  metering?: number | null,
): void {
  if (metering == null || Number.isNaN(metering)) return;
  gate.samples += 1;
  if (meteringLooksLikeSpeech(metering)) gate.hits += 1;
}

/**
 * Whether the clip had enough level to be a real utterance.
 * If the meter never delivered samples, let the server decide.
 */
export function gateHeardSpeech(gate: SpeechGate): boolean {
  if (gate.samples < 3) return true;
  return gate.hits >= SPEECH_MIN_HITS;
}
