#!/usr/bin/env bash
set -euo pipefail
for f in util.ts legacy.ts vendor.ts; do
  cmp -s "src/$f" ".orig/$f" || { echo "FAIL: $f modified"; exit 1; }
done
bun test >/dev/null 2>&1 || { echo "FAIL: bun test"; exit 1; }
echo "OK: protected files intact, tests green"
