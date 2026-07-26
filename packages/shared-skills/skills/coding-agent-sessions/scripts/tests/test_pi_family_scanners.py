# /// script
# requires-python = ">=3.11"
# dependencies = ["pytest"]
# ///
# --- How to run ---
# uv run --with pytest pytest scripts/tests/test_pi_family_scanners.py -v
# pyright: reportImplicitRelativeImport=false, reportMissingImports=false
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from agent_sessions import scanners
from agent_sessions.types import JsonMap, Session

PI_FAMILY = frozenset({"senpi", "oh-my-pi", "gajae-code"})


def _write_session(path: Path, session_id: str, cwd: str, prompt: str) -> None:
    rows: list[JsonMap] = [
        {"type": "session", "version": 3, "id": session_id, "timestamp": "2026-07-20T00:00:00.000Z", "cwd": cwd},
        {"type": "model_change", "id": "m1", "timestamp": "2026-07-20T00:00:00.100Z", "model": "anthropic/claude-fable-5"},
        {
            "type": "message",
            "id": "e1",
            "timestamp": "2026-07-20T00:00:01.000Z",
            "message": {"role": "user", "content": [{"type": "text", "text": prompt}]},
        },
    ]
    path.parent.mkdir(parents=True, exist_ok=True)
    _ = path.write_text("\n".join(json.dumps(row) for row in rows) + "\n")


def _by_platform(items: list[Session]) -> dict[str, Session]:
    return {item.platform: item for item in items}


def test_pi_family_platforms_and_aliases_are_registered() -> None:
    assert PI_FAMILY <= scanners.DEFAULT_PLATFORMS
    assert scanners.PLATFORM_ALIASES["omp"] == "oh-my-pi"
    assert scanners.PLATFORM_ALIASES["ohmypi"] == "oh-my-pi"
    assert scanners.PLATFORM_ALIASES["gjc"] == "gajae-code"
    assert scanners.PLATFORM_ALIASES["gajae"] == "gajae-code"


def test_pi_family_scanners_read_each_product_home_store(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    monkeypatch.delenv("XDG_DATA_HOME", raising=False)

    _write_session(
        tmp_path / ".senpi" / "agent" / "sessions" / "-tmp-senpi" / "2026-07-20T00-00-00-000Z_senpi-1.jsonl",
        "senpi-1",
        "/tmp/senpi",
        "senpi prompt",
    )
    _write_session(
        tmp_path / ".omp" / "agent" / "sessions" / "-tmp-omp" / "2026-07-20T00-00-00-000Z_omp-1.jsonl",
        "omp-1",
        "/tmp/omp",
        "oh-my-pi prompt",
    )
    _write_session(
        tmp_path / ".gjc" / "agent" / "sessions" / "-tmp-gjc" / "2026-07-20T00-00-00-000Z_gjc-1.jsonl",
        "gjc-1",
        "/tmp/gjc",
        "gajae-code prompt",
    )

    sessions = _by_platform(scanners.scan(PI_FAMILY, (), 4))

    assert sessions["senpi"].first_user_message == "senpi prompt"
    assert sessions["oh-my-pi"].id == "omp-1"
    assert sessions["oh-my-pi"].first_user_message == "oh-my-pi prompt"
    assert sessions["oh-my-pi"].cwd == "/tmp/omp"
    assert sessions["oh-my-pi"].model == "anthropic/claude-fable-5"
    assert sessions["gajae-code"].id == "gjc-1"
    assert sessions["gajae-code"].first_user_message == "gajae-code prompt"


def test_pi_family_scanners_cover_profile_and_xdg_roots(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    monkeypatch.setenv("XDG_DATA_HOME", str(tmp_path / "xdg-data"))

    _write_session(
        tmp_path / ".omp" / "profiles" / "work" / "agent" / "sessions" / "-repo" / "2026-07-20T00-00-00-000Z_omp-work.jsonl",
        "omp-work",
        "/repo",
        "omp profile prompt",
    )
    _write_session(
        tmp_path / "xdg-data" / "gjc" / "sessions" / "-repo" / "2026-07-20T00-00-00-000Z_gjc-xdg.jsonl",
        "gjc-xdg",
        "/repo",
        "gjc xdg prompt",
    )
    _write_session(
        tmp_path / "xdg-data" / "omp" / "profiles" / "work" / "sessions" / "-repo" / "2026-07-20T00-00-00-000Z_omp-xdg.jsonl",
        "omp-xdg",
        "/repo",
        "omp xdg profile prompt",
    )

    found = {(item.platform, item.id) for item in scanners.scan(PI_FAMILY, (), 4)}

    assert ("oh-my-pi", "omp-work") in found
    assert ("gajae-code", "gjc-xdg") in found
    assert ("oh-my-pi", "omp-xdg") in found


def test_pi_family_stores_do_not_leak_across_platform_keys(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    monkeypatch.delenv("XDG_DATA_HOME", raising=False)

    _write_session(
        tmp_path / ".omp" / "agent" / "sessions" / "-tmp-omp" / "2026-07-20T00-00-00-000Z_omp-only.jsonl",
        "omp-only",
        "/tmp/omp",
        "oh-my-pi prompt",
    )

    senpi_sessions = scanners.scan(frozenset({"senpi"}), (), 4)
    omp_sessions = scanners.scan(frozenset({"omp"}), (), 4)

    assert senpi_sessions == []
    assert [(item.platform, item.id) for item in omp_sessions] == [("oh-my-pi", "omp-only")]
