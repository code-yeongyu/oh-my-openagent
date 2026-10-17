#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# ///
# --- How to run ---
# python3 scripts/find-agent-sessions.py list --limit 20
# python3 scripts/find-agent-sessions.py search "commit" --from 7d
# python3 scripts/find-agent-sessions.py get <session-id>
from __future__ import annotations

import sys
import runpy
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))


if __name__ == "__main__":
    if sys.version_info < (3, 11):
        found = ".".join(str(part) for part in sys.version_info[:3])
        _ = sys.stderr.write(f"find-agent-sessions requires Python 3.11 or newer (found {found}); run it with python3.11+ or `uv run`.\n")
        raise SystemExit(2)
    _ = runpy.run_module("agent_sessions.cli", run_name="__main__")
