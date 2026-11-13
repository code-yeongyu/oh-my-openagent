#!/usr/bin/env bash
set -euo pipefail
bun run build:codex-install
bun run build:git-bash-mcp
bun run build:lsp-tools-mcp
bun run build:lsp-daemon
npm --prefix packages/omo-codex/plugin ci
bun run --cwd packages/omo-codex/plugin build
