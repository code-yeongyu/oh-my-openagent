#!/usr/bin/env bash
set -euo pipefail
# CI_JUNIT_DIR (set by the macOS job) adds a JUnit report to the package test run (#13315); see ci-root-shard-2.sh.
junit() { if [ -n "${CI_JUNIT_DIR:-}" ]; then mkdir -p "$CI_JUNIT_DIR"; printf '%s\n' --reporter=junit "--reporter-outfile=$CI_JUNIT_DIR/$1.xml"; fi; }
bun run build:senpi-plugin
PACK_DIR="$RUNNER_TEMP/omo-senpi-pack"
mkdir -p "$PACK_DIR"
npm pack --pack-destination "$PACK_DIR" packages/omo-senpi/plugin
npm --prefix packages/lsp-daemon test -- test/daemon-roundtrip.test.ts
bun check --no-script --all -p packages/omo-senpi/tsconfig.json
bun test ./.agents/skills/senpi-qa/scripts/resolve-evidence-dir.test.mjs
bun test --timeout 20000 packages/omo-senpi $(junit senpi)
