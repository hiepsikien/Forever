import { ApiError } from "@forever/api-client";
import { useCallback, useState } from "react";
import { Alert } from "react-native";

import {
  playLocalAudio,
  stopActivePlayback,
} from "@/lib/audio";
import { useAuth } from "@/lib/auth";
import { writeCacheAudio } from "@/lib/media";

export function reciteButtonLabel(relation?: string | null): string {
  const rel = (relation || "").trim();
  return rel ? `${rel} đọc` : "Nghe đọc";
}

export function reciteListenLabel(relation?: string | null): string {
  const rel = (relation || "").trim();
  return rel ? `Nghe ${rel} đọc` : "Nghe đọc thơ";
}

export function usePoemRecite() {
  const { api } = useAuth();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);

  const stop = useCallback(async () => {
    await stopActivePlayback();
    setPlayingId(null);
  }, []);

  const play = useCallback(
    async (memoryId: string, identityId?: string) => {
      if (playingId === memoryId) {
        await stop();
        return;
      }
      setBusyId(memoryId);
      try {
        const bytes = await api.recitePoem(memoryId, identityId);
        const uri = await writeCacheAudio(bytes, `poem-${memoryId}`, "audio/mpeg");
        setPlayingId(memoryId);
        await playLocalAudio(uri, () => setPlayingId(null));
      } catch (e) {
        await stopActivePlayback();
        setPlayingId(null);
        const message =
          e instanceof ApiError
            ? e.message
            : e instanceof Error
              ? e.message
              : "Không đọc được bài thơ.";
        Alert.alert("Chưa nghe được", message);
      } finally {
        setBusyId(null);
      }
    },
    [api, playingId, stop],
  );

  return { play, stop, busyId, playingId };
}
