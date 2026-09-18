from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Literal, Optional

Provenance = Literal["live", "snapshot", "proxy"]
Trust = Literal["origin", "archive", "untrusted"]


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
    provenance: str = "live"                       # live | snapshot | proxy
    snapshot_timestamp: Optional[str] = None      # archive's own timestamp, when snapshot
    trust: str = "origin"                         # origin | archive | untrusted

    def to_dict(self) -> dict:
        return {
            "ok": self.ok,
            "final_url": self.final_url,
            "verdict": self.verdict,
            "profile_used": self.profile_used,
            "trace": [a.to_dict() for a in self.trace],
            "summary": self.summary,
            "provenance": self.provenance,
            "snapshot_timestamp": self.snapshot_timestamp,
            "trust": self.trust,
            "content_length": len(self.content),
        }
