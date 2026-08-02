from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any


@dataclass(frozen=True)
class Segment:
    speaker: str
    start: float
    end: float
    file: str | None = None
    purity: float | None = None
    quality: str | None = None  # clean | mixed | short

    @property
    def duration(self) -> float:
        return max(0.0, self.end - self.start)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)
