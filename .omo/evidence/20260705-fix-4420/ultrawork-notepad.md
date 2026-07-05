# Ultrawork Notepad: fix-4420

## Bootstrap

- First setup attempt: `bash script/agent/setup.sh` failed because `bun` was not on PATH.
- Corrected invocation: `PATH="$HOME/.bun/bin:$PATH" bash script/agent/setup.sh`.
- Setup completed with Bun 1.3.14 and warned that CI pins Bun 1.3.12 / Node 24.

## Tier

- HEAVY: this is a concurrency/session-state race fix on a fork PR, with required failing-first evidence, commits, push, CI approval, and merge-commit auto-merge.

## Skills

- `omo-programming`: TypeScript/test edits in strict style.
- `opencode-qa`: evidence conventions and isolated live-surface guidance.
- `git-master` and `commit`: preserve contributor history, merge dev, create atomic follow-up commits, push without rewriting.
- `work-with-pr`: skipped because its fresh-worktree workflow conflicts with the explicit instruction to work only in this existing takeover worktree/branch.

## Success Criteria

- PR #4421 is merged or auto-merge is armed with merge commit semantics.
- Contributor commits are preserved; my commits are stacked on top, with no rebase or force-push.
- Branch is updated by merging current `origin/dev`.
- Diff is pure mechanical guard fix plus regression coverage/evidence.
- Race regression proves RED with guard reverted and GREEN with guard restored.
- `bun test packages/omo-opencode/src/hooks/team-session-events` passes.
- `bun run typecheck` passes, or any unrelated pre-existing failure is proven on clean `origin/dev`.
- `.omo/evidence/20260705-fix-4420/` records tests, QA justification, and cleanup receipts.

## Findings

- `gh issue view 4420` confirmed the issue body is stale and comments narrowed the defect to the stale `session.error` race.
- `gh pr view 4421` confirmed `maintainerCanModify=true`, fork owner `PeterPonyu`, head `fix/team-member-fallback-retry`, and contributor commit `d9803202e`.
- PR #4421 current files are pure: only `team-member-error-handler.ts` and its test.
- Contributor guard was scoped correctly but incomplete: it checked staleness before notification, but requeued pending live-delivery messages before checking staleness and did not guard inside the locked transition.
- After `git fetch origin dev && git merge origin/dev`, merge commit `a1b9a16ca` was created with no conflicts.
- The new deterministic race test failed with the guard reverted and passed with the locked transition guard restored.

## Verification

- RED: `.omo/evidence/20260705-fix-4420/red-guard-reverted-team-session-events.txt`.
- GREEN: `.omo/evidence/20260705-fix-4420/green-team-session-events.txt`.
- Typecheck: `.omo/evidence/20260705-fix-4420/typecheck-after-install.txt`.
- Targeted adapter typecheck: `.omo/evidence/20260705-fix-4420/typecheck-omo-opencode.txt`.
- OpenCode QA harness: `.omo/evidence/20260705-fix-4420/opencode-qa-common-self-check.txt`.
- OpenCode SSE surface: `.omo/evidence/20260705-fix-4420/opencode-qa-sse-self-test.txt`.
- OpenCode `session.error` hook-event proof: `.omo/evidence/20260705-fix-4420/session-error-sse-proof.txt` plus `.omo/evidence/20260705-fix-4420/session-error-event.json`.
- TypeScript no-excuse scan: `.omo/evidence/20260705-fix-4420/no-excuse-typescript.txt`.

## Self-Review

- Scope remains two code files plus evidence.
- No config, schema, package version, or user-visible behavior option changed.
- The guard preserves the existing `undefined sessionId` path: members still mark errored when disk state has not persisted a new session.
- Side effects are gated on the same locked freshness decision: stale events do not requeue pending delivery or notify the lead.
- The test uses a deterministic async status callback rather than a timer.
- Existing oversized test-file smell is recorded in `QA-SUMMARY.md` and intentionally not split in this mechanical fork takeover.

## Review Loop

- First reviewer verdict: REJECTED. Blocker was missing OpenCode `session.error` hook/event evidence; previous SSE artifact only proved `server.connected`.
- Added isolated `session-error-sse-proof.sh` and local `failing-openai-429.mjs` evidence harness.
- Passing proof observed `session.error` on `/event` and recorded real DB count unchanged (`21744` before and after).
- Second reviewer verdict: APPROVED. Reviewer found no remaining blockers after inspecting the new `session.error` evidence, guarded transition, test coverage, typecheck, no-excuse scan, and cleanup state.
