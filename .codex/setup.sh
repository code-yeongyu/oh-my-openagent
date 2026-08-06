#!/usr/bin/env bash
# Codex App local-environment setup script (committable). Codex runs this at the
# project root when it creates a new worktree at the start of a thread. It just
# delegates to the shared cross-harness bootstrap so every harness stays in sync.
#
# Codex Cloud setup is a web-UI field (paste the same commands there); the Codex
# CLI reads AGENTS.md only and has no setup-script hook.
set -euo pipefail
exec bash "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/script/agent/setup.sh"
