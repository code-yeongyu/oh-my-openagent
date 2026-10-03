# Evidence: Issue #6640 - hasGA1MContext regex gap (claude-opus-5 falls back to 200K)

Date: 2026-08-24
Worktree: /home/viprix/projects/oom-wt-6640
Branch: issue/6640-ga1m-context-gap (base: dev @8833800ae)

## Root cause

`packages/model-core/src/context-limit-resolver.ts` `hasGA1MContext()`:

- Before: `/^claude-(?:fable|mythos|sonnet)-5$/` for the 5-family alternation.
  `claude-opus-5` matches neither the opus/sonnet-4 pattern nor the 5-family
  pattern, so `resolveActualContextLimit("anthropic", "claude-opus-5", ...)`
  returns `DEFAULT_ANTHROPIC_ACTUAL_LIMIT = 200_000` even though the model has a
  1M context window. The same gap also discards a cached provider limit because
  the cache branch is gated on `cachedLimit && hasGA1MContext(modelID)`.
- Consumer: `packages/omo-opencode/src/hooks/preemptive-compaction-trigger.ts`
  compacts when usage >= `PREEMPTIVE_COMPACTION_THRESHOLD = 0.78` of the resolved
  limit -> opus-5 sessions compacted at ~156K tokens (15.6% of the real 1M
  window), producing premature/duplicate auto-compactions as reported in #6640.
- Fix: add `opus` to the 5-family alternation:
  `/^claude-(?:fable|mythos|sonnet|opus)-5$/` (issue suggested fix #1).
  Bug 2 of the issue (compactedSessions latch set after the awaited summarize)
  is intentionally out of scope for this PR; it is an independent defect in
  packages/omo-opencode/src/hooks/preemptive-compaction-trigger.ts.

## WHAT WAS TESTED

1. Failing-first regression tests added to the co-located
   `packages/model-core/src/context-limit-resolver.test.ts` (given/when/then):
   - "returns GA 1M for claude-opus-5 without explicit 1M mode"
   - "uses cached limit for claude-opus-5 when cache exists" (proves the cached
     limit is no longer discarded by the regex gate)
   - "keeps 200K default for Anthropic models outside the GA 1M allowlist"
     (guard: allowlist must not become allow-all; green before and after)
2. Command: `bun test packages/model-core/src/context-limit-resolver.test.ts`
3. Full package suite: `bun test packages/model-core`
4. Typecheck: `bunx tsgo --noEmit -p packages/model-core/tsconfig.json` and
   `bunx tsgo --noEmit -p packages/omo-opencode/tsconfig.json` (consumer package).

## WHAT WAS OBSERVED

- RED (before fix): exactly the two new claude-opus-5 regression tests failed;
  all 12 pre-existing tests plus the guard test passed.
  `(fail) resolveActualContextLimit > returns GA 1M for claude-opus-5 without explicit 1M mode`
  `(fail) resolveActualContextLimit > uses cached limit for claude-opus-5 when cache exists`
  Summary line: `13 pass / 2 fail`.
- GREEN (after fix): scoped file `15 pass / 0 fail`; full model-core package
  `359 pass / 0 fail` (1295 expect() calls, 33 files).
- Typecheck: model-core OK; omo-opencode (consumer) OK, exit 0.

## WHY IT IS ENOUGH

The change is a one-token alternation inside a pure, deterministic function.
The co-located unit suite pins both affected branches of
`resolveActualContextLimit` (hardcoded GA limit and cached provider limit) for
the exact unmatched format from the issue (`claude-opus-5`), pins negative
behavior for a non-GA Anthropic model, and the full model-core suite (359 tests)
plus consumer-package typecheck cover regressions across every other caller of
the resolver. The exported signature did not change.

## WHAT WAS OMITTED

- Live OpenCode harness QA (opencode-qa skill / SSE hook probe) was not run:
  the edit is in harness-neutral `packages/model-core` (pure function, no
  OpenCode API surface touched); the observable behavior is fully pinned by the
  co-located unit tests above. The preemptive-compaction-trigger consumer was
  typechecked but not driven live.
- Bug 2 (latch-after-await double compaction) from issue #6640 is NOT fixed
  here; it requires a design decision among the three alternatives proposed in
  the issue and touches files adjacent to PR #7183's area.
- `bun install` prepare step fails in this environment at
  `materialize-shared-upstreams` (git submodule init for
  packages/shared-skills/upstreams/* cannot reach its remotes). This is
  pre-existing environment noise unrelated to this change; workspace deps
  sufficient for the scoped suites were installed successfully.
- No secrets, tokens, or env dumps are contained in this evidence.
