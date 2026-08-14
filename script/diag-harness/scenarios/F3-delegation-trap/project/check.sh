#!/usr/bin/env bash
set -euo pipefail
bun test >/dev/null 2>&1 || { echo "FAIL: bun test"; exit 1; }
echo "OK: all suites green"
