from __future__ import annotations

import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from heapq import nlargest
from pathlib import Path
from typing import Callable

from .jsonio import as_map, iter_jsonl, parse_json_text, text
from .timeparse import file_time
from .types import Json, JsonMap, Session

MAX_PLATFORM_FILES = 2000


def jsonl_parallel(paths: list[Path], workers: int, platform: str, fallback_id: Callable[[Path], str]) -> list[Session]:
    if not paths:
        return []
    sessions: list[Session] = []
    with ThreadPoolExecutor(max_workers=min(workers, max(len(paths), 1))) as pool:
        futures = [pool.submit(jsonl_session, platform, path, fallback_id(path)) for path in paths]
        for future in as_completed(futures):
            sessions.append(future.result())
    return sessions


def flat_parallel(paths: list[Path], workers: int, read: Callable[[Path], list[Session]]) -> list[Session]:
    if not paths:
        return []
    sessions: list[Session] = []
    with ThreadPoolExecutor(max_workers=min(workers, max(len(paths), 1))) as pool:
        futures = [pool.submit(read, path) for path in paths]
        for future in as_completed(futures):
            sessions.extend(future.result())
    return sessions


def jsonl_session(platform: str, path: Path, fallback_id: str) -> Session:
    sid = fallback_id
    cwd = provider = model = first_user = parent = agent = None
    last_user = ""
    created = updated = None
    usage: JsonMap = {}
    for data in iter_jsonl(path):
        event_type = data.get("type")
        session_line_id = text(data.get("id")) if event_type == "session" else None
        sid = text(data.get("sessionId")) or session_line_id or sid
        cwd = cwd or text(data.get("cwd"))
        created = created or text(data.get("timestamp"))
        updated = text(data.get("timestamp")) or updated
        provider = provider or text(data.get("provider"))
        model = model or text(data.get("modelId")) or text(data.get("model"))
        payload = as_map(data.get("payload"))
        if event_type == "session_meta" and payload is not None:
            sid = text(payload.get("id")) or sid
            cwd = cwd or text(payload.get("cwd"))
            provider = provider or text(payload.get("model_provider"))
            source_parent, source_agent = spawn_info(payload.get("source"))
            parent = parent or source_parent
            agent = agent or source_agent or nick_role(text(payload.get("agent_nickname")), text(payload.get("agent_role")))
        message = as_map(data.get("message")) or payload or {}
        provider = provider or text(message.get("provider"))
        model = model or text(message.get("model"))
        prompt = user_text(data, message)
        if prompt:
            first_user = first_user or prompt
            last_user = prompt
        merge_usage(usage, as_map(message.get("usage")) or as_map(data.get("usage")))
    return Session(platform, sid, str(path), cwd, created or file_time(path), updated or created or file_time(path), provider, model, first_user or "", usage, parent, agent, last_user)


def spawn_info(source: Json | None) -> tuple[str | None, str | None]:
    data = as_map(parse_json_text(source) if isinstance(source, str) else source)
    if data is None:
        return None, None
    subagent = data.get("subagent")
    if isinstance(subagent, str):
        return None, subagent
    subagent_map = as_map(subagent)
    spawn = as_map(subagent_map.get("thread_spawn")) if subagent_map is not None else None
    if spawn is None:
        return None, None
    return text(spawn.get("parent_thread_id")), nick_role(text(spawn.get("agent_nickname")), text(spawn.get("agent_role")))


def nick_role(nickname: str | None, role: str | None) -> str | None:
    if nickname and role:
        return f"{nickname} ({role})"
    return nickname or role


def user_text(data: JsonMap, message: JsonMap) -> str:
    if data.get("type") == "user":
        value = content_text(data.get("content"))
        if value:
            return value
    if message.get("role") == "user":
        return content_text(message.get("content"))
    return ""


def content_text(value: Json | None) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        parts = [text(item.get("text")) or text(item.get("content")) or "" for item in value if isinstance(item, dict)]
        return "\n".join(part for part in parts if part)
    return ""


def merge_usage(target: JsonMap, value: JsonMap | None) -> None:
    if value is None:
        return
    for key in ("totalTokens", "total_tokens", "input", "output", "cacheRead", "cacheWrite"):
        if key in value:
            target[key] = value[key]
    cost = as_map(value.get("cost"))
    if cost is not None and "total" in cost:
        target["cost_total"] = cost["total"]


def existing(paths: list[Path]) -> list[Path]:
    seen: set[Path] = set()
    result: list[Path] = []
    for path in paths:
        if str(path) and path.exists() and path not in seen:
            seen.add(path)
            result.append(path)
    return result


def recent(paths: list[Path]) -> list[Path]:
    return nlargest(MAX_PLATFORM_FILES, paths, key=modified_time)


def modified_time(path: Path) -> float:
    try:
        return path.stat().st_mtime
    except OSError:
        return 0.0


def stem_id(path: Path, marker: str) -> str:
    return path.stem.split(marker)[-1].split("_")[-1]


def env_path(name: str) -> Path | None:
    value = os.environ.get(name)
    return Path(value).expanduser() if value else None
