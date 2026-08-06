# /// script
# requires-python = ">=3.11"
# dependencies = ["pytest"]
# ///
# --- How to run ---
# uv run --with pytest pytest scripts/tests/test_agent_sessions.py -v
# pyright: reportImplicitRelativeImport=false, reportMissingImports=false
from __future__ import annotations

import json
import os
import sqlite3
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from agent_sessions import cli, scanners
from agent_sessions.opencode import scan_opencode
from agent_sessions.scanners import scan_claude, scan_codex
from agent_sessions.transcript import MAX_PLATFORM_FILES, recent
from agent_sessions.types import Json, JsonMap, Session


def _map(value: Json) -> JsonMap:
    assert isinstance(value, dict)
    return value


def _rows(payload: JsonMap, key: str) -> list[JsonMap]:
    value = payload[key]
    assert isinstance(value, list)
    return [_map(item) for item in value]


def _claude_line(session_id: str, content: str, agent_id: str | None = None) -> str:
    data: JsonMap = {
        "sessionId": session_id,
        "type": "user",
        "timestamp": "2026-06-10T06:56:20.048Z",
        "cwd": "/tmp/work",
        "message": {"role": "user", "content": content},
    }
    if agent_id is not None:
        data["agentId"] = agent_id
        data["isSidechain"] = True
    return json.dumps(data)


def _session(platform: str, sid: str, parent_id: str | None = None, agent: str | None = None, path: str = "/tmp/x.x") -> Session:
    return Session(platform, sid, path, "/tmp/work", "2026-06-10T00:00:00+00:00", None, None, None, "hello world", {}, parent_id, agent)


