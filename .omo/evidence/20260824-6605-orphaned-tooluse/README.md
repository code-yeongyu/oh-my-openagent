# Evidence: Fix #6605 - compaction emits orphaned tool_use (Anthropic 400)

## WHAT WAS TESTED

1. Failing-first regression: `bun test packages/omo-opencode/src/hooks/tool-pair-validator/session-sanitizer.test.ts` with the three wiring edits stashed (`git stash push -- preemptive-compaction-trigger.ts preemptive-compaction-degradation-monitor.ts summarize-retry-strategy.ts preemptive-compaction.test.ts`). Expected: the wiring test `#given preemptive compaction fires on a session with an orphaned running tool part > #then the persisted part is patched before summarize is called` fails because no PATCH lands before `session.summarize`.
2. Green run after `git stash pop`: same scoped suite plus full `tool-pair-validator/`, `preemptive-compaction.test.ts`, and `anthropic-context-window-limit-recovery/` suites.
3. Repo type gate: `bun run typecheck` (tsgo root + script + all 30 workspace packages).
4. Forbidden-pattern audit: grep for `as any|@ts-ignore|@ts-expect-error` in both new files (0 hits).

## WHAT WAS OBSERVED

- Failing-first (`tests-failing-first.txt`): 8 pass / 1 fail; failure exactly at session-sanitizer.test.ts:294 `expect(order.filter(patch:)).toHaveLength(1)` -> received 0, proving the test pins the wiring and cannot pass without the fix.
- Green (`tests-scoped-green.txt`): 95 pass / 0 fail / 215 expect() calls across 16 files.
- Typecheck: exit 0, no errors (after fixing 3 pre-existing errors in the salvaged implementation: TS18047 null narrowing at session-sanitizer.ts:89; TS2345 Record-vs-Part at lines 115/120 resolved by widening getToolCallID/getToolStatus params to unknown in tool-part-ids.ts - bodies were already fully defensive via toRecord).
- Unit coverage of the sanitizer itself: running + pending parts settled to terminal error state via PATCH `/session/:id/message/:mid/part/:pid` preserving input/time.start and dropping raw; terminal parts untouched; missing id/callID skipped; messages-fetch failure resolves 0 so compaction proceeds.

## WHY IT IS ENOUGH

The regression test drives the real `runPreemptiveCompactionIfNeeded` entry point through an injected fetch harness and asserts ordering: the persisted orphaned tool part MUST be patched to a terminal state BEFORE `client.session.summarize` fires. That is precisely the invariant whose violation produces the issue's Anthropic 400 (`messages.N: tool_use ids were found without tool_result blocks immediately after`) on the compaction summarization request, which OpenCode builds from persisted storage where the transform-tier validator's in-memory repairs never land. All three production summarize call sites are wired identically. Remaining risk: orphans arising from shapes other than non-terminal tool parts (e.g. harness-side conversion bugs below the plugin's hook points) are out of scope for plugin-side repair and tracked upstream per the issue.

## WHAT WAS OMITTED

- No live multi-turn Anthropic session replay (requires paid API + a wedged session fixture); the unit harness exercises the exact persisted-state -> PATCH -> summarize ordering instead.
- Raw env/auth values absent by construction: fetch harness uses synthetic Basic auth (`Basic dGVzdDp0ZXN0`) and `http://opencode.test`; no tokens, org ids, or request ids captured.
- Full-repo `bun test` not re-run in this worktree beyond scoped suites; CI runs it on the PR.
