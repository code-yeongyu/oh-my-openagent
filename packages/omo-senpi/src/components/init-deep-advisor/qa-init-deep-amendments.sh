#!/usr/bin/env bash
set -euo pipefail
ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"
test "$(git diff packages/omo-senpi/skills/init-deep/SKILL.md | rg '^-## Phase [1-4]' | wc -l | tr -d ' ')" -eq 0
cp packages/omo-senpi/src/components/init-deep-advisor/init-deep-pre-amendment.md /tmp/h.txt
awk '/^## Phase 5/{skip=1} skip && /^## / && !/## Phase 5/{skip=0} !skip' packages/omo-senpi/skills/init-deep/SKILL.md > /tmp/w.txt
cmp -s /tmp/h.txt /tmp/w.txt
bash packages/omo-senpi/src/components/init-deep-advisor/qa-managed-block.sh
test $? -eq 0
