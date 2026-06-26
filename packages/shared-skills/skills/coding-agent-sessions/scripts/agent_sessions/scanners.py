from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Callable, TypeAlias

from .claude import scan_claude
from .codex import scan_codex
from .file_scanners import (
    scan_aider,
    scan_amp,
    scan_cline,
    scan_codebuff,
    scan_droid,
    scan_gemini,
    scan_kilocode,
    scan_kimi,
    scan_openclaw,
    scan_qwen,
    scan_roocode,
)
from .kiro_scanner import scan_kiro
from .opencode import scan_opencode
from .sqlite_optional_scanners import scan_crush, scan_goose, scan_hermes, scan_kilo_cli, scan_zed
from .sqlite_scanners import scan_cursor_cli, scan_kodu
from .transcript import existing, jsonl_parallel, recent, stem_id
from .types import Session

Scanner: TypeAlias = Callable[[tuple[Path, ...], int], list[Session]]

PLATFORM_SCANNERS: dict[str, Scanner] = {
    "codex": scan_codex,
    "claude": scan_claude,
    "senpi": lambda roots, workers: scan_senpi(roots, workers),
    "opencode": scan_opencode,
    "openclaw": scan_openclaw,
    "droid": scan_droid,
    "amp": scan_amp,
    "gemini": scan_gemini,
    "kimi": scan_kimi,
    "qwen": scan_qwen,
    "codebuff": scan_codebuff,
    "roo-code": scan_roocode,
    "kilo-code": scan_kilocode,
    "cline": scan_cline,
    "kodu": scan_kodu,
    "cursor-cli": scan_cursor_cli,
    "aider": scan_aider,
    "kilo-cli": scan_kilo_cli,
    "hermes": scan_hermes,
    "goose": scan_goose,
    "crush": scan_crush,
    "zed": scan_zed,
    "kiro": scan_kiro,
}
DEFAULT_PLATFORMS = frozenset(PLATFORM_SCANNERS)
PLATFORM_ALIASES = {"cursor": "cursor-cli", "factory": "droid", "roo": "roo-code", "roocode": "roo-code", "kilocode": "kilo-code", "kilo": "kilo-cli"}

__all__ = ["DEFAULT_PLATFORMS", "PLATFORM_SCANNERS", "scan", "scan_claude", "scan_codex", "scan_opencode", "scan_senpi"]


def scan(platforms: frozenset[str], roots: tuple[Path, ...], workers: int) -> list[Session]:
    selected = frozenset(PLATFORM_ALIASES.get(platform, platform) for platform in platforms)
    tasks = [task for platform, task in PLATFORM_SCANNERS.items() if platform in selected]
    if not tasks:
        return []
    sessions: list[Session] = []
    with ThreadPoolExecutor(max_workers=min(workers, max(len(tasks), 1))) as pool:
        futures = [pool.submit(task, roots, workers) for task in tasks]
        for future in as_completed(futures):
            sessions.extend(future.result())
    return _dedupe(sessions)


def scan_senpi(extra_roots: tuple[Path, ...], workers: int) -> list[Session]:
    roots = existing([Path.home() / ".senpi" / "agent", Path.home() / ".pi" / "agent", *extra_roots])
    paths = [path for root in roots for path in (root / "sessions").rglob("*.jsonl")]
    return jsonl_parallel(recent(paths), workers, "senpi", lambda path: stem_id(path, "_"))


def _dedupe(sessions: list[Session]) -> list[Session]:
    found: dict[tuple[str, str], Session] = {}
    for session in sessions:
        key = (session.platform, session.id)
        current = found.get(key)
        if current is None or _linkage_score(session) > _linkage_score(current):
            found[key] = session
    return list(found.values())


def _linkage_score(session: Session) -> int:
    return int(session.parent_id is not None) + int(session.agent is not None)
