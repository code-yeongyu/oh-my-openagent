from __future__ import annotations

import shutil
import sqlite3
import subprocess
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import TypeAlias

from .jsonio import as_map, int_value, parse_json_text, read_json, text
from .timeparse import unix_millis
from .transcript import env_path, existing
from .types import JsonMap, Session

MAX_OPENCODE_SESSIONS = 50000
MAX_OPENCODE_CLI_SESSIONS = 100
OPENCODE_TIMEOUT_SECONDS = 8
SESSION_SQL = (
    "select id, title, directory, time_created, time_updated, cost, tokens_input, tokens_output, "
    "tokens_reasoning, tokens_cache_read, tokens_cache_write, model, parent_id, agent "
    "from session where time_archived is null "
    f"order by time_updated desc limit {MAX_OPENCODE_SESSIONS}"
)
LEGACY_SESSION_SQL = (
    "select id, title, directory, time_created, time_updated, cost, tokens_input, tokens_output, "
    "tokens_reasoning, tokens_cache_read, tokens_cache_write, model "
    "from session where time_archived is null "
    "order by time_updated desc limit 2000"
)
SqlValue: TypeAlias = str | int | float | bytes | None
OpenCodeRow: TypeAlias = tuple[SqlValue, ...]


def scan_opencode(extra_roots: tuple[Path, ...], workers: int) -> list[Session]:
    if not extra_roots:
        sessions = _db_sessions()
        if sessions:
            return sessions
        sessions = _cli_sessions()
        if sessions:
            return sessions
    appdata = env_path("APPDATA")
    roots = existing([
        *(path for path in (env_path("OPENCODE_HOME"),) if path is not None),
        Path.home() / ".opencode",
        Path.home() / ".local" / "share" / "opencode",
        *(path / "opencode" for path in (appdata,) if path is not None),
        *extra_roots,
    ])
    message_dirs = [message_dir for root in roots for message_dir in (root / "messages").glob("ses_*")]
    sessions: list[Session] = []
    if message_dirs:
        with ThreadPoolExecutor(max_workers=min(workers, len(message_dirs))) as pool:
            futures = [pool.submit(_file_session, message_dir.parents[1], message_dir) for message_dir in message_dirs]
            for future in as_completed(futures):
                session = future.result()
                if session is not None:
                    sessions.append(session)
    sessions.extend(_storage_sessions(roots))
    return sessions


def _storage_sessions(roots: list[Path]) -> list[Session]:
    sessions: list[Session] = []
    for root in roots:
        for path in (root / "storage" / "session").glob("*/ses_*.json"):
            info = as_map(read_json(path))
            if info is None:
                continue
            time_info = as_map(info.get("time")) or {}
            sessions.append(
                Session(
                    "opencode",
                    text(info.get("id")) or path.stem,
                    str(path),
                    text(info.get("directory")),
                    unix_millis(int_value(time_info.get("created"))),
                    unix_millis(int_value(time_info.get("updated"))),
                    None,
                    None,
                    text(info.get("title")) or "",
                    {},
                    text(info.get("parentID")),
                    text(info.get("agent")),
                )
            )
    return sessions


def _db_sessions() -> list[Session]:
    path = _db_path()
    if path is None:
        return []
    conn: sqlite3.Connection | None = None
    try:
        conn = sqlite3.connect(str(path), timeout=3)
        rows: list[OpenCodeRow] = _session_rows(conn)
    except sqlite3.Error:
        return []
    finally:
        if conn is not None:
            conn.close()
    return [_db_session(row) for row in rows]


def _session_rows(conn: sqlite3.Connection) -> list[OpenCodeRow]:
    try:
        return conn.execute(SESSION_SQL).fetchall()
    except sqlite3.Error:
        return conn.execute(LEGACY_SESSION_SQL).fetchall()


def _db_path() -> Path | None:
    data = _opencode_text(["db", "path"])
    candidates = [Path(data.strip()).expanduser()] if data else []
    appdata = env_path("APPDATA")
    candidates.extend([Path.home() / ".local" / "share" / "opencode" / "opencode.db"])
    candidates.extend(path / "opencode" / "opencode.db" for path in (appdata,) if path is not None)
    for path in candidates:
        if str(path) and path.exists():
            return path
    return None


def _db_session(row: OpenCodeRow) -> Session:
    session_id = _row_text(row, 0) or ""
    title = _row_text(row, 1) or ""
    model = as_map(parse_json_text(_row_text(row, 11) or ""))
    return Session(
        "opencode",
        session_id,
        f"opencode://{session_id}",
        _row_text(row, 2),
        unix_millis(_row_int(row, 3)),
        unix_millis(_row_int(row, 4)),
        text(model.get("providerID")) if model is not None else None,
        text(model.get("id")) if model is not None else None,
        title,
        _db_usage(row),
        _row_text(row, 12),
        _row_text(row, 13),
    )


