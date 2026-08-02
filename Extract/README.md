# Extract

Local tool: **speaker diarization → cut per-speaker audio segments**.

- Input: audio (`.wav`, `.mp3`, `.m4a`, `.aac`, `.flac`, …)
- Model: [`pyannote/speaker-diarization-community-1`](https://huggingface.co/pyannote/speaker-diarization-community-1)
- You pass `--num-speakers` per file
- Output: `speakers/SPEAKER_xx/*.wav` + `diarization.json`
- No ASR / transcription in v0.1

Designed for MacBook Apple Silicon (MPS) first; also works on CUDA/CPU.

> Currently developed inside the Forever workspace. Intended to live as its own GitHub repo (`Extract`) — create the empty repo anytime, then push this folder.

## Requirements

- Python 3.11+
- [ffmpeg](https://ffmpeg.org/) (`brew install ffmpeg`)
- Hugging Face account + token
- Accept model terms: https://hf.co/pyannote/speaker-diarization-community-1

## Setup (Mac)

```bash
cd Extract
python3 -m venv .venv
source .venv/bin/activate
pip install -U pip
pip install -e ".[dev]"

# PyTorch with MPS is the default macOS wheel from pip for Apple Silicon.
export HF_TOKEN=hf_xxx   # or copy .env.example → .env and load it
```

## Usage

```bash
extract \
  --input ~/Desktop/car_chat.m4a \
  --num-speakers 5 \
  --out ./out/car_chat
```

Or:

```bash
python -m extract -i car_chat.m4a -n 5 -o ./out/car_chat
```

### Useful flags

| Flag | Default | Meaning |
|------|---------|---------|
| `--num-speakers` / `-n` | required | Exact speaker count |
| `--device` | `auto` | `mps` / `cuda` / `cpu` |
| `--pad` | `0.2` | Seconds padded around each cut |
| `--max-gap` | `0.75` | Merge same-speaker gaps under this |
| `--min-duration` | `0.4` | Drop tiny fragments after merge |

## Output layout

```text
out/car_chat/
  source.wav
  diarization.json
  speakers/
    SPEAKER_00/
      0001.wav
      0002.wav
    SPEAKER_01/
      ...
```

Rename `SPEAKER_xx` folders manually after listening (enrollment / naming comes later).

## Accuracy note (car + 5 people)

Expect rough cuts, not perfect labels — cabin noise and overlap hurt diarization. Treat output as a draft: keep clean solo segments, discard messy ones.

## Tests (no model download)

```bash
pytest
```

## Push to a new GitHub repo later

When `https://github.com/<you>/Extract` exists (empty):

```bash
cd Extract
git init
git add .
git commit -m "Initial Extract: local speaker diarization CLI"
git branch -M main
git remote add origin git@github.com:<you>/Extract.git
git push -u origin main
```

## License

MIT
