#!/usr/bin/env python3
"""Check the MiniMax key with one cheap synthesis, before spending on a clone.

Uses a system voice, so no clone fee is charged (~0.003 USD of characters).
A `1008 insufficient balance` here means the account has Token Plan credits
instead of the pay-as-you-go balance that TTS and cloning bill against.

    cd apps/api && .venv/bin/python ../../scripts/probe-minimax.py
"""

from __future__ import annotations

import sys
from pathlib import Path

API_DIR = Path(__file__).resolve().parent.parent / "apps" / "api"
sys.path.insert(0, str(API_DIR))

from app.config import get_settings  # noqa: E402
from app.services import minimax as mm  # noqa: E402

OUT = Path("/tmp/minimax-probe.mp3")


def main() -> int:
    settings = get_settings()
    api_key = settings.minimax_api_key.strip()
    print(f"key present: {bool(api_key)}")
    print(f"base: {settings.minimax_api_base}")
    print(f"model: {settings.minimax_tts_model}")
    if not api_key:
        print("Đặt MINIMAX_API_KEY trong apps/api/.env rồi chạy lại.")
        return 1

    try:
        audio = mm.text_to_speech(
            settings=settings,
            api_key=api_key,
            voice_id="English_Graceful_Lady",  # system voice — no clone fee
            text="Xin chào, đây là bản thử.",
            lengthen_pauses=False,
        )
    except mm.MinimaxError as exc:
        print(f"FAILED: {exc.message}")
        return 1

    OUT.write_bytes(audio)
    print(f"OK · {len(audio)} bytes → {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
