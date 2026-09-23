# QA Evidence: fix #5046 subagent dead loop when model unavailable

## WHAT WAS TESTED

- Command: `bun test packages/omo-opencode/src/hooks/runtime-fallback/subagent-model-unavailable-abort.test.ts packages/omo-opencode/src/hooks/runtime-fallback/subagent-quota-abort.test.ts`
- Command: `bun test packages/omo-opencode/src/hooks/runtime-fallback/`
- Command: `bunx tsgo --noEmit -p packages/omo-opencode/tsconfig.json`
- Surface: `createMessageUpdateHandler` no-fallback branch in
  `packages/omo-opencode/src/hooks/runtime-fallback/message-update-handler.ts`
  (runtime-fallback Session-tier hook, reactive provider error recovery).
- Behavior proven: a subagent session hitting `model_not_found` or
  `missing_api_key` with NO fallback models configured is aborted
  (`message.updated.subagent-model-unavailable-no-fallback`) so the parent task
  tool call resolves instead of the parent re-delegating to the same unavailable
  model forever. Transient errors (rate limit) and user (non-subagent) sessions
  are NOT aborted; quota behavior is byte-identical to before (same source tag,
  existing `subagent-quota-abort.test.ts` unchanged and green).

## WHAT WAS OBSERVED

- Failing-first: before the fix the two new abort assertions failed
  (0 aborts recorded); negative cases passed. After the fix: 7/7 pass across the
  new + quota suites (`scoped-tests.log`).
- Full scoped suite: 290 pass / 0 fail / 538 expect() calls across 31 files
  (`runtime-fallback-suite.log`).
- Typecheck: tsgo exit 0 on packages/omo-opencode.
- Isolation: hermetic unit tests at the same seam as the shipped
  `subagent-quota-abort` precedent; no real opencode session, DB, or config was
  touched (no XDG-spawning QA performed).

## WHY IT IS ENOUGH

The defect is a missing terminal guard inside this exact handler branch; the new
tests drive the real exported handler with classifier-accurate error fixtures
(`ModelNotFoundError`, `LoadApiKeyError`, `RateLimitError`) and assert the
abort/no-abort decision plus source tags. The full runtime-fallback directory
suite pins no regression across all neighboring paths (event-handler,
session-status-handler, fallback state machine). Remaining risk: an environment
where OpenCode reports model-unavailable through a different error shape than
the classifier recognizes; that classification is shared with the pre-existing
retryable path and out of this change's blast radius.

## WHAT WAS OMITTED

- Live opencode harness drive (opencode-qa skill): change touches one pure
  handler-unit branch with no config/schema/installer/prompt surface; covered by
  hermetic unit tests per the task's scoped verification gate. No secrets, env
  dumps, or tokens appear in captured logs.
- Parent-model-inheritance half of issue #5046: duplicate of #5082, maintainer
  confirmed by-design; not addressed here.

## ARTIFACTS

- `plan.md` - pre-edit implementation plan (AGENTS.md protocol step 2)
- `scoped-tests.log` - new + quota suite output (7 pass)
- `runtime-fallback-suite.log` - full runtime-fallback suite (290 pass)
