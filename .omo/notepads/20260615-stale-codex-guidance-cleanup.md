## Goal

Patch stale Codex orchestration guidance blockers in the lazycodex-gate-reviewers worktree.

## Skills And Tier

- programming: used for the TypeScript/MJS edits and test updates.
- LIGHT: scoped wording/marker cleanup inside existing guidance, sync script, and direct tests; no new runtime boundary, module, abstraction, auth, DB, or concurrency change.

## Success Criteria

1. Shared start-work guidance uses current Codex v1 `multi_agent_v1.spawn_agent` examples with `fork_context:false` and current reviewer role naming.
2. Ulw-loop aggregate goal instructions say not to call `update_goal` mid-aggregate, checkpoint the OMO ledger story, and reserve `update_goal` for the final story after the quality gate.
3. Legacy compatibility cleanup still removes old generated guidance while active source/test-support no longer trips stale literal scans.

## Evidence

- RED: `.omo/evidence/20260615-stale-codex-guidance/red-codex-goal-instruction-test.txt` captured the updated direct ulw-loop test failing against the stale wording.
- GREEN: `.omo/evidence/20260615-stale-codex-guidance/green-codex-goal-instruction-test.txt` shows 12/12 direct ulw-loop instruction tests passing.
- GREEN: `.omo/evidence/20260615-stale-codex-guidance/node-sync-skills-tests.txt` shows 19/19 sync-skills tests passing.
- GREEN: `.omo/evidence/20260615-stale-codex-guidance/ulw-loop-typecheck.txt` shows `tsc --noEmit` completed.
- GREEN: `.omo/evidence/20260615-stale-codex-guidance/plugin-check.txt` shows `bun run --cwd packages/omo-codex/plugin check` passed with 217/217 plugin tests.
- GREEN: `.omo/evidence/20260615-stale-codex-guidance/test-codex.txt` shows `bun run test:codex` passed with 339/339 Codex tests and 95/95 lsp-tools tests.
- SCAN: `.omo/evidence/20260615-stale-codex-guidance/final-stale-scan.txt` records no matches for the requested stale-token scan.
- SCAN: `.omo/evidence/20260615-stale-codex-guidance/extra-targeted-stale-scan.txt` records no matches for the broader targeted stale-token scan.
- SCAN: `.omo/evidence/20260615-stale-codex-guidance/evidence-path-redaction-scan.txt` shows committed evidence was checked for local home/worktree path leaks after redaction.

## Self Review

Re-read the diff after verification. The active generated guidance no longer mentions the v2 fork-mode wording, stale compatibility sections are removed by the Markdown section boundary rather than hidden literal-token construction, and tests assert behavior rather than reconstructed implementation tokens. The plugin package `check` and full Codex compatibility gate both passed.
