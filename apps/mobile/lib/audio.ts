import {
  AudioPlayer,
  AudioStatus,
  createAudioPlayer,
  setAudioModeAsync,
} from "expo-audio";

let activePlayer: AudioPlayer | null = null;
let finishSub: { remove: () => void } | null = null;

export type PlayLocalAudioOptions = {
  onFinish?: () => void;
  onProgress?: (status: Pick<AudioStatus, "currentTime" | "duration" | "isLoaded">) => void;
  /** Status poll interval in ms. Default 200 for follow-along UI. */
  updateInterval?: number;
};

export async function stopActivePlayback(): Promise<void> {
  if (finishSub) {
    try {
      finishSub.remove();
    } catch {
      // ignore
    }
    finishSub = null;
  }
  if (!activePlayer) return;
  try {
    activePlayer.pause();
    activePlayer.remove();
  } catch {
    // ignore
  }
  activePlayer = null;
}

export function pauseActivePlayback(): boolean {
  if (!activePlayer) return false;
  try {
    activePlayer.pause();
    return true;
  } catch {
    return false;
  }
}

export function resumeActivePlayback(): boolean {
  if (!activePlayer) return false;
  try {
    activePlayer.play();
    return true;
  } catch {
    return false;
  }
}

export function hasActivePlayer(): boolean {
  return activePlayer != null;
}

/** Play a local file URI; returns the player. Call stopActivePlayback to cancel. */
export async function playLocalAudio(
  uri: string,
  onFinishOrOpts?: (() => void) | PlayLocalAudioOptions,
): Promise<AudioPlayer> {
  const opts: PlayLocalAudioOptions =
    typeof onFinishOrOpts === "function"
      ? { onFinish: onFinishOrOpts }
      : onFinishOrOpts ?? {};

  await stopActivePlayback();
  await setAudioModeAsync({
    playsInSilentMode: true,
    allowsRecording: false,
  });

  const player = createAudioPlayer(
    { uri },
    { updateInterval: opts.updateInterval ?? (opts.onProgress ? 200 : 500) },
  );
  activePlayer = player;

  finishSub = player.addListener("playbackStatusUpdate", (status) => {
    if (status.isLoaded && opts.onProgress) {
      opts.onProgress({
        currentTime: status.currentTime,
        duration: status.duration,
        isLoaded: status.isLoaded,
      });
    }
    if (!status.didJustFinish) return;
    finishSub?.remove();
    finishSub = null;
    if (activePlayer === player) {
      try {
        player.remove();
      } catch {
        // ignore
      }
      activePlayer = null;
    }
    opts.onFinish?.();
  });

  player.play();
  return player;
}

export async function prepareRecordingMode(): Promise<void> {
  await setAudioModeAsync({
    playsInSilentMode: true,
    allowsRecording: true,
  });
}

export async function preparePlaybackMode(): Promise<void> {
  await setAudioModeAsync({
    playsInSilentMode: true,
    allowsRecording: false,
  });
}
