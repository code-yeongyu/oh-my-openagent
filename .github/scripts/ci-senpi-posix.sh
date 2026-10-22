#!/usr/bin/env bash
set -euo pipefail
bun run build:senpi-plugin
PACK_DIR="$RUNNER_TEMP/omo-senpi-pack"
mkdir -p "$PACK_DIR"
npm pack --pack-destination "$PACK_DIR" packages/omo-senpi/plugin
npm --prefix packages/lsp-daemon test -- test/daemon-roundtrip.test.ts
bunx tsgo --noEmit -p packages/omo-senpi/tsconfig.json
bun test ./.agents/skills/senpi-qa/scripts/resolve-evidence-dir.test.mjs
bun test --timeout 20000 packages/omo-senpi