@pytest.fixture
def claude_home(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    project = tmp_path / ".claude" / "projects" / "-tmp-work"
    sub = project / "main-sid" / "subagents"
    wf = sub / "workflows" / "wf_1"
    wf.mkdir(parents=True)
    (project / "main-sid.jsonl").write_text(_claude_line("main-sid", "build the feature") + "\n")
    (sub / "agent-abc.jsonl").write_text(_claude_line("main-sid", "audit repos", "abc") + "\n")
    (sub / "agent-abc.meta.json").write_text(json.dumps({"agentType": "general-purpose", "description": "Security sweep", "toolUseId": "toolu_1"}))
    (wf / "agent-def.jsonl").write_text(_claude_line("main-sid", "verify finding", "def") + "\n")
    (wf / "agent-def.meta.json").write_text(json.dumps({"agentType": "Explore", "description": "Verify finding"}))
    (wf / "journal.jsonl").write_text(json.dumps({"type": "journal", "sessionId": "main-sid"}) + "\n")
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    monkeypatch.setenv("APPDATA", "")
    return tmp_path


def test_claude_main_session_keeps_its_own_transcript_path(claude_home: Path) -> None:
    sessions = scan_claude((), 4)

    mains = [item for item in sessions if item.id == "main-sid"]
    assert len(mains) == 1, f"expected exactly one main-sid session, got {mains}"
    assert mains[0].path.endswith("main-sid.jsonl"), f"main session path hijacked: {mains[0].path}"
    assert mains[0].parent_id is None


def test_claude_subagent_transcripts_become_child_sessions(claude_home: Path) -> None:
    sessions = scan_claude((), 4)

    by_id = {item.id: item for item in sessions}
    assert "abc" in by_id, f"task subagent missing from {sorted(by_id)}"
    assert "def" in by_id, f"workflow subagent missing from {sorted(by_id)}"
    assert by_id["abc"].parent_id == "main-sid"
    assert by_id["def"].parent_id == "main-sid"
    assert by_id["abc"].agent == "general-purpose"
    assert "audit repos" in by_id["abc"].first_user_message
    assert "Security sweep" in by_id["abc"].first_user_message, "meta description must be searchable"


def test_claude_workflow_journal_is_not_a_session(claude_home: Path) -> None:
    sessions = scan_claude((), 4)

    assert [item for item in sessions if item.path.endswith("journal.jsonl")] == [], "journal.jsonl must not be scanned as a session"


CODEX_NEW_SCHEMA = (
    "CREATE TABLE threads (id TEXT PRIMARY KEY, rollout_path TEXT NOT NULL, created_at INTEGER NOT NULL, "
    "updated_at INTEGER NOT NULL, source TEXT NOT NULL, model_provider TEXT NOT NULL, cwd TEXT NOT NULL, "
    "model TEXT, first_user_message TEXT NOT NULL DEFAULT '', tokens_used INTEGER NOT NULL DEFAULT 0, "
    "agent_nickname TEXT, agent_role TEXT)"
)
CODEX_OLD_SCHEMA = (
    "CREATE TABLE threads (id TEXT PRIMARY KEY, rollout_path TEXT NOT NULL, created_at INTEGER NOT NULL, "
    "updated_at INTEGER NOT NULL, model_provider TEXT NOT NULL, cwd TEXT NOT NULL, "
    "model TEXT, first_user_message TEXT NOT NULL DEFAULT '', tokens_used INTEGER NOT NULL DEFAULT 0)"
)
SPAWN_SOURCE = json.dumps({"subagent": {"thread_spawn": {"parent_thread_id": "parent-1", "depth": 1, "agent_nickname": "Mencius", "agent_role": "worker"}}})


@pytest.fixture
def codex_home(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    codex = tmp_path / ".codex"
    codex.mkdir(parents=True)
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    monkeypatch.setenv("CODEX_HOME", str(codex))
    return codex


def test_codex_spawn_edges_link_child_to_parent(codex_home: Path) -> None:
    with sqlite3.connect(codex_home / "state_9.sqlite") as conn:
        conn.execute(CODEX_NEW_SCHEMA)
        conn.execute("CREATE TABLE thread_spawn_edges (parent_thread_id TEXT NOT NULL, child_thread_id TEXT NOT NULL PRIMARY KEY, status TEXT NOT NULL)")
        conn.execute("INSERT INTO threads VALUES ('parent-1', '/tmp/p.jsonl', 100, 200, 'cli', 'openai', '/tmp/work', 'gpt-5', 'do it', 9, NULL, NULL)")
        conn.execute(
            "INSERT INTO threads VALUES ('child-1', '/tmp/c.jsonl', 150, 210, ?, 'openai', '/tmp/work', 'gpt-5', 'sub task', 3, 'Mencius', 'worker')",
            (SPAWN_SOURCE,),
        )
        conn.execute("INSERT INTO thread_spawn_edges VALUES ('parent-1', 'child-1', 'closed')")

    sessions = {item.id: item for item in scan_codex((), 4)}

    assert sessions["parent-1"].parent_id is None
    assert sessions["child-1"].parent_id == "parent-1"
    assert sessions["child-1"].agent == "Mencius (worker)"


def test_codex_old_schema_still_lists_threads(codex_home: Path) -> None:
    with sqlite3.connect(codex_home / "state_5.sqlite") as conn:
        conn.execute(CODEX_OLD_SCHEMA)
        conn.execute("INSERT INTO threads VALUES ('old-1', '/tmp/o.jsonl', 100, 200, 'openai', '/tmp/work', 'gpt-5', 'legacy', 1)")

    sessions = {item.id: item for item in scan_codex((), 4)}

    assert "old-1" in sessions, "old-schema codex db must still be scanned"
    assert sessions["old-1"].parent_id is None


def test_codex_rollout_session_meta_recovers_id_and_parent(codex_home: Path) -> None:
    day = codex_home / "sessions" / "2026" / "06" / "01"
    day.mkdir(parents=True)
    meta: JsonMap = {
        "timestamp": "2026-06-01T00:00:00.000Z",
        "type": "session_meta",
        "payload": {
            "id": "child-9",
            "timestamp": "2026-06-01T00:00:00.000Z",
            "cwd": "/tmp/work",
            "model_provider": "openai",
            "source": {"subagent": {"thread_spawn": {"parent_thread_id": "parent-9", "depth": 1, "agent_nickname": "Tesla", "agent_role": "explorer"}}},
        },
    }
    user: JsonMap = {
        "timestamp": "2026-06-01T00:00:01.000Z",
        "type": "response_item",
        "payload": {"type": "message", "role": "user", "content": [{"type": "input_text", "text": "spawned task prompt"}]},
    }
    (day / "rollout-2026-06-01T00-00-00-child-9.jsonl").write_text(json.dumps(meta) + "\n" + json.dumps(user) + "\n")

    sessions = {item.id: item for item in scan_codex((), 4)}

    assert "child-9" in sessions, f"payload id not recovered: {sorted(sessions)}"
    assert sessions["child-9"].parent_id == "parent-9"
    assert sessions["child-9"].agent == "Tesla (explorer)"
    assert sessions["child-9"].cwd == "/tmp/work"
    assert "spawned task prompt" in sessions["child-9"].first_user_message


OPENCODE_SCHEMA = (
    "CREATE TABLE session (id TEXT PRIMARY KEY, parent_id TEXT, directory TEXT NOT NULL, title TEXT NOT NULL, "
    "agent TEXT, model TEXT, cost REAL DEFAULT 0, tokens_input INTEGER DEFAULT 0, tokens_output INTEGER DEFAULT 0, "
    "tokens_reasoning INTEGER DEFAULT 0, tokens_cache_read INTEGER DEFAULT 0, tokens_cache_write INTEGER DEFAULT 0, "
    "time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, time_archived INTEGER)"
)


def test_opencode_db_children_carry_parent_and_agent(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    db = tmp_path / "opencode.db"
    with sqlite3.connect(db) as conn:
        conn.execute(OPENCODE_SCHEMA)
        conn.execute(
            "INSERT INTO session (id, parent_id, directory, title, agent, model, time_created, time_updated) "
            "VALUES ('ses_main', NULL, '/tmp/work', 'main work', NULL, '{\"providerID\":\"anthropic\",\"id\":\"claude\"}', 1000, 2000)"
        )
        conn.execute(
            "INSERT INTO session (id, parent_id, directory, title, agent, model, time_created, time_updated) "
            "VALUES ('ses_child', 'ses_main', '/tmp/work', 'explore docs (@explore subagent)', 'explore', NULL, 1100, 1900)"
        )
    monkeypatch.setattr("agent_sessions.opencode._db_path", lambda: db)

    sessions = {item.id: item for item in scan_opencode((), 4)}

    assert "ses_child" in sessions, f"child sessions missing from db scan: {sorted(sessions)}"
    assert sessions["ses_child"].parent_id == "ses_main"
    assert sessions["ses_child"].agent == "explore"
    assert sessions["ses_main"].parent_id is None


def test_opencode_storage_fallback_reads_parent_id(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    root = tmp_path / "opencode"
    store = root / "storage" / "session" / "hash1"
    store.mkdir(parents=True)
    (store / "ses_main.json").write_text(json.dumps({"id": "ses_main", "title": "main", "directory": "/tmp/work", "time": {"created": 1000, "updated": 2000}}))
    (store / "ses_child.json").write_text(json.dumps({"id": "ses_child", "parentID": "ses_main", "title": "child task", "directory": "/tmp/work", "time": {"created": 1100, "updated": 1900}}))
    monkeypatch.setattr(Path, "home", lambda: tmp_path / "nohome")

    sessions = {item.id: item for item in scan_opencode((root,), 4)}

    assert "ses_child" in sessions, f"storage fallback missing children: {sorted(sessions)}"
    assert sessions["ses_child"].parent_id == "ses_main"
    assert sessions["ses_main"].parent_id is None


def test_empty_env_roots_do_not_scan_cwd(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(Path, "home", lambda: tmp_path / "home")
    monkeypatch.setenv("APPDATA", "")
    monkeypatch.setenv("CODEX_HOME", "")
    monkeypatch.setenv("OPENCODE_HOME", "")
    monkeypatch.setattr("agent_sessions.opencode._db_path", lambda: None)
    monkeypatch.setattr("agent_sessions.opencode._opencode_json", lambda _args: [])

    with sqlite3.connect(tmp_path / "state_leak.sqlite") as conn:
        conn.execute(CODEX_OLD_SCHEMA)
        conn.execute("INSERT INTO threads VALUES ('cwd-codex', '/tmp/o.jsonl', 100, 200, 'openai', '/tmp/work', 'gpt-5', 'cwd leak', 1)")
    (tmp_path / "Claude" / "transcripts").mkdir(parents=True)
    (tmp_path / "Claude" / "transcripts" / "cwd-claude.jsonl").write_text(_claude_line("cwd-claude", "cwd leak") + "\n")
    store = tmp_path / "storage" / "session" / "hash1"
    store.mkdir(parents=True)
    (store / "ses_cwd.json").write_text(json.dumps({"id": "ses_cwd", "title": "cwd leak", "directory": "/tmp/work", "time": {"created": 1000, "updated": 2000}}))

    assert scan_codex((), 4) == []
    assert scan_claude((), 4) == []
    assert scan_opencode((), 4) == []


def test_recent_keeps_newest_platform_file_cap(tmp_path: Path) -> None:
    paths: list[Path] = []
    for index in range(MAX_PLATFORM_FILES + 3):
        path = tmp_path / f"session-{index}.jsonl"
        path.write_text("{}\n")
        os.utime(path, (index, index))
        paths.append(path)

    missing = tmp_path / "missing.jsonl"
    selected = recent([missing, *paths])

    assert len(selected) == MAX_PLATFORM_FILES
    assert [path.name for path in selected[:3]] == ["session-2002.jsonl", "session-2001.jsonl", "session-2000.jsonl"]
    assert "session-0.jsonl" not in {path.name for path in selected}
    assert missing not in selected


@pytest.fixture
def family() -> list[Session]:
    return [
        _session("opencode", "ses_main", path="/tmp/main.jsonl"),
        _session("opencode", "ses_child1", parent_id="ses_main", agent="explore"),
        _session("opencode", "ses_child2", parent_id="ses_main", agent="plan"),
    ]


def test_cli_list_hides_children_and_counts_them(family: list[Session]) -> None:
    payload = cli._list_payload(family, family, 10, include_subagents=False)

    results = _rows(payload, "results")
    ids = [item["id"] for item in results]
    assert ids == ["ses_main"], f"children leaked into default list: {ids}"
    assert results[0]["subagent_count"] == 2


def test_cli_list_include_subagents_keeps_children(family: list[Session]) -> None:
    payload = cli._list_payload(family, family, 10, include_subagents=True)

    assert {item["id"] for item in _rows(payload, "results") if isinstance(item["id"], str)} == {"ses_main", "ses_child1", "ses_child2"}


def test_cli_get_main_includes_children(family: list[Session]) -> None:
    payload = cli._get_payload(family, ["ses_main"])

    assert payload["count"] == 1
    result = _rows(payload, "results")[0]
    assert sorted(item["id"] for item in _rows(result, "subagents") if isinstance(item["id"], str)) == ["ses_child1", "ses_child2"]
    assert _map(result["session"])["subagent_count"] == 2


def test_cli_get_child_by_id_still_works(family: list[Session]) -> None:
    payload = cli._get_payload(family, ["ses_child1"])

    assert payload["count"] == 1
    assert _map(_rows(payload, "results")[0]["session"])["parent_id"] == "ses_main"


def test_dedupe_prefers_linked_session_regardless_of_order() -> None:
    bare = _session("codex", "t1")
    linked = _session("codex", "t1", parent_id="t0", agent="Tesla (explorer)")

    for ordering in ([bare, linked], [linked, bare]):
        result = scanners._dedupe(ordering)

        assert len(result) == 1
        assert result[0].parent_id == "t0", f"dedupe dropped spawn linkage for ordering starting with {ordering[0]}"


def test_cli_search_matches_agent_name(family: list[Session]) -> None:
    payload = cli._search_payload(family, family, ("explore",), 10, 2, include_subagents=True)

    assert "ses_child1" in {item["id"] for item in _rows(payload, "results") if isinstance(item["id"], str)}, "agent label must be searchable"
