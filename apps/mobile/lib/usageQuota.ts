import type { HeritageUsage } from "@forever/api-client";
import { useEffect, useRef, useState } from "react";

export const DEFAULT_MAX_UTTERANCE_SEC = 60;

export function usageExhausted(usage: HeritageUsage | null | undefined): boolean {
  if (!usage || !usage.enabled) return false;
  return usage.remaining === 0;
}

export function usageStripText(usage: HeritageUsage): string {
  if (!usage.enabled) return "Không giới hạn lượt hôm nay";
  if (usage.remaining === 0) {
    return "Hôm nay đã nói đủ rồi. Mai bố vẫn ở đây.";
  }
  if (usage.warn) {
    return `Còn ${usage.remaining}/${usage.limit} lượt — dành cho điều quan trọng`;
  }
  return `Còn ${usage.remaining}/${usage.limit} lượt hôm nay`;
}

/**
 * Hard-cap recording length. When `active`, counts down from `maxSec` and
 * fires `onMax` once. Used so mẹ không quên tắt micro.
 */
export function useMaxUtteranceTimer(
  active: boolean,
  maxSec: number,
  onMax: () => void,
): { remainingSec: number | null; nearEnd: boolean } {
  const [remainingSec, setRemainingSec] = useState<number | null>(null);
  const onMaxRef = useRef(onMax);
  onMaxRef.current = onMax;
  const firedRef = useRef(false);

  useEffect(() => {
    if (!active) {
      setRemainingSec(null);
      firedRef.current = false;
      return;
    }
    const limit = Math.max(5, Math.floor(maxSec) || DEFAULT_MAX_UTTERANCE_SEC);
    const started = Date.now();
    firedRef.current = false;
    setRemainingSec(limit);

    const id = setInterval(() => {
      const left = Math.max(0, limit - Math.floor((Date.now() - started) / 1000));
      setRemainingSec(left);
      if (left <= 0 && !firedRef.current) {
        firedRef.current = true;
        onMaxRef.current();
      }
    }, 250);

    return () => clearInterval(id);
  }, [active, maxSec]);

  return {
    remainingSec,
    nearEnd: remainingSec != null && remainingSec <= 10,
  };
}
