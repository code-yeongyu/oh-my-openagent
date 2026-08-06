from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from pathlib import Path
from typing import TypeAlias

from .jsonio import as_map, iter_jsonl, parse_json_text, text
from .timeparse import file_time, unix_millis, unix_seconds
from .transcript import content_text, existing, flat_parallel, merge_usage, recent
from .types import JsonMap, Session

SqlValue: TypeAlias = str | int | float | bytes | None
SqlRow: TypeAlias = tuple[SqlValue, ...]


@dataclass(frozen=True, slots=True)
class _StateRow:
    parent_id: str | None
    title: str | None
    cwd: str | None
    provider: str | None
    model: str | None
    created_at: str | None
    updated_at: str | None


def scan_aside(extra_roots: tuple[Path, ...], workers: int) -> list[Session]:
    roots = _roots([Path.home() / ".aside"], extra_roots, (".aside",))
    sessions: list[Session] = []
    for user_dir in _user_dirs(roots):
        index = _state_index(user_dir / "state.db")
        paths = list((user_dir / "sessions").glob("*/messages.jsonl"))
        sessions.extend(flat_parallel(recent(paths), workers, lambda path, rows=index: [_aside_session(path, rows)]))
    return sessions


def _user_dirs(roots: list[Path]) -> list[Path]:
    dirs: list[Path] = []
    for root in roots:
        users = sorted(path for path in (root / "u").glob("*") if path.is_dir())
        if users:
            dirs.extend(users)
        elif (root / "sessions").exists():
            dirs.append(root)
    return dirs


def _state_index(db_path: Path) -> dict[str, _StateRow]:
    if not db_path.exists():
        return {}
    try:
        with sqlite3.connect(f"file:{db_path}?mode=ro", uri=True) as conn:
            rows: list[SqlRow] = conn.execute("select id, parent_id, title, cwd, model, created_at, updated_at from sessions").fetchall()
    except sqlite3.Error:
        return {}
    index: dict[str, _StateRow] = {}
    for row in rows:
        sid = _cell_text(row, 0)
        if sid is None:
            continue
        provider, model = _model_fields(_cell_text(row, 4))
        index[sid] = _StateRow(
            _cell_text(row, 1),
            _cell_text(row, 2),
            _cell_text(row, 3),
            provider,
            model,
            unix_seconds(_cell_number(row, 5)),
            unix_seconds(_cell_number(row, 6)),
        )
    return index


def _cell_text(row: SqlRow, index: int) -> str | None:
    value = row[index] if index < len(row) else None
    return value if isinstance(value, str) else None


def _cell_number(row: SqlRow, index: int) -> int | float | None:
    value = row[index] if index < len(row) else None
    return value if isinstance(value, int | float) else None


def _model_fields(model_json: str | None) -> tuple[str | None, str | None]:
    data = as_map(parse_json_text(model_json)) if model_json else None
    if data is None:
        return None, None
    return text(data.get("provider")), text(data.get("modelId")) or text(data.get("model"))


def _aside_session(path: Path, index: dict[str, _StateRow]) -> Session:
    sid = _dir_session_id(path.parent.name)
    row = index.get(sid)
    first_user = last_user = ""
    provider = model = None
    created = updated = None
    usage: JsonMap = {}
    for data in iter_jsonl(path):
        stamp = data.get("timestamp")
        moment = unix_millis(int(stamp)) if isinstance(stamp, int | float) else None
        created = created or moment
        updated = moment or updated
        role = text(data.get("role"))
        if role == "user":
            prompt = content_text(data.get("content"))
            if prompt:
                first_user = first_user or prompt
                last_user = prompt
        elif role == "assistant":
            provider = provider or text(data.get("provider"))
            model = model or text(data.get("model"))
            merge_usage(usage, as_map(data.get("usage")))
    return Session(
        "aside",
        sid,
        str(path),
        row.cwd if row is not None else None,
        (row.created_at if row is not None else None) or created or file_time(path),
        (row.updated_at if row is not None else None) or updated or created or file_time(path),
        (row.provider if row is not None else None) or provider,
        (row.model if row is not None else None) or model,
        first_user,
        usage,
        row.parent_id if row is not None else None,
        row.title if row is not None and row.parent_id is not None else None,
        last_user,
    )


def _dir_session_id(name: str) -> str:
    return name.split("_", 1)[-1]


def _roots(defaults: list[Path], extra_roots: tuple[Path, ...], children: tuple[str, ...]) -> list[Path]:
    candidates = [*defaults]
    for root in extra_roots:
        candidates.append(root)
        candidates.extend(root / child for child in children)
    return existing(candidates)
