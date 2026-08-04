import type { VoiceSample } from "@forever/api-client";

export const CLONE_MAX_SAMPLES = 3;
export const CLONE_MAX_DURATION_MS = 150_000;
/** MiniMax clones from up to 5 minutes, which takes more than three clips. */
export const MINIMAX_CLONE_MAX_SAMPLES = 8;
export const MINIMAX_CLONE_MAX_DURATION_MS = 300_000;

export function cloneMaxSamples(provider: string | null | undefined): number {
  return provider === "minimax" ? MINIMAX_CLONE_MAX_SAMPLES : CLONE_MAX_SAMPLES;
}

export function cloneMaxDurationMs(provider: string | null | undefined): number {
  return provider === "minimax"
    ? MINIMAX_CLONE_MAX_DURATION_MS
    : CLONE_MAX_DURATION_MS;
}

/** Pick up to 3 highest-quality processed samples within ~2.5 minutes. */
export function suggestCloneSampleIds(
  samples: VoiceSample[],
  opts?: { maxSamples?: number; maxDurationMs?: number },
): string[] {
  const maxSamples = opts?.maxSamples ?? CLONE_MAX_SAMPLES;
  const maxDurationMs = opts?.maxDurationMs ?? CLONE_MAX_DURATION_MS;
  const sorted = [...samples].sort((a, b) => {
    const scoreDiff = (b.quality_score ?? 0) - (a.quality_score ?? 0);
    if (scoreDiff !== 0) return scoreDiff;
    const da = a.duration_ms ?? 0;
    const db = b.duration_ms ?? 0;
    // Prefer mid-length clips when scores tie.
    const ideal = 45_000;
    return Math.abs(da - ideal) - Math.abs(db - ideal);
  });

  const picked: VoiceSample[] = [];
  let total = 0;
  for (const sample of sorted) {
    if (picked.length >= maxSamples) break;
    const dur = sample.duration_ms ?? 0;
    if (picked.length > 0 && total + dur > maxDurationMs) continue;
    if (picked.length === 0 && dur > maxDurationMs) continue;
    picked.push(sample);
    total += dur;
  }

  if (!picked.length && samples.length) {
    // Fallback: shortest single clip even if slightly over ideal budget.
    const shortest = [...samples].sort(
      (a, b) => (a.duration_ms ?? Infinity) - (b.duration_ms ?? Infinity),
    )[0];
    return shortest ? [shortest.id] : [];
  }

  return picked.map((s) => s.id);
}

export function formatDurationMs(ms: number | null | undefined): string {
  if (ms == null || ms < 0) return "—:—";
  const totalSec = Math.round(ms / 1000);
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function formatPct(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return `${Math.round(value * 100)}%`;
}
