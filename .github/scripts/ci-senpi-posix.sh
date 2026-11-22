#!/usr/bin/env bash
set -euo pipefail
# CI_JUNIT_DIR (set by the macOS job) adds a JUnit report to the package test run (#13315); see ci-root-shard-2.sh.
# all (macOS, local receipts): every step and the whole package suite. one / two (Linux, #14573): two parallel parts; each
# builds the plugin the tests read, part one also runs the one-off pack, daemon and typecheck steps, and the package tests are
# split by Bun's --shard using a private timing copy that Bun rewrites. Mode names stay lowercase letters and the blocks stay flat
# if-blocks of plain commands: the local-receipt reader parses this file in its default mode without running it.
mode="${1:-all}"
case "$mode" in
  all|one|two) ;;
  *)
    printf '%s\n' "ci-senpi-posix.sh: expected all, one, or two" >&2
    exit 2
    ;;
esac
junit() { if [ -n "${CI_JUNIT_DIR:-}" ]; then mkdir -p "$CI_JUNIT_DIR"; printf '%s\n' --reporter=junit "--reporter-outfile=$CI_JUNIT_DIR/$1.xml"; fi; }
bun run build:senpi-plugin
if [ "$mode" = "all" ] || [ "$mode" = "one" ]; then
  PACK_DIR="$RUNNER_TEMP/omo-senpi-pack"
  mkdir -p "$PACK_DIR"
  npm pack --pack-destination "$PACK_DIR" packages/omo-senpi/plugin
  npm --prefix packages/lsp-daemon test -- test/daemon-roundtrip.test.ts
  bun check --no-script --all -p packages/omo-senpi/tsconfig.json
  bun test ./.agents/skills/senpi-qa/scripts/resolve-evidence-dir.test.mjs
fi
if [ "$mode" = "one" ]; then
  bun test --timeout 20000 packages/omo-senpi --shard=1/2 --timings=.omo/ci-shard-record.json --update-timings $(junit senpi-one)
fi
if [ "$mode" = "two" ]; then
  bun test --timeout 20000 packages/omo-senpi --shard=2/2 --timings=.omo/ci-shard-record.json --update-timings $(junit senpi-two)
fi
if [ "$mode" = "all" ]; then
  bun test --timeout 20000 packages/omo-senpi $(junit senpi)
fi
