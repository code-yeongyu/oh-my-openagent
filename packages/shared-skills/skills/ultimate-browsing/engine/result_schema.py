from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Optional


@dataclass
class Attempt:
    phase: str
    executor: str
    url: str
    url_transform: str
    impersonate: Optional[str]
    referer: str
    status: int = 0
    body_size: int = 0
    verdict: str = ""
    reasons: list[str] = field(default_factory=list)
    elapsed_s: float = 0.0
    error: Optional[str] = None

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class FetchResult:
    ok: bool
    content: str = ""
    final_url: str = ""
    verdict: str = ""
    profile_used: Optional[str] = None
    trace: list[Attempt] = field(default_factory=list)
    summary: str = ""

    def to_dict(self) -> dict:
        return {
            "ok": self.ok,
            "final_url": self.final_url,
            "verdict": self.verdict,
            "profile_used": self.profile_used,
            "trace": [a.to_dict() for a in self.trace],
            "summary": self.summary,
            "content_length": len(self.content),
        }
