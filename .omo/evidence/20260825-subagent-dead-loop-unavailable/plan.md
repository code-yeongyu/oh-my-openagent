# Plan: Fix #5046 - subagent dead loop when model unavailable

## Root cause

1. `packages/model-core/src/runtime-fallback-error-classifier.ts:122-128` classifies
   `model_not_found`, `missing_api_key`, and `quota_exceeded` as retryable.
2. When a subagent session hits such an error and NO fallback models are configured,
   `packages/omo-opencode/src/hooks/runtime-fallback/message-update-handler.ts`
   (no-fallback branch, lines 155-167) aborts the subagent ONLY for `quota_exceeded`
   (`message.updated.subagent-quota-no-fallback`).
3. For `model_not_found` / `missing_api_key` the handler returns without aborting:
   the subagent session is left as a zombie, the parent's continuation machinery
   (ralph/goal loop, re-delegation) re-prompts an unavailable model forever. No
   max-retry cap or skip guard exists on this path (maintainer-confirmed triage).

The parent-model-inheritance half of the issue is out of scope (duplicate of #5082;
maintainer: categories ignoring inheritedModel is by design).

## Change (minimal, terminal/liveness)

File: `packages/omo-opencode/src/hooks/runtime-fallback/message-update-handler.ts`

Extend the existing no-fallback-configured subagent abort to also cover the two
remaining terminal configuration-error classes:

- `model_not_found` -> abort source `message.updated.subagent-model-unavailable-no-fallback`
- `missing_api_key` -> same source

Rationale for immediate skip instead of a literal 3-strike counter: these error
classes cannot self-heal within the session and there is no fallback chain to
advance (fallback chains already have their own `max_fallback_attempts` cap of 3
in the fallback state machine). Retrying the identical unavailable model N times
is pure waste; aborting resolves the parent tool call so the parent can skip or
re-plan. This mirrors the maintainer-endorsed quota-abort precedent exactly.

Quota behavior is preserved byte-for-byte (same source string, same branch).

## Test (failing-first, co-located)

New file: `packages/omo-opencode/src/hooks/runtime-fallback/subagent-model-unavailable-abort.test.ts`

Mirrors `subagent-quota-abort.test.ts` structure (fresh module import, HookDeps factory,
AutoRetryHelpers recorder):

1. subagent + ModelNotFoundError + no fallback -> aborted with new source (RED before fix)
2. subagent + LoadApiKeyError + no fallback -> aborted with new source (RED before fix)
3. subagent + rate-limit transient error + no fallback -> NOT aborted (behavior preserved)
4. user (non-subagent) session + ModelNotFoundError -> NOT aborted

Existing `subagent-quota-abort.test.ts` must stay green unchanged.

## Verification

- `bun test packages/omo-opencode/src/hooks/runtime-fallback/` (scoped suite)
- `tsgo --noEmit -p packages/omo-opencode/tsconfig.json` (authoritative typecheck)
- Evidence recorded in this directory.

## Out of scope / not done

- No config schema changes; no new hook; no delegate-core changes.
- Live opencode harness drive: change is a pure handler-unit branch extension covered
  by hermetic unit tests at the exact seam the quota precedent used; no config/schema/
  installer/prompt surface touched. Recorded as scoped-out in evidence QA notes.
