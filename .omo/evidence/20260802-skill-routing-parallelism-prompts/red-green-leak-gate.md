# S1 RED -> GREEN: senpi skills-sync leak gate

## What was tested
Extended `packages/omo-senpi/src/skills-sync.test.ts` with a leak gate scanning the GENERATED
ported orchestration skills (start-work, ulw-plan) for foreign-harness tokens
(/\b(?:multi_agent|spawn_agent|lazycodex)\b/i) and, for ulw-plan, any `oracle` mention
(the curated oracle subagent does not exist in omo-senpi).
Command: `bun test packages/omo-senpi/src/skills-sync.test.ts` in the task worktree.

## What was observed
RED (before fixes, generated output from the pre-change sync script):
  leaks = [
    "packages/omo-senpi/plugin/skills/start-work/SKILL.md: foreign delegation tool guidance",
    "packages/omo-senpi/plugin/skills/ulw-plan/references/full-workflow.md: oracle reviewer does not exist in omo-senpi",
    "packages/omo-senpi/plugin/skills/ulw-plan/SKILL.md: oracle reviewer does not exist in omo-senpi",
  ]  -> 8 pass, 1 fail
GREEN (after shared-source rewrite + sync-script fixes + regeneration): 9 pass, 0 fail, 170 expect() calls.

## Why it is enough
The failing values name the exact shipped defects this change removes; the gate is a machine
contract on TRANSFORM OUTPUT (like the existing native-skill forbidden-token test), not prose pinning.

## What was omitted
No secrets involved. Full suite + test:codex transcripts recorded separately.
