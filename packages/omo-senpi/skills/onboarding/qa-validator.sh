#!/usr/bin/env bash
set -euo pipefail
! rg -q -i 'token cost warning|may use tokens|this may cost|warning.*token' packages/omo-senpi/skills/onboarding/SKILL.md
node -e 'const t=require("fs").readFileSync("packages/omo-senpi/skills/onboarding/SKILL.md","utf8"); const m=t.match(/^---\n([\s\S]*?)\n---/); if(!m)process.exit(1); if(!m[1].includes("name: onboarding"))process.exit(1)'
test $? -eq 0