def _db_usage(row: OpenCodeRow) -> JsonMap:
    usage: JsonMap = {}
    for index, key in ((5, "cost_total"), (6, "input"), (7, "output"), (8, "reasoning"), (9, "cacheRead"), (10, "cacheWrite")):
        value = _row_number(row, index)
        if value is not None:
            usage[key] = value
    return usage


def _row_text(row: OpenCodeRow, index: int) -> str | None:
    value = row[index] if index < len(row) else None
    return value if isinstance(value, str) else None


def _row_number(row: OpenCodeRow, index: int) -> int | float | None:
    value = row[index] if index < len(row) else None
    return value if isinstance(value, int | float) else None


def _row_int(row: OpenCodeRow, index: int) -> int | None:
    value = row[index] if index < len(row) else None
    return value if isinstance(value, int) else None


def _cli_sessions() -> list[Session]:
    data = _opencode_json(["session", "list", "--format", "json", "--max-count", str(MAX_OPENCODE_CLI_SESSIONS)])
    if not isinstance(data, list):
        return []
    return [_cli_session(item) for item in data]


def _cli_session(item: JsonMap) -> Session:
    session_id = text(item.get("id")) or ""
    title = text(item.get("title")) or ""
    usage = _usage(item)
    return Session(
        "opencode",
        session_id,
        f"opencode://{session_id}",
        text(item.get("directory")),
        unix_millis(int_value(item.get("created"))),
        unix_millis(int_value(item.get("updated"))),
        None,
        None,
        title,
        usage,
    )


def _opencode_json(args: list[str]) -> JsonMap | list[JsonMap] | None:
    data = _opencode_text(args)
    return _json_result(data) if data is not None else None


def _opencode_text(args: list[str]) -> str | None:
    binary = shutil.which("opencode")
    if binary is None:
        return None
    try:
        proc = subprocess.run(
            [binary, *args],
            check=False,
            capture_output=True,
            text=True,
            timeout=OPENCODE_TIMEOUT_SECONDS,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    if proc.returncode != 0:
        return None
    return proc.stdout


def _json_result(value: str) -> JsonMap | list[JsonMap] | None:
    data = parse_json_text(value)
    if isinstance(data, dict):
        return data
    if isinstance(data, list):
        rows = [item for item in data if isinstance(item, dict)]
        return rows
    return None


def _usage(item: JsonMap) -> JsonMap:
    usage: JsonMap = {}
    cost = item.get("cost")
    tokens = as_map(item.get("tokens"))
    if isinstance(cost, int | float):
        usage["cost_total"] = cost
    if tokens is not None:
        for key in ("input", "output", "reasoning", "cacheRead", "cacheWrite"):
            value = tokens.get(key)
            if isinstance(value, int | float):
                usage[key] = value
    return usage


def _file_session(root: Path, message_dir: Path) -> Session | None:
    messages = sorted(message_dir.glob("*.json"), key=lambda item: item.name)
    first = as_map(read_json(messages[0])) if messages else None
    if first is None:
        return None
    session_id = text(first.get("sessionID")) or message_dir.name
    model = as_map(first.get("model")) or {}
    path_info = as_map(first.get("path")) or {}
    stamps = [_message_millis(path) for path in messages]
    known = [stamp for stamp in stamps if stamp is not None]
    first_prompt, last_prompt = _prompt_edges(root, session_id, messages)
    return Session(
        "opencode",
        session_id,
        str(message_dir),
        text(path_info.get("cwd")),
        unix_millis(min(known) if known else None),
        unix_millis(max(known) if known else None),
        text(model.get("providerID")),
        text(model.get("modelID")),
        first_prompt,
        {"message_count": len(messages)},
        last_user_message=last_prompt,
    )


def _prompt_edges(root: Path, session_id: str, messages: list[Path]) -> tuple[str, str]:
    first_prompt = ""
    last_prompt = ""
    for path in messages:
        data = as_map(read_json(path))
        if data is None or data.get("role") != "user":
            continue
        message_id = text(data.get("id"))
        for part in (root / "parts" / (message_id or "")).glob("*.json"):
            part_data = as_map(read_json(part))
            if part_data is not None and part_data.get("sessionID") == session_id:
                value = text(part_data.get("text"))
                if value:
                    first_prompt = first_prompt or value
                    last_prompt = value
    return first_prompt, last_prompt


def _message_millis(path: Path) -> int | None:
    data = as_map(read_json(path))
    time_data = as_map(data.get("time")) if data is not None else None
    return int_value(time_data.get("created")) if time_data is not None else None
