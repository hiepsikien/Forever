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
