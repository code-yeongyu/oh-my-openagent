# /// script
# requires-python = ">=3.11"
# dependencies = ["pytest"]
# ///
# --- How to run ---
# uv run --with pytest pytest scripts/tests/test_optional_sqlite_scanners.py -v
# pyright: reportImplicitRelativeImport=false, reportMissingImports=false
from __future__ import annotations

import json
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from agent_sessions.sqlite_optional_scanners import scan_crush, scan_goose, scan_hermes, scan_kilo_cli, scan_zed


def _message_db(path: Path, table: str, prompt: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(path) as conn:
        _ = conn.execute(f"CREATE TABLE {table} (session_id TEXT, role TEXT, data TEXT, created_at INTEGER)")
        _ = conn.execute(
            f"INSERT INTO {table} VALUES ('s1', 'user', ?, 1770983426420)",
            (json.dumps({"role": "user", "content": [{"type": "text", "text": prompt}]}),),
        )
        _ = conn.execute(
            f"INSERT INTO {table} VALUES ('s1', 'assistant', ?, 1770983427420)",
            (json.dumps({"role": "assistant", "modelID": "claude-sonnet-4-5", "providerID": "anthropic", "content": "answer"}),),
        )


def test_optional_sqlite_scanners_reconstruct_present_prompt_stores(tmp_path: Path) -> None:
    _message_db(tmp_path / "kilo" / "kilo.db", "message", "kilo prompt")
    _message_db(tmp_path / "hermes" / "state.db", "messages", "hermes prompt")
    _message_db(tmp_path / "goose" / "sessions.db", "messages", "goose prompt")

    (tmp_path / "crush").mkdir()
    with sqlite3.connect(tmp_path / "crush" / "crush.db") as conn:
        _ = conn.execute("CREATE TABLE messages (session_id TEXT, role TEXT, parts TEXT, created_at INTEGER)")
        _ = conn.execute("INSERT INTO messages VALUES ('s1', 'user', ?, 1770983426420)", (json.dumps([{"type": "text", "text": "crush prompt"}]),))

    (tmp_path / "zed").mkdir()
    with sqlite3.connect(tmp_path / "zed" / "threads.db") as conn:
        _ = conn.execute("CREATE TABLE threads (id TEXT, data_type TEXT, data BLOB, updated_at TEXT)")
        _ = conn.execute(
            "INSERT INTO threads VALUES ('t1', 'json', ?, '2026-06-10T00:00:00Z')",
            (json.dumps({"model": {"provider": "zed.dev", "model": "claude"}, "messages": [{"role": "user", "content": "zed prompt"}]}).encode(),),
        )

    sessions = [
        *scan_kilo_cli((tmp_path / "kilo",), 4),
        *scan_hermes((tmp_path / "hermes",), 4),
        *scan_goose((tmp_path / "goose",), 4),
        *scan_crush((tmp_path / "crush",), 4),
        *scan_zed((tmp_path / "zed",), 4),
    ]
    prompts = {item.platform: item.first_user_message for item in sessions}

    assert prompts == {
        "kilo-cli": "kilo prompt",
        "hermes": "hermes prompt",
        "goose": "goose prompt",
        "crush": "crush prompt",
        "zed": "zed prompt",
    }


def test_optional_sqlite_scanners_skip_unsupported_schemas(tmp_path: Path) -> None:
    for name in ("kilo.db", "state.db", "sessions.db", "crush.db", "threads.db"):
        with sqlite3.connect(tmp_path / name) as conn:
            _ = conn.execute("CREATE TABLE unrelated (id TEXT)")

    assert scan_kilo_cli((tmp_path,), 4) == []
    assert scan_hermes((tmp_path,), 4) == []
    assert scan_goose((tmp_path,), 4) == []
    assert scan_crush((tmp_path,), 4) == []
    assert scan_zed((tmp_path,), 4) == []
