import {
  AudioPlayer,
  createAudioPlayer,
  setAudioModeAsync,
} from "expo-audio";

let activePlayer: AudioPlayer | null = null;

export async function stopActivePlayback(): Promise<void> {
  if (!activePlayer) return;
  try {
    activePlayer.pause();
    activePlayer.remove();
  } catch {
    // ignore
  }
  activePlayer = null;
}

/** Play a local file URI; returns the player. Call stopActivePlayback to cancel. */
export async function playLocalAudio(
  uri: string,
  onFinish?: () => void,
): Promise<AudioPlayer> {
  await stopActivePlayback();
  await setAudioModeAsync({
    playsInSilentMode: true,
    allowsRecording: false,
  });

  const player = createAudioPlayer({ uri });
  activePlayer = player;

  const sub = player.addListener("playbackStatusUpdate", (status) => {
    if (!status.didJustFinish) return;
    sub.remove();
    if (activePlayer === player) {
      try {
        player.remove();
      } catch {
        // ignore
      }
      activePlayer = null;
    }
    onFinish?.();
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
