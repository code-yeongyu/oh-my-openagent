from __future__ import annotations

from pathlib import Path

from .jsonio import as_map, iter_jsonl, read_json, text
from .timeparse import file_time, unix_seconds
from .transcript import existing, flat_parallel, recent
from .types import Json, JsonMap, Session


def scan_kiro(extra_roots: tuple[Path, ...], workers: int) -> list[Session]:
    roots = _roots([Path.home() / ".kiro"], extra_roots, (".kiro", "kiro"))
    paths = [path for root in roots for path in (root / "sessions" / "cli").glob("*.json")]
    return flat_parallel(recent(paths), workers, _kiro_sessions)


def _kiro_sessions(path: Path) -> list[Session]:
    data = as_map(read_json(path))
    if data is None:
        return []
    state = as_map(data.get("session_state")) or {}
    rts_state = as_map(state.get("rts_model_state")) or {}
    model_info = as_map(rts_state.get("model_info")) or {}
    metadata = as_map(state.get("conversation_metadata")) or {}
    turns = metadata.get("user_turn_metadatas")
    first_user, last_user, created = _kiro_prompt_edges(path.with_suffix(".jsonl"))
    if not first_user:
        return []
    usage: JsonMap = {"turn_count": len(turns)} if isinstance(turns, list) else {}
    return [
        Session(
            "kiro",
            text(data.get("session_id")) or text(data.get("sessionId")) or path.stem,
            str(path),
            text(data.get("cwd")),
            created or file_time(path),
            file_time(path),
            "amazon-bedrock",
            text(model_info.get("model_id")),
            first_user,
            usage,
            last_user_message=last_user,
        )
    ]


def _kiro_prompt_edges(path: Path) -> tuple[str, str, str | None]:
    first_user = last_user = ""
    created = None
    for row in iter_jsonl(path):
        if row.get("kind") != "Prompt":
            continue
        data = as_map(row.get("data")) or {}
        prompt = _kiro_content(data.get("content"))
        if prompt:
            first_user = first_user or prompt
            last_user = prompt
        meta = as_map(data.get("meta")) or {}
        stamp = meta.get("timestamp")
        if created is None and isinstance(stamp, int | float):
            created = unix_seconds(stamp)
    return first_user, last_user, created


def _kiro_content(value: Json | None) -> str:
    if not isinstance(value, list):
        return text(value) or ""
    parts: list[str] = []
    for item in value:
        part = _kiro_content_part(item)
        if part:
            parts.append(part)
    return "\n".join(parts)


def _kiro_content_part(value: Json) -> str:
    if not isinstance(value, dict):
        return ""
    item: JsonMap = value
    kind = text(item.get("kind"))
    if kind is not None and kind != "text":
        return ""
    return text(item.get("data")) or text(item.get("text")) or text(item.get("content")) or ""


def _roots(defaults: list[Path], extra_roots: tuple[Path, ...], children: tuple[str, ...]) -> list[Path]:
    candidates = [*defaults]
    for root in extra_roots:
        candidates.append(root)
        candidates.extend(root / child for child in children)
    return existing(candidates)
