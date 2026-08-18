"""Drop local-ops noise so Sentry mail is not a docker-compose pager."""

from __future__ import annotations

from typing import Any


def before_send(event: dict[str, Any], hint: dict[str, Any]) -> dict[str, Any] | None:
    exc_info = hint.get("exc_info")
    if exc_info and len(exc_info) >= 2 and exc_info[1] is not None:
        text = str(exc_info[1])
        if _is_local_postgres_down(text):
            return None

    logentry = event.get("logentry") or {}
    message = str(logentry.get("message") or event.get("message") or "")
    if "Application startup failed" in message and "5434" in message:
        return None
    # uvicorn logs the short line; the traceback is a separate event.
    if message.strip() == "Application startup failed. Exiting.":
        return None
    return event


def _is_local_postgres_down(text: str) -> bool:
    return "5434" in text and "Connection refused" in text
