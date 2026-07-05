# QA Summary: Fix 4163

## What Was Tested

- Failing-first race regression:
  - `bun test packages/omo-opencode/src/hooks/todo-continuation-enforcer/parent-wake-race.test.ts`
  - Proves `hasActiveChildTasks(parent)=false`, `hasPendingParentWake(parent)=true`, incomplete todos, and no continuation injection across idle-entry, post-countdown, and pre-dispatch windows.
- Enforcer suite:
  - `bun test packages/omo-opencode/src/hooks/todo-continuation-enforcer`
- Internal prompt route audit:
  - `bun test packages/omo-opencode/src/shared/prompt-async-route-audit.test.ts`
- Typecheck:
  - `bun run typecheck`
- OpenCode QA harness:
  - `bash .agents/skills/opencode-qa/scripts/lib/common.sh --self-check`
  - `bash .agents/skills/opencode-qa/scripts/sse-hook-probe.sh --self-test`

## What Was Observed

- RED before product fix: `red-parent-wake-race.log` shows both new regression cases failed with one prompt injected.
- GREEN after initial product fix: `green-parent-wake-race.log` shows the first two cases passing.
- RED before final pre-dispatch guard: `red-pre-dispatch-parent-wake-race.log` shows the third case failed with one prompt injected.
- GREEN after final pre-dispatch guard: `green-pre-dispatch-parent-wake-race.log` and `green-parent-wake-race-final.log` show all three race cases passing.
- Full enforcer suite: `todo-continuation-suite-final.log` shows 124 passing tests in the current tree.
- Prompt route audit: `prompt-async-route-audit-final.log` shows 10 passing tests.
- Typecheck: `typecheck-final.log` exits 0.
- TypeScript no-excuse checker: `no-excuse-final.log` reports no violations in the three changed TypeScript files.
- OpenCode QA:
  - Initial common self-check failed because `opencode` was not on PATH: `opencode-qa-common-self-check.log`.
  - Evidence-local shim `.omo/evidence/20260705-fix-4163/bin/opencode` delegates to `bunx --bun opencode`.
  - Rerun common self-check passes and proves isolated XDG cleanup: `opencode-qa-common-self-check-rerun.log`.
  - SSE self-test passes and observes `server.connected`: `opencode-qa-sse-self-test.log`.
  - Isolated server smoke passes `/global/health`, `/doc`, and auth rejection checks: `opencode-qa-server-smoke.log`.

## Why It Is Enough

The new deterministic test exercises the exact race seam: the enforcer sees no active child tasks while a parent wake is still owed. It covers both gate sites: the idle-time decision and the post-countdown injection recheck. The OpenCode QA scripts prove the real OpenCode server event surface is available in an isolated sandbox, while the prompt route audit proves the fix did not add or bypass any `promptAsync` route.

## What Was Omitted

A live parent-with-todos plus background-child-completion repro was not practical in this turn. It would require a model-driven OpenCode session that reliably creates incomplete todos, launches a background child, completes it, and delays parent wake delivery in the small teardown window. The deterministic test is the faithful channel for that race because it controls the two predicates that define the window without introducing model nondeterminism or real-time flake.
