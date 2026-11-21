#!/usr/bin/env bash
set -euo pipefail
# CI_JUNIT_DIR (set by the macOS job) adds a JUnit report to the package test run (#13315); see ci-root-shard-2.sh.
# all (macOS): every step in one job. 1 / 2 (Linux, #14573): two parallel parts; each builds the plugin the tests
# read, part 1 also runs the one-off pack, daemon and typecheck steps, and the package tests are split by Bun's --shard
# balanced by .github/ci-test-timings.json (see ci-root-shard-2.sh for how to refresh it).
mode="${1:-all}"
case "$mode" in
  all|1|2) ;;
  *)
    printf '%s\n' "ci-senpi-posix.sh: expected all, 1, or 2" >&2
    exit 2
    ;;
esac
junit() { if [ -n "${CI_JUNIT_DIR:-}" ]; then mkdir -p "$CI_JUNIT_DIR"; printf '%s\n' --reporter=junit "--reporter-outfile=$CI_JUNIT_DIR/$1.xml"; fi; }
bun run build:senpi-plugin
if [ "$mode" = "all" ] || [ "$mode" = "1" ]; then
  PACK_DIR="$RUNNER_TEMP/omo-senpi-pack"
  mkdir -p "$PACK_DIR"
  npm pack --pack-destination "$PACK_DIR" packages/omo-senpi/plugin
  npm --prefix packages/lsp-daemon test -- test/daemon-roundtrip.test.ts
  bun check --no-script --all -p packages/omo-senpi/tsconfig.json
  bun test ./.agents/skills/senpi-qa/scripts/resolve-evidence-dir.test.mjs
fi
if [ "$mode" = "all" ]; then
  bun test --timeout 20000 packages/omo-senpi $(junit senpi)
else
  bun test --timeout 20000 packages/omo-senpi --shard="$mode/2" --timings=.github/ci-test-timings.json $(junit "senpi-$mode")
fi
