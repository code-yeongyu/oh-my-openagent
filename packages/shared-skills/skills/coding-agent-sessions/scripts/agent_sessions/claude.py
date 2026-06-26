from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from .jsonio import as_map, iter_jsonl, read_json, text
from .timeparse import file_time
from .transcript import content_text, env_path, existing, jsonl_parallel, recent
from .types import Session


def scan_claude(extra_roots: tuple[Path, ...], workers: int) -> list[Session]:
    appdata = env_path("APPDATA")
    roots = existing([Path.home() / ".claude", *(path / "Claude" for path in (appdata,) if path is not None), *extra_roots])
    mains: list[Path] = []
    subagents: list[Path] = []
    for root in roots:
        mains.extend((root / "transcripts").glob("*.jsonl"))
        mains.extend((root / "projects").glob("*/*.jsonl"))
        mains.extend((root / "pre-compact-session-histories").glob("*.jsonl"))
        subagents.extend((root / "projects").glob("*/*/subagents/**/agent-*.jsonl"))
    sessions = jsonl_parallel(recent(mains), workers, "claude", lambda path: path.stem)
    sessions.extend(_subagent_parallel(recent(subagents), workers))
    return sessions


def _subagent_parallel(paths: list[Path], workers: int) -> list[Session]:
    if not paths:
        return []
    sessions: list[Session] = []
    with ThreadPoolExecutor(max_workers=min(workers, max(len(paths), 1))) as pool:
        futures = [pool.submit(_subagent_session, path) for path in paths]
        for future in as_completed(futures):
            session = future.result()
            if session is not None:
                sessions.append(session)
    return sessions


def _subagent_session(path: Path) -> Session | None:
    parts = path.parts
    if "subagents" not in parts:
        return None
    parent_sid = parts[parts.index("subagents") - 1]
    meta = as_map(read_json(path.with_name(path.stem + ".meta.json"))) or {}
    first = next(iter_jsonl(path), None) or {}
    message = as_map(first.get("message")) or {}
    description = text(meta.get("description")) or ""
    task = content_text(message.get("content"))
    prompt = "\n".join(part for part in (description, task) if part)
    created = text(first.get("timestamp")) or file_time(path)
    return Session(
        "claude",
        path.stem.removeprefix("agent-"),
        str(path),
        text(first.get("cwd")),
        created,
        file_time(path) or created,
        None,
        None,
        prompt,
        {},
        parent_sid,
        text(meta.get("agentType")),
        prompt,
    )
