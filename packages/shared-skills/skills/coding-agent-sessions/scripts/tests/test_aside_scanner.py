# /// script
# requires-python = ">=3.11"
# dependencies = ["pytest"]
# ///
# --- How to run ---
# uv run --with pytest pytest scripts/tests/test_aside_scanner.py -v
# pyright: reportImplicitRelativeImport=false, reportMissingImports=false
from __future__ import annotations

import json
import sqlite3
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from agent_sessions.aside_scanner import scan_aside
from agent_sessions.types import JsonMap, Session


def _write_jsonl(path: Path, rows: list[JsonMap]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    _ = path.write_text("\n".join(json.dumps(row) for row in rows) + "\n")


def _write_state_db(path: Path, rows: list[tuple[str, str | None, str, str, str, int, int]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(path) as conn:
        _ = conn.execute("CREATE TABLE sessions (id TEXT PRIMARY KEY, parent_id TEXT, title TEXT NOT NULL, cwd TEXT NOT NULL, model TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)")
        _ = conn.executemany("INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?, ?)", rows)


def _by_id(sessions: list[Session]) -> dict[str, Session]:
    return {item.id: item for item in sessions}


def test_scan_aside_reads_messages_and_state_db_index(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    # given: a main session, a state.db-linked child, and a hardlink-mirror agents dir
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    user = tmp_path / ".aside" / "u" / "0"
    model = json.dumps({"provider": "quotio", "modelId": "gpt-5.6-sol", "thinkingLevel": "medium"})
    _write_state_db(
        user / "state.db",
        [
            ("main1", None, "Ambassador research", "/tmp/aside-main", model, 1785295598, 1785377046),
            ("child1", "main1", "Check settings context", "/tmp/aside-main", model, 1785295600, 1785295700),
        ],
    )
    _write_jsonl(
        user / "sessions" / "2026-07-29_main1" / "messages.jsonl",
        [
            {"role": "system-message", "content": "skill docs", "timestamp": 1785295598327},
            {"role": "user", "content": "find the ambassador benefits", "timestamp": 1785295598204},
            {"role": "assistant", "content": [{"type": "text", "text": "on it"}], "provider": "apitopia", "model": "kimi-k3", "usage": {"input": 28019, "output": 406, "totalTokens": 28425, "cost": {"total": 0.090147}}, "timestamp": 1785295598449},
            {"role": "user", "content": "now summarize it", "timestamp": 1785295599000},
        ],
    )
    _write_jsonl(
        user / "sessions" / "2026-07-29_child1" / "messages.jsonl",
        [{"role": "user", "content": "verify the settings page", "timestamp": 1785295600000}],
    )
    _write_jsonl(
        user / "agents" / "main" / "sessions" / "2026-07-29_main1" / "messages.jsonl",
        [{"role": "user", "content": "mirror copy that must not be scanned", "timestamp": 1785295601000}],
    )

    # when
    sessions = _by_id(scan_aside((), 4))

    # then: state.db metadata wins, transcript supplies prompts and usage
    assert len(sessions) == 2
    main = sessions["main1"]
    assert main.platform == "aside"
    assert main.agent is None
    assert "/agents/" not in main.path
    assert main.first_user_message == "find the ambassador benefits"
    assert main.last_user_message == "now summarize it"
    assert main.cwd == "/tmp/aside-main"
    assert main.provider == "quotio"
    assert main.model == "gpt-5.6-sol"
    assert main.parent_id is None
    assert main.usage["totalTokens"] == 28425
    assert main.usage["cost_total"] == 0.090147
    assert (main.created_at or "").startswith("2026-07-29")

    child = sessions["child1"]
    assert child.parent_id == "main1"
    assert child.agent == "Check settings context"
    assert child.first_user_message == "verify the settings page"


def test_scan_aside_without_state_db_falls_back_to_transcript(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    # given: only messages.jsonl, no state.db
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    user = tmp_path / ".aside" / "u" / "1"
    _write_jsonl(
        user / "sessions" / "2026-07-30_solo1" / "messages.jsonl",
        [
            {"role": "user", "content": "bare prompt", "timestamp": 1785295598204},
            {"role": "assistant", "content": [{"type": "text", "text": "ok"}], "provider": "apitopia", "model": "kimi-k3", "timestamp": 1785295598449},
        ],
    )

    # when
    sessions = _by_id(scan_aside((), 4))

    # then
    solo = sessions["solo1"]
    assert solo.first_user_message == "bare prompt"
    assert solo.provider == "apitopia"
    assert solo.model == "kimi-k3"
    assert solo.cwd is None
    assert (solo.created_at or "").startswith("2026-07-29")


def test_scan_aside_accepts_root_pointing_at_user_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    # given: an extra root that is itself a user dir (sessions/ directly inside)
    monkeypatch.setattr(Path, "home", lambda: tmp_path / "nowhere")
    user = tmp_path / "exported-aside-user"
    _write_jsonl(
        user / "sessions" / "2026-07-30_rooted1" / "messages.jsonl",
        [{"role": "user", "content": "rooted prompt", "timestamp": 1785295598204}],
    )

    # when
    sessions = _by_id(scan_aside((user,), 4))

    # then
    assert sessions["rooted1"].first_user_message == "rooted prompt"
