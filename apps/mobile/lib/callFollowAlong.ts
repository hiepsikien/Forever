/** Split reply text into follow-along chunks for call playback. */
export function splitIntoSentences(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const parts = trimmed.match(/[^.!?…\n]+[.!?…]+|[^.!?…\n]+/g);
  const sentences = (parts ?? [trimmed])
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  return sentences.length ? sentences : [trimmed];
}

export type FollowAlongPlan = {
  /** Every sentence on screen, lead line first. */
  sentences: string[];
  /** Index of the first sentence the audio actually speaks. */
  spokenFrom: number;
};

/**
 * Sentences to show, and where the voice starts among them.
 *
 * A recite turn opens with a line the audio does not contain — «Bà đọc «Truyện
 * Kiều» — Đoạn 1 đây con.» — because the recording is the passage alone, cached
 * per passage and shared with the Nghe đọc shelf. Spreading the audio over that
 * lead line as well leaves the highlight a slice of the whole reply behind the
 * voice, and on a long passage the slice is seconds.
 */
export function followAlongPlan(text: string, spokenFrom = 0): FollowAlongPlan {
  const cut = Math.max(0, Math.min(Math.trunc(spokenFrom) || 0, text.length));
  const whole = { sentences: splitIntoSentences(text), spokenFrom: 0 };
  if (!cut) return whole;
  const lead = splitIntoSentences(text.slice(0, cut));
  const spoken = splitIntoSentences(text.slice(cut));
  if (!lead.length || !spoken.length) return whole;
  return { sentences: [...lead, ...spoken], spokenFrom: lead.length };
}

/**
 * Light the sentence a moment before it is spoken.
 *
 * A boundary crossed on the poll after the voice moved on reads as lag; arriving
 * with the voice reads as following along.
 */
export const FOLLOW_ALONG_LEAD_SEC = 0.2;

/** Which sentence to highlight for a playback position. */
export function activeSentenceForProgress(
  plan: FollowAlongPlan,
  currentTime: number,
  duration: number,
): number {
  const spoken = plan.sentences.slice(plan.spokenFrom);
  if (!spoken.length) return plan.spokenFrom;
  return (
    plan.spokenFrom +
    sentenceIndexForProgress(
      currentTime + FOLLOW_ALONG_LEAD_SEC,
      duration,
      spoken,
    )
  );
}

/**
 * Map playback progress → sentence index by character weight.
 * No word timestamps from TTS, so this is a readable approximation.
 */
export function sentenceIndexForProgress(
  currentTime: number,
  duration: number,
  sentences: string[],
): number {
  if (!sentences.length) return 0;
  if (duration <= 0) return 0;

  const weights = sentences.map((s) => Math.max(s.length, 8));
  const total = weights.reduce((a, b) => a + b, 0);
  const t = Math.min(Math.max(currentTime / duration, 0), 0.999);

  let acc = 0;
  for (let i = 0; i < weights.length; i++) {
    acc += weights[i] / total;
    if (t < acc) return i;
  }
  return sentences.length - 1;
}
