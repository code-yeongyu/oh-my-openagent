# S3: test gates

## Root bun test (task worktree, after edits + regen)
Command: `bun test` at worktree root.
Observed: 12665 pass, 3 skip (pre-existing live-tmux/named-pipe skips), 1 fail:
  script/codex-installer-version.test.ts "#given the generated Codex installer #when release versions
  are synchronized #then its embedded package version matches the root release version"
PRE-EXISTING: the identical single test fails on the untouched `dev` main checkout
(the main clone of this repository, commit b072d2791) - the committed generated installer still
embeds 4.19.3 after the v4.19.4 release; CI regenerates install-dist during setup/build so CI stays
green. Not caused by this change (this change reverted incidental install-dist rebuild churn to keep
scope clean). Verification transcript: `bun test script/codex-installer-version.test.ts` in the main
checkout -> same failure.

## Senpi leak gate
`bun test packages/omo-senpi/src/skills-sync.test.ts` -> 9 pass / 0 fail (RED->GREEN in red-green-leak-gate.md).

## Codex gate
`bun run test:codex` -> exit 0 (full gate green). Two intermediate failures were found and fixed on the way:
1. `plugin/test/sync-skills-test-support.mjs` duplicated the start-work overlay anchors with the old
   session-id sentence -> `removeCodexSkillOverlays` no-opped (162-char drift). Anchors co-updated.
2. `plugin/test/sync-skills-orchestration.test.mjs` pinned the old heading `/Delegation by difficulty/`;
   updated to the renamed `Codex tier mapping for the delegation router` (the guarded behavior - tier
   mapping survives the overlay - is still separately pinned by `/lazycodex-worker-medium/`).
After fixes: `node --test packages/omo-codex/plugin/test/` 358 pass / 0 fail; full `bun run test:codex` exit 0 (/tmp/test-codex-final.log).

## What was omitted
Live-harness drives (opencode run / codex app-server) were not exercised: this change is prose skill
content plus two generator scripts with no runtime hook/tool behavior delta; the machine-consumed
surfaces (frontmatter parse, sync transforms, packaged-copy equality contracts) are exactly what the
gates above execute.
