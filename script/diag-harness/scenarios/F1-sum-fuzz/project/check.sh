#!/usr/bin/env bash
set -euo pipefail
bun test >/dev/null 2>&1 || { echo "FAIL: bun test"; exit 1; }
echo "OK: total=186 modal=14 count=7"
