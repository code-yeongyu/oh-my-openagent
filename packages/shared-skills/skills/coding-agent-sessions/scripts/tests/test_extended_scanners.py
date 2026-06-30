# /// script
# requires-python = ">=3.11"
# dependencies = ["pytest"]
# ///
# --- How to run ---
# uv run --with pytest pytest scripts/tests/test_extended_scanners.py -v
# pyright: reportImplicitRelativeImport=false, reportMissingImports=false
from __future__ import annotations

import json
import sqlite3
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from agent_sessions import scanners
from agent_sessions.cli import _get_payload
from agent_sessions.file_scanners import _file_uri_path
from agent_sessions.sqlite_scanners import scan_kodu
from agent_sessions.types import JsonMap, Session


def _write_jsonl(path: Path, rows: list[JsonMap]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    _ = path.write_text("\n".join(json.dumps(row) for row in rows) + "\n")


def _sessions_by_platform(items: list[Session]) -> dict[str, Session]:
    return {item.platform: item for item in items}


def test_default_platforms_are_canonical_transcript_sources() -> None:
    required = {
        "codex",
        "claude",
        "senpi",
        "opencode",
        "openclaw",
        "droid",
        "amp",
        "gemini",
        "kimi",
        "qwen",
        "codebuff",
        "roo-code",
        "kilo-code",
        "cline",
        "kodu",
        "cursor-cli",
        "aider",
        "kilo-cli",
        "hermes",
        "goose",
        "crush",
        "zed",
        "kiro",
    }
    forbidden = {"copilot", "mux", "antigravity", "synthetic", "cursor"}

    assert scanners.DEFAULT_PLATFORMS == required
    assert not forbidden & scanners.DEFAULT_PLATFORMS
    assert scanners.PLATFORM_ALIASES["roocode"] == "roo-code"
    assert scanners.PLATFORM_ALIASES["kilocode"] == "kilo-code"
    assert scanners.PLATFORM_ALIASES["kilo"] == "kilo-cli"


def test_extended_default_scanners_find_transcript_rich_stores(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    monkeypatch.setenv("APPDATA", str(tmp_path / "appdata"))

    _write_jsonl(
        tmp_path / ".openclaw" / "agents" / "main" / "sessions" / "openclaw-1.jsonl",
        [
            {"type": "session", "id": "openclaw-1", "timestamp": "2026-06-10T00:00:00Z", "cwd": "/tmp/openclaw"},
            {"type": "message", "timestamp": "2026-06-10T00:00:01Z", "message": {"role": "user", "content": [{"type": "text", "text": "openclaw build"}]}},
        ],
    )
    _write_jsonl(
        tmp_path / ".factory" / "sessions" / "-tmp-droid" / "droid-1.jsonl",
        [
            {"type": "session_start", "id": "droid-1", "timestamp": "2026-06-10T00:00:00Z", "cwd": "/tmp/droid"},
            {"type": "message", "timestamp": "2026-06-10T00:00:01Z", "message": {"role": "user", "content": [{"type": "text", "text": "<system-reminder>noise</system-reminder>"}, {"type": "text", "text": "droid real prompt"}]}},
        ],
    )
    amp = tmp_path / ".local" / "share" / "amp" / "threads"
    amp.mkdir(parents=True)
    (amp / "T-amp-1.json").write_text(
        json.dumps(
            {
                "id": "T-amp-1",
                "created": 1771748797025,
                "env": {"initial": {"trees": [{"uri": "file:///tmp/amp"}], "tags": ["model:claude-opus-4-6"]}},
                "messages": [{"role": "user", "content": [{"type": "text", "text": "amp prompt"}], "meta": {"sentAt": 1771748810692}}],
            }
        )
    )

    sessions = _sessions_by_platform(scanners.scan(scanners.DEFAULT_PLATFORMS, (), 4))

    assert sessions["openclaw"].first_user_message == "openclaw build"
    assert sessions["droid"].first_user_message == "droid real prompt"
    assert sessions["amp"].first_user_message == "amp prompt"


def test_sqlite_and_repo_scanners_use_bounded_default_roots(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    monkeypatch.setenv("APPDATA", str(tmp_path / "appdata"))

    kodu_dir = tmp_path / "Library" / "Application Support" / "Code" / "User" / "globalStorage" / "kodu-ai.claude-dev-experimental" / "db"
    kodu_dir.mkdir(parents=True)
    with sqlite3.connect(kodu_dir / "Azad.db") as conn:
        conn.execute("CREATE TABLE tasks (id TEXT PRIMARY KEY, created_at INTEGER, updated_at INTEGER, name TEXT, dir_absolute_path TEXT, tokens_in INTEGER, tokens_out INTEGER, cache_writes INTEGER, cache_reads INTEGER, cost INTEGER)")
        conn.execute("CREATE TABLE messages (id TEXT PRIMARY KEY, task_id TEXT, role TEXT, content TEXT, model_id TEXT, started_at INTEGER, finished_at INTEGER, tokens_in INTEGER, tokens_out INTEGER, cache_writes INTEGER, cache_reads INTEGER, cost INTEGER)")
        conn.execute("INSERT INTO tasks VALUES ('kodu-task', 1000, 3000, 'kodu title', '/tmp/kodu', 1, 2, 3, 4, 5)")
        conn.execute("INSERT INTO messages VALUES ('m1', 'kodu-task', 'user', '[{\"type\":\"text\",\"text\":\"kodu prompt\"}]', 'claude', 1100, 1200, 1, 0, 0, 0, 0)")
        conn.execute("INSERT INTO messages VALUES ('m2', 'kodu-task', 'assistant', 'answer', 'claude', 1300, 1400, 0, 2, 0, 0, 5)")

    cursor_dir = tmp_path / ".cursor" / "chats" / "hash" / "cursor-session"
    cursor_dir.mkdir(parents=True)
    with sqlite3.connect(cursor_dir / "store.db") as conn:
        conn.execute("CREATE TABLE blobs (id TEXT PRIMARY KEY, data BLOB)")
        conn.execute("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)")
        conn.execute("INSERT INTO blobs VALUES ('b1', ?)", (json.dumps({"role": "user", "content": "<user_info>metadata</user_info>"}).encode(),))
        conn.execute("INSERT INTO blobs VALUES ('b2', ?)", (json.dumps({"role": "user", "content": [{"type": "text", "text": "<user_query>\ncursor prompt\n</user_query>"}]}).encode(),))
    (tmp_path / ".cursor" / "prompt_history.json").write_text(json.dumps(["cursor prompt"]))

    aider = tmp_path / "local-workspaces" / "repo"
    aider.mkdir(parents=True)
    (aider / ".aider.chat.history.md").write_text("# aider chat started at 2026-06-10 00:00:00\n\n#### aider prompt\n\nassistant reply\n")

    kiro = tmp_path / ".kiro" / "sessions" / "cli"
    kiro.mkdir(parents=True)
    (kiro / "kiro-session.json").write_text(
        json.dumps(
            {
                "session_id": "kiro-session",
                "cwd": "/tmp/kiro",
                "session_state": {
                    "rts_model_state": {"model_info": {"model_id": "claude-sonnet-4-5"}},
                    "conversation_metadata": {"user_turn_metadatas": [{"message_ids": ["prompt-1", "assistant-1"]}]},
                },
            }
        )
    )
    _write_jsonl(
        kiro / "kiro-session.jsonl",
        [
            {"version": "v1", "kind": "Prompt", "data": {"message_id": "prompt-1", "content": [{"kind": "text", "data": "kiro prompt"}], "meta": {"timestamp": 1770983426.42}}},
            {"version": "v1", "kind": "AssistantMessage", "data": {"message_id": "assistant-1", "content": [{"kind": "text", "data": "kiro answer"}]}},
        ],
    )

    sessions = {(item.platform, item.id): item for item in scanners.scan(scanners.DEFAULT_PLATFORMS, (), 4)}

    assert sessions[("kodu", "kodu-task")].first_user_message == "kodu prompt"
    assert sessions[("cursor-cli", "cursor-session")].first_user_message == "cursor prompt"
    assert sessions[("aider", "repo-2026-06-10-00-00-00")].first_user_message == "aider prompt"
    assert sessions[("kiro", "kiro-session")].first_user_message == "kiro prompt"
    assert sessions[("kiro", "kiro-session")].model == "claude-sonnet-4-5"


def test_vscode_extension_scanners_include_windows_appdata_roots(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(Path, "home", lambda: tmp_path / "home")
    monkeypatch.setenv("APPDATA", str(tmp_path / "AppData" / "Roaming"))

    roo_history = (
        tmp_path
        / "AppData"
        / "Roaming"
        / "Code"
        / "User"
        / "globalStorage"
        / "rooveterinaryinc.roo-cline"
        / "tasks"
        / "roo-task"
        / "api_conversation_history.json"
    )
    roo_history.parent.mkdir(parents=True)
    roo_history.write_text(json.dumps([{"role": "user", "content": [{"type": "text", "text": "windows roo prompt"}]}]))

    kodu_dir = (
        tmp_path
        / "AppData"
        / "Roaming"
        / "Code"
        / "User"
        / "globalStorage"
        / "kodu-ai.claude-dev-experimental"
        / "db"
    )
    kodu_dir.mkdir(parents=True)
    with sqlite3.connect(kodu_dir / "Azad.db") as conn:
        conn.execute("CREATE TABLE tasks (id TEXT PRIMARY KEY, created_at INTEGER, updated_at INTEGER, name TEXT, dir_absolute_path TEXT, tokens_in INTEGER, tokens_out INTEGER, cache_writes INTEGER, cache_reads INTEGER, cost INTEGER)")
        conn.execute("CREATE TABLE messages (id TEXT PRIMARY KEY, task_id TEXT, role TEXT, content TEXT, model_id TEXT, started_at INTEGER, finished_at INTEGER, tokens_in INTEGER, tokens_out INTEGER, cache_writes INTEGER, cache_reads INTEGER, cost INTEGER)")
        conn.execute("INSERT INTO tasks VALUES ('kodu-windows', 1000, 3000, 'kodu title', 'C:/repo', 1, 2, 3, 4, 5)")
        conn.execute("INSERT INTO messages VALUES ('m1', 'kodu-windows', 'user', '[{\"type\":\"text\",\"text\":\"windows kodu prompt\"}]', 'claude', 1100, 1200, 1, 0, 0, 0, 0)")

    roo_sessions = scanners.scan(frozenset({"roo-code"}), (), 4)
    kodu_sessions = scan_kodu((), 4)

    assert [item.first_user_message for item in roo_sessions] == ["windows roo prompt"]
    assert [item.first_user_message for item in kodu_sessions] == ["windows kodu prompt"]


def test_file_uri_path_preserves_windows_drive_and_unc_paths() -> None:
    assert _file_uri_path("file:///tmp/amp") == "/tmp/amp"
    assert _file_uri_path("file:///C:/Users/yeongyu/project") == "C:/Users/yeongyu/project"
    assert _file_uri_path("file://server/share/project") == "//server/share/project"


def test_kiro_scanner_skips_metadata_only_sessions(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(Path, "home", lambda: tmp_path)

    kiro = tmp_path / ".kiro" / "sessions" / "cli"
    kiro.mkdir(parents=True)
    (kiro / "metadata-only.json").write_text(
        json.dumps(
            {
                "session_id": "metadata-only",
                "cwd": "/tmp/kiro",
                "session_state": {
                    "rts_model_state": {"model_info": {"model_id": "claude-sonnet-4-5"}},
                    "conversation_metadata": {"user_turn_metadatas": [{"message_ids": ["prompt-1"]}]},
                },
            }
        )
    )

    sessions = scanners.scan(frozenset({"kiro"}), (), 4)

    assert ("kiro", "metadata-only") not in {(item.platform, item.id) for item in sessions}


def test_get_payload_reconstructs_events_for_non_jsonl_sessions() -> None:
    session = Session(
        "amp",
        "T-amp-1",
        "/tmp/T-amp-1.json",
        "/tmp/amp",
        "2026-06-10T00:00:00+00:00",
        "2026-06-10T00:00:01+00:00",
        None,
        "claude-opus-4-6",
        "first prompt",
        {},
        last_user_message="last prompt",
    )

    payload = _get_payload([session], ["T-amp-1"])

    result = payload["results"][0]
    assert isinstance(result, dict)
    assert result["events"] == [
        {"type": "message", "message": {"role": "user", "content": "first prompt"}},
        {"type": "message", "message": {"role": "user", "content": "last prompt"}},
    ]
