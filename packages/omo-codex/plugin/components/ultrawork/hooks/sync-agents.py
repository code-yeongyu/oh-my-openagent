#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Final, cast


AGENTS_DIR: Final = "agents"
SESSION_START_EVENT: Final = "SessionStart"


def _load_payload() -> dict[str, object] | None:
    try:
        raw = sys.stdin.read()
    except (OSError, ValueError):
        return None
    if not raw.strip():
        return None
    try:
        parsed = cast(object, json.loads(raw))
    except json.JSONDecodeError:
        return None
    if not isinstance(parsed, dict):
        return None
    values = cast(dict[object, object], parsed)
    return {str(k): v for k, v in values.items()}


def _should_sync(payload: dict[str, object]) -> bool:
    return payload.get("hook_event_name") == SESSION_START_EVENT


def _plugin_root() -> Path:
    env_root = os.environ.get("PLUGIN_ROOT")
    if env_root:
        root = Path(env_root).expanduser().resolve()
        if root.joinpath(AGENTS_DIR).is_dir():
            return root
    return Path(__file__).resolve().parents[1]


def _codex_home() -> Path:
    env_home = os.environ.get("CODEX_HOME")
    if env_home:
        return Path(env_home).expanduser().resolve()
    return Path.home().joinpath(".codex")


def _copy_agent_file(source: Path, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.is_symlink() or target.is_file():
        target.unlink()
    elif target.exists():
        raise IsADirectoryError(target)
    _ = target.write_bytes(source.read_bytes())


def _sync_agents(plugin_root: Path, codex_home: Path) -> None:
    source_dir = plugin_root / AGENTS_DIR
    if not source_dir.is_dir():
        return

    target_dir = codex_home / AGENTS_DIR
    for source in sorted(source_dir.rglob("*.toml")):
        if not source.is_file():
            continue
        target = target_dir / source.relative_to(source_dir)
        _copy_agent_file(source, target)


def main() -> None:
    try:
        payload = _load_payload()
        if payload is not None and _should_sync(payload):
            _sync_agents(_plugin_root(), _codex_home())
    except Exception as err:  # noqa: BLE001 - hook boundary must never block turns.
        _ = sys.stderr.write(f"codex-ultrawork agent sync failed: {err}\n")
    sys.exit(0)


if __name__ == "__main__":
    main()
