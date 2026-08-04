# Extract

Local/server tool: **speaker diarization → exclusive solo harvest → cut per-speaker segments**.

**Product plan:** [`PROJECT.md`](./PROJECT.md) — Forever sub-app / worker cho Voice DNA từ ký ức.

- Input: audio (`.wav`, `.mp3`, `.m4a`, `.aac`, `.flac`, …)
- Model: [`pyannote/speaker-diarization-community-1`](https://huggingface.co/pyannote/speaker-diarization-community-1)
- You pass `--num-speakers` per file
- Post-process: **exclusive-only** (bỏ overlap), trim biên, purity + `clean|short|mixed`
- Output: `speakers/SPEAKER_xx/*.wav` (clean) + `diarization.json`
- Forever: worker poll API → steward review trong Voice DNA hub

CLI local là bản tạm; worker local: `../scripts/run-extract-worker.sh`.

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
| `--pad` | `0.05` | Seconds padded around each cut |
| `--max-gap` | `0.35` | Merge same-speaker gaps under this |
| `--min-duration` | `2.0` | Minimum duration for `clean` label |
| `--edge-trim` | `0.05` | Trim contaminated edges |
| `--purity-min` | `0.9` | Min exclusive ratio for clean |
| `--no-exclusive` | off | Keep original turns + score purity |
| `--keep-mixed` | off | Also emit mixed clips under `_review/` |

### Forever worker (local)

```bash
# terminal 1 — Forever API (port 8001)
# terminal 2:
export HF_TOKEN=hf_xxx
export FOREVER_API_URL=http://127.0.0.1:8001
./scripts/run-extract-worker.sh
```

Steward tạo job từ app: Voice DNA → **Giọng từ ký ức**.

## Output layout

```text
out/car_chat/
  source.wav        # 16 kHz mono — diarization input only
  source.clip.wav   # source bandwidth (≤48 kHz) — what clips are cut from
  diarization.json
  speakers/
    SPEAKER_00/
      0001.wav
      0002.wav
    SPEAKER_01/
      ...
```

Clips are cut from `source.clip.wav`, not the 16 kHz diarization file: above 8 kHz sit the breath, sibilance and upper formants that voice cloning needs to keep a speaker's age and identity. `source.clip.wav` is skipped when the source is already at or below the diarization rate. Override with `--clip-sample-rate` if needed.

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
