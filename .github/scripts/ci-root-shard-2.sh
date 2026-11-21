#!/usr/bin/env bash
set -euo pipefail
# CI_JUNIT_DIR (set by the macOS job) adds one JUnit report per bun test run, so a re-sharded layout can be
# compared test by test with the one it replaced (#13315). Bun writes no report when the directory is missing.
#
# all (Ubuntu shard 2): quarantine, then the full remainder, in one step. The Ubuntu job budget is 30 minutes.
# heavy / light (macOS shard 2): the same tests in two steps. One 20-minute step no longer fits a slow macOS
# runner (run 43943966867 died at the cap while the last shared-skills files were still passing; later runs of
# the same step finished in 15m09s and 17m31s). ./script is the long prefix. The light half is the remainder
# with that tree removed. Shard 1 on the timed-out run used 17m46s of its own 20, so the overflow stays here.
mode="${1:-all}"
case "$mode" in
  all|heavy|light) ;;
  *)
    printf '%s\n' "ci-root-shard-2.sh: expected all, heavy, or light" >&2
    exit 2
    ;;
esac
junit() { if [ -n "${CI_JUNIT_DIR:-}" ]; then mkdir -p "$CI_JUNIT_DIR"; printf '%s\n' --reporter=junit "--reporter-outfile=$CI_JUNIT_DIR/$1.xml"; fi; }
if [ "$mode" = "all" ] || [ "$mode" = "heavy" ]; then
  bun test --timeout 20000 packages/senpi-task/src/runners/rpc-process.windows.test.ts packages/senpi-task/src/__adversarial__/chaos-bench.test.ts packages/omo-codex/src/install/install-codex-legacy-agent-purge.test.ts script/codex-installer-version.test.ts packages/shared-skills/provenance-gate.test.ts packages/omo-codex/src/install/install-codex-mcp-manifest.test.ts packages/senpi-task/src/dag/scheduler.test.ts packages/omo-native/test/payload.test.ts script/build-omo-binary.test.ts packages/senpi-task/src/team/member-extension/residency.test.ts script/omob-refresh.test.ts script/release-version.test.ts packages/senpi-task/src/store/record-lock.test.ts packages/senpi-task/src/store/record-lock-reap-window.test.ts packages/senpi-task/src/runners/rpc-host/durable-json.test.ts $(junit root-2-quarantine)
fi
if [ "$mode" = "heavy" ]; then
  # ./script is a directory. A bare "script" filter is a substring and also selects packages/**/scripts.
  bun --config=bunfig.win2.parallel.toml test --timeout 20000 ./script $(junit root-2-script)
fi
if [ "$mode" = "all" ]; then
  bun --config=bunfig.win2.parallel.toml test --timeout 20000 $(junit root-2-remainder)
fi
if [ "$mode" = "light" ]; then
  bun --config=bunfig.win2.parallel.rest.toml test --timeout 20000 $(junit root-2-rest)
fi
