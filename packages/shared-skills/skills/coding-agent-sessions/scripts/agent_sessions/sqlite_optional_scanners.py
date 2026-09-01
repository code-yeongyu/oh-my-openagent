from __future__ import annotations

import sqlite3
from collections.abc import Iterable
from pathlib import Path

from .jsonio import as_map, parse_json_text, text
from .timeparse import file_time, unix_millis
from .transcript import content_text, existing, flat_parallel, recent
from .types import JsonMap, Session

SqlValue = str | int | float | bytes | None
SqlRow = tuple[SqlValue, ...]


def scan_kilo_cli(extra_roots: tuple[Path, ...], workers: int) -> list[Session]:
    paths = existing([Path.home() / ".local" / "share" / "kilo" / "kilo.db", *(root / "kilo.db" for root in extra_roots)])
    return flat_parallel(recent(paths), workers, lambda path: _message_table_sessions(path, "kilo-cli", "message"))


def scan_hermes(extra_roots: tuple[Path, ...], workers: int) -> list[Session]:
    paths = existing([Path.home() / ".hermes" / "state.db", *(root / "state.db" for root in extra_roots)])
    return flat_parallel(recent(paths), workers, lambda path: _message_table_sessions(path, "hermes", "messages"))


def scan_goose(extra_roots: tuple[Path, ...], workers: int) -> list[Session]:
    defaults = [
        Path.home() / ".local" / "share" / "goose" / "sessions" / "sessions.db",
        Path.home() / "Library" / "Application Support" / "goose" / "sessions" / "sessions.db",
    ]
    paths = existing([*defaults, *(root / "sessions.db" for root in extra_roots)])
    return flat_parallel(recent(paths), workers, lambda path: _message_table_sessions(path, "goose", "messages"))


def scan_crush(extra_roots: tuple[Path, ...], workers: int) -> list[Session]:
    paths = existing([Path.home() / ".local" / "share" / "crush" / "crush.db", *(root / "crush.db" for root in extra_roots)])
    return flat_parallel(recent(paths), workers, _crush_sessions)


def scan_zed(extra_roots: tuple[Path, ...], workers: int) -> list[Session]:
    paths = existing([Path.home() / "Library" / "Application Support" / "Zed" / "threads" / "threads.db", *(root / "threads.db" for root in extra_roots)])
    return flat_parallel(recent(paths), workers, _zed_sessions)


def _message_table_sessions(path: Path, platform: str, table: str) -> list[Session]:
    try:
        with sqlite3.connect(path) as conn:
            rows = _fetch_all(conn, f"select session_id, role, data, created_at from {table} order by created_at")
    except sqlite3.Error:
        return []
    return _group_message_rows(platform, path, rows)


def _crush_sessions(path: Path) -> list[Session]:
    try:
        with sqlite3.connect(path) as conn:
            rows = _fetch_all(conn, "select session_id, role, parts, created_at from messages order by created_at")
    except sqlite3.Error:
        return []
    return _group_message_rows("crush", path, rows)


def _zed_sessions(path: Path) -> list[Session]:
    try:
        with sqlite3.connect(path) as conn:
            rows = _fetch_all(conn, "select id, data_type, data, updated_at from threads")
    except sqlite3.Error:
        return []
    sessions: list[Session] = []
    for row in rows:
        if _row_text(row, 1) != "json":
            continue
        data = _json_blob(_row_bytes(row, 2))
        messages = _json_messages(data)
        first_user, last_user = _message_edges(messages)
        if not first_user:
            continue
        sid = _row_text(row, 0) or path.stem
        sessions.append(Session("zed", sid, str(path), None, _row_text(row, 3) or file_time(path), _row_text(row, 3) or file_time(path), "zed.dev", _zed_model(data), first_user, {"message_count": len(messages)}, last_user_message=last_user))
    return sessions


def _group_message_rows(platform: str, path: Path, rows: Iterable[SqlRow]) -> list[Session]:
    grouped: dict[str, list[JsonMap]] = {}
    stamps: dict[str, str] = {}
    for row in rows:
        sid = _row_text(row, 0)
        if sid is None:
            continue
        message = _message_json(row)
        if message is None:
            continue
        if sid not in grouped:
            grouped[sid] = []
        grouped[sid].append(message)
        if sid not in stamps:
            stamps[sid] = _stamp(row, 3) or file_time(path) or ""
    sessions: list[Session] = []
    for sid, messages in grouped.items():
        first_user, last_user = _message_edges(messages)
        if not first_user:
            continue
        sessions.append(Session(platform, sid, str(path), None, stamps.get(sid) or file_time(path), file_time(path), _provider(messages), _model(messages), first_user, {"message_count": len(messages)}, last_user_message=last_user))
    return sessions


def _message_json(row: SqlRow) -> JsonMap | None:
    role = _row_text(row, 1)
    raw = _row_json(row, 2)
    if raw is None:
        return {"role": role or "", "content": _row_text(row, 2) or ""}
    if "role" not in raw:
        raw["role"] = role or text(raw.get("role")) or ""
    return raw


def _message_edges(messages: list[JsonMap]) -> tuple[str, str]:
    first_user = last_user = ""
    for message in messages:
        if text(message.get("role")) != "user":
            continue
        prompt = _content(message)
        if prompt:
            first_user = first_user or prompt
            last_user = prompt
    return first_user, last_user


def _content(message: JsonMap) -> str:
    for key in ("content", "parts", "text"):
        value = message.get(key)
        parsed = parse_json_text(value) if isinstance(value, str) else value
        result = content_text(parsed) or (value if isinstance(value, str) else "")
        if result:
            return result
    return ""


def _json_messages(data: JsonMap | None) -> list[JsonMap]:
    if data is None:
        return []
    for key in ("messages", "turns", "entries"):
        value = data.get(key)
        if isinstance(value, list):
            return [item for item in value if isinstance(item, dict)]
    return []


def _model(messages: list[JsonMap]) -> str | None:
    for message in messages:
        model = text(message.get("modelID")) or text(message.get("model_id")) or text(message.get("model"))
        if model:
            return model
    return None


def _provider(messages: list[JsonMap]) -> str | None:
    for message in messages:
        provider = text(message.get("providerID")) or text(message.get("provider_id")) or text(message.get("provider"))
        if provider:
            return provider
    return None


def _zed_model(data: JsonMap | None) -> str | None:
    model = as_map(data.get("model")) if data is not None else None
    return text(model.get("model")) if model is not None else None


def _fetch_all(conn: sqlite3.Connection, sql: str) -> list[SqlRow]:
    rows: list[SqlRow] = conn.execute(sql).fetchall()
    return rows


def _row_json(row: SqlRow, index: int) -> JsonMap | None:
    value = _row_text(row, index)
    return as_map(parse_json_text(value)) if value is not None else None


def _json_blob(value: bytes | None) -> JsonMap | None:
    if value is None:
        return None
    try:
        return as_map(parse_json_text(value.decode()))
    except UnicodeDecodeError:
        return None


def _row_text(row: SqlRow, index: int) -> str | None:
    value = row[index] if index < len(row) else None
    return text(value) if not isinstance(value, bytes) else None


def _row_bytes(row: SqlRow, index: int) -> bytes | None:
    value = row[index] if index < len(row) else None
    return value if isinstance(value, bytes) else None


def _stamp(row: SqlRow, index: int) -> str | None:
    value = row[index] if index < len(row) else None
    if isinstance(value, int):
        return unix_millis(value) if value > 10_000_000_000 else None
    return value if isinstance(value, str) else None
