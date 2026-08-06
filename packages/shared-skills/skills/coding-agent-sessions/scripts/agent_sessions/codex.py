from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import TypeAlias

from .timeparse import unix_seconds
from .transcript import env_path, existing, flat_parallel, jsonl_parallel, nick_role, recent, spawn_info, stem_id
from .types import Json, Session

THREADS_SQL = (
    "SELECT id, rollout_path, cwd, created_at, updated_at, model_provider, model, first_user_message, tokens_used, "
    "source, agent_nickname, agent_role FROM threads"
)
LEGACY_THREADS_SQL = (
    "SELECT id, rollout_path, cwd, created_at, updated_at, model_provider, model, first_user_message, tokens_used FROM threads"
)
SPAWN_EDGES_SQL = "SELECT child_thread_id, parent_thread_id FROM thread_spawn_edges"

SqliteScalar: TypeAlias = str | int | float | bytes | None
CodexRow: TypeAlias = tuple[SqliteScalar, ...]


def scan_codex(extra_roots: tuple[Path, ...], workers: int) -> list[Session]:
    roots = existing([*(path for path in (env_path("CODEX_HOME"),) if path is not None), Path.home() / ".codex", *extra_roots])
    db_paths: list[Path] = []
    rollouts: list[Path] = []
    for root in roots:
        db_paths.extend(root.glob("state_*.sqlite"))
        rollouts.extend((root / "sessions").rglob("rollout-*.jsonl"))
        rollouts.extend((root / "archived_sessions").glob("rollout-*.jsonl"))
    sessions = flat_parallel(db_paths, workers, _codex_db)
    sessions.extend(jsonl_parallel(recent(rollouts), workers, "codex", lambda path: stem_id(path, "rollout-")))
    return sessions


def _codex_db(path: Path) -> list[Session]:
    conn: sqlite3.Connection | None = None
    try:
        conn = sqlite3.connect(str(path), timeout=3)
        edges = _spawn_edges(conn)
        rows = _thread_rows(conn)
    except sqlite3.Error:
        return []
    finally:
        if conn is not None:
            conn.close()
    return [_codex_row(path, row, edges) for row in rows]


def _thread_rows(conn: sqlite3.Connection) -> list[CodexRow]:
    try:
        primary_rows: list[CodexRow] = conn.execute(THREADS_SQL).fetchall()
        return primary_rows
    except sqlite3.Error:
        legacy_rows: list[CodexRow] = conn.execute(LEGACY_THREADS_SQL).fetchall()
        return legacy_rows


def _spawn_edges(conn: sqlite3.Connection) -> dict[str, str]:
    try:
        rows: list[CodexRow] = conn.execute(SPAWN_EDGES_SQL).fetchall()
    except sqlite3.Error:
        return {}
    edges: dict[str, str] = {}
    for row in rows:
        child = _row_text(_row_value(row, 0))
        parent = _row_text(_row_value(row, 1))
        if child is not None and parent is not None:
            edges[child] = parent
    return edges


def _codex_row(path: Path, row: CodexRow, edges: dict[str, str]) -> Session:
    thread_id = str(_row_value(row, 0))
    source_parent, source_agent = spawn_info(_row_text(_row_value(row, 9)))
    return Session(
        "codex",
        thread_id,
        str(_row_value(row, 1) or path),
        _row_text(_row_value(row, 2)),
        unix_seconds(_row_number(_row_value(row, 3))),
        unix_seconds(_row_number(_row_value(row, 4))),
        _row_text(_row_value(row, 5)),
        _row_text(_row_value(row, 6)),
        _row_text(_row_value(row, 7)) or "",
        {"total_tokens": _row_number(_row_value(row, 8))},
        edges.get(thread_id) or source_parent,
        nick_role(_row_text(_row_value(row, 10)), _row_text(_row_value(row, 11))) or source_agent,
    )


def _row_text(value: Json | int | float | None) -> str | None:
    return value if isinstance(value, str) else None


def _row_number(value: Json | int | float | None) -> int | float | None:
    return value if isinstance(value, int | float) else None


def _row_value(row: CodexRow, index: int) -> Json | int | float | None:
    value = row[index] if index < len(row) else None
    if value is None or isinstance(value, str | int | float | bool):
        return value
    return None
