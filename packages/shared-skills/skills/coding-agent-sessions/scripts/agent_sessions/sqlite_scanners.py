from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import TypeAlias

from .jsonio import as_map, parse_json_text, text
from .timeparse import file_time, unix_millis
from .transcript import content_text, env_path, existing, flat_parallel, recent
from .types import Json, JsonMap, Session

SqlValue: TypeAlias = str | int | float | bytes | None
SqlRow: TypeAlias = tuple[SqlValue, ...]


def scan_kodu(extra_roots: tuple[Path, ...], workers: int) -> list[Session]:
    appdata = env_path("APPDATA")
    roots = _roots(
        [
            Path.home() / "Library" / "Application Support" / "Code" / "User" / "globalStorage" / "kodu-ai.claude-dev-experimental",
            Path.home() / ".config" / "Code" / "User" / "globalStorage" / "kodu-ai.claude-dev-experimental",
            *(path / "Code" / "User" / "globalStorage" / "kodu-ai.claude-dev-experimental" for path in (appdata,) if path is not None),
        ],
        extra_roots,
        ("kodu-ai.claude-dev-experimental",),
    )
    paths = [root / "db" / "Azad.db" for root in roots if (root / "db" / "Azad.db").exists()]
    return flat_parallel(recent(paths), workers, _kodu_db)


def scan_cursor_cli(extra_roots: tuple[Path, ...], workers: int) -> list[Session]:
    roots = _roots([Path.home() / ".cursor"], extra_roots, (".cursor",))
    paths = [path for root in roots for path in (root / "chats").glob("*/*/store.db")]
    return flat_parallel(recent(paths), workers, _cursor_db)


def _kodu_db(path: Path) -> list[Session]:
    try:
        with sqlite3.connect(path) as conn:
            tasks = _fetch_all(
                conn,
                "select id, name, dir_absolute_path, created_at, updated_at, tokens_in, tokens_out, cache_reads, cache_writes, cost from tasks"
            )
            return [_kodu_session(path, conn, row) for row in tasks]
    except sqlite3.Error:
        return []


def _kodu_session(path: Path, conn: sqlite3.Connection, row: SqlRow) -> Session:
    sid = _row_text(row, 0) or ""
    messages = _fetch_all(
        conn,
        "select role, content, model_id, started_at, finished_at, tokens_in, tokens_out, cache_reads, cache_writes, cost from messages where task_id = ? order by started_at",
        (sid,),
    )
    first_user = last_user = ""
    model = None
    for message in messages:
        model = model or _row_text(message, 2)
        if _row_text(message, 0) == "user":
            prompt = _content(_row_text(message, 1))
            first_user = first_user or prompt
            last_user = prompt
    return Session(
        "kodu",
        sid,
        str(path),
        _row_text(row, 2),
        unix_millis(_row_int(row, 3)),
        unix_millis(_row_int(row, 4)) or file_time(path),
        None,
        model,
        first_user,
        _usage(row, (5, "input"), (6, "output"), (7, "cacheRead"), (8, "cacheWrite"), (9, "cost_total")),
        last_user_message=last_user,
    )


def _cursor_db(path: Path) -> list[Session]:
    try:
        with sqlite3.connect(path) as conn:
            rows = _fetch_all(conn, "select data from blobs")
    except sqlite3.Error:
        return []
    first_user = last_user = ""
    for row in rows:
        data = _json_blob(_row_bytes(row, 0))
        if data is None or data.get("role") != "user":
            continue
        prompt = _cursor_prompt(_content(data.get("content")))
        if prompt:
            first_user = first_user or prompt
            last_user = prompt
    if not first_user:
        return []
    return [
        Session(
            "cursor-cli",
            path.parent.name,
            str(path),
            None,
            file_time(path),
            file_time(path),
            "cursor",
            None,
            first_user,
            {"blob_count": len(rows)},
            last_user_message=last_user,
        )
    ]


def _content(value: Json | None) -> str:
    parsed = parse_json_text(value) if isinstance(value, str) else value
    return content_text(parsed) or (value if isinstance(value, str) else "")


def _json_blob(value: bytes | None) -> JsonMap | None:
    if value is None:
        return None
    try:
        decoded = value.decode()
    except UnicodeDecodeError:
        return None
    return as_map(parse_json_text(decoded))


def _cursor_prompt(value: str) -> str:
    start = value.find("<user_query>")
    end = value.find("</user_query>")
    if start >= 0 and end > start:
        return value[start + len("<user_query>") : end].strip()
    if value.lstrip().startswith("<user_info>"):
        return ""
    return value.strip()


def _usage(row: SqlRow, *fields: tuple[int, str]) -> JsonMap:
    result: JsonMap = {}
    for index, key in fields:
        value = _row_number(row, index)
        if value is not None:
            result[key] = value
    return result


def _fetch_all(conn: sqlite3.Connection, sql: str, params: tuple[str, ...] = ()) -> list[SqlRow]:
    rows: list[SqlRow] = conn.execute(sql, params).fetchall()
    return rows


def _row_text(row: SqlRow, index: int) -> str | None:
    value = row[index] if index < len(row) else None
    return text(value) if not isinstance(value, bytes) else None


def _row_bytes(row: SqlRow, index: int) -> bytes | None:
    value = row[index] if index < len(row) else None
    return value if isinstance(value, bytes) else None


def _row_number(row: SqlRow, index: int) -> int | float | None:
    value = row[index] if index < len(row) else None
    return value if isinstance(value, int | float) else None


def _row_int(row: SqlRow, index: int) -> int | None:
    value = row[index] if index < len(row) else None
    return value if isinstance(value, int) else None


def _roots(defaults: list[Path], extra_roots: tuple[Path, ...], children: tuple[str, ...]) -> list[Path]:
    candidates = [*defaults]
    for root in extra_roots:
        candidates.append(root)
        candidates.extend(root / child for child in children)
    return existing(candidates)
