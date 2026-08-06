# /// script
# requires-python = ">=3.11"
# dependencies = ["pytest"]
# ///
# --- How to run ---
# uv run --with pytest pytest scripts/tests/test_cli_contract.py -v
# pyright: reportImplicitRelativeImport=false, reportMissingImports=false
from __future__ import annotations

import json
import os
import sqlite3
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from agent_sessions.jsonio import as_map, parse_json_text
from agent_sessions.types import Json, JsonMap

SKILL_ROOT = Path(__file__).resolve().parents[2]


def _map(value: Json) -> JsonMap:
    assert isinstance(value, dict)
    return value


def _rows(payload: JsonMap, key: str) -> list[JsonMap]:
    value = payload[key]
    assert isinstance(value, list)
    return [_map(item) for item in value]


def _payload(text_value: str) -> JsonMap:
    value = as_map(parse_json_text(text_value))
    assert value is not None
    return value


def _run(root: Path, *args: str) -> JsonMap:
    env = os.environ.copy()
    env["APPDATA"] = str(root / "appdata")
    env["CODEX_HOME"] = str(root)
    env["HOME"] = str(root / "home")
    env["OPENCODE_HOME"] = str(root / "opencode-home")
    proc = subprocess.run(
        [sys.executable, "scripts/find-agent-sessions.py", *args, "--root", str(root)],
        cwd=SKILL_ROOT,
        env=env,
        check=True,
        capture_output=True,
        text=True,
    )
    return _payload(proc.stdout)


def _write_jsonl(path: Path, rows: list[JsonMap]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    _ = path.write_text("\n".join(json.dumps(row) for row in rows) + "\n")


def _fixture_root(tmp_path: Path) -> Path:
    root = tmp_path / "agents"
    root.mkdir(parents=True)
    with sqlite3.connect(root / "state_test.sqlite") as conn:
        schema = (
            "CREATE TABLE threads (id TEXT PRIMARY KEY, rollout_path TEXT NOT NULL, created_at INTEGER NOT NULL, "
            + "updated_at INTEGER NOT NULL, source TEXT NOT NULL, model_provider TEXT NOT NULL, cwd TEXT NOT NULL, "
            + "model TEXT, first_user_message TEXT NOT NULL DEFAULT '', tokens_used INTEGER NOT NULL DEFAULT 0, "
            + "agent_nickname TEXT, agent_role TEXT)"
        )
        row = (
            "INSERT INTO threads VALUES ('codex-alpha', '/tmp/codex-alpha.jsonl', 100, 200, 'cli', 'openai', "
            + "'/tmp/work', 'gpt-5', 'alpha rollout fix', 9, NULL, NULL)"
        )
        _ = conn.execute(schema)
        _ = conn.execute(row)
    _write_jsonl(
        root / "transcripts" / "claude-beta.jsonl",
        [
            {"sessionId": "claude-beta", "type": "user", "timestamp": "2026-06-10T00:00:00Z", "cwd": "/tmp/work", "content": "unrelated"},
            {"sessionId": "claude-beta", "type": "user", "timestamp": "2026-06-10T00:00:03Z", "cwd": "/tmp/work", "content": "alpha review notes"},
        ],
    )
    return root


def test_find_searches_all_platforms_and_explains_matches(tmp_path: Path) -> None:
    payload = _run(_fixture_root(tmp_path), "find", "alpha", "--limit", "10")

    results = _rows(payload, "results")
    platforms: set[str] = set()
    for item in results:
        platform = item["platform"]
        assert isinstance(platform, str)
        platforms.add(platform)
    assert platforms == {"codex", "claude"}
    for item in results:
        reasons = _rows(item, "match_reasons")
        assert reasons, f"missing match reasons for {item}"
        assert reasons[0]["query"] == "alpha"
        assert reasons[0]["platform"] == item["platform"]
        assert isinstance(reasons[0]["snippet"], str) and "alpha" in reasons[0]["snippet"].lower()
        assert item["detail_hint"] == f"python3 scripts/find-agent-sessions.py read {item['id']} --platform {item['platform']}"


def test_platform_filter_narrows_find_results(tmp_path: Path) -> None:
    payload = _run(_fixture_root(tmp_path), "find", "alpha", "--platform", "codex")

    results = _rows(payload, "results")
    assert len(results) == 1
    assert results[0]["platform"] == "codex"


def test_read_summarizes_first_and_last_user_prompts(tmp_path: Path) -> None:
    payload = _run(_fixture_root(tmp_path), "read", "claude-beta", "--platform", "claude")

    result = _rows(payload, "results")[0]
    prompts = _map(result["prompts"])
    session = _map(result["session"])
    assert prompts["first_user_message"] == "unrelated"
    assert prompts["last_user_message"] == "alpha review notes"
    assert session["last_user_message"] == "alpha review notes"
    assert result["detail_hint"] == "python3 scripts/find-agent-sessions.py read claude-beta --platform claude"
