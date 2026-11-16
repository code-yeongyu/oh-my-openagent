#!/usr/bin/env bash
set -euo pipefail
# CI_JUNIT_DIR (set by the macOS job) adds one JUnit report per bun test run, so a re-sharded layout can be
# compared test by test with the one it replaced (#13315). Bun writes no report when the directory is missing.
junit() { if [ -n "${CI_JUNIT_DIR:-}" ]; then mkdir -p "$CI_JUNIT_DIR"; printf '%s\n' --reporter=junit "--reporter-outfile=$CI_JUNIT_DIR/$1.xml"; fi; }
bun test --timeout 20000 packages/senpi-task/src/runners/rpc-process.windows.test.ts packages/senpi-task/src/__adversarial__/chaos-bench.test.ts packages/omo-codex/src/install/install-codex-legacy-agent-purge.test.ts script/codex-installer-version.test.ts packages/shared-skills/provenance-gate.test.ts packages/omo-codex/src/install/install-codex-mcp-manifest.test.ts packages/senpi-task/src/dag/scheduler.test.ts packages/omo-native/test/payload.test.ts script/build-omo-binary.test.ts packages/senpi-task/src/team/member-extension/residency.test.ts script/omob-refresh.test.ts script/release-version.test.ts packages/senpi-task/src/store/record-lock.test.ts packages/senpi-task/src/store/record-lock-reap-window.test.ts packages/senpi-task/src/runners/rpc-host/durable-json.test.ts $(junit root-2-quarantine)
bun --config=bunfig.win2.parallel.toml test --timeout 20000 $(junit root-2-remainder)
