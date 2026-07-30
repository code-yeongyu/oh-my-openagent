# PR #6043 Exact-Head Code Review

## Review Pin

- Goal: extend runtime-fallback's first-prompt watchdog to silent main sessions while preserving fallback state, cancellation semantics, generation ownership, deferred event ordering, timer deadlines, and historical subagent behavior.
- Success criteria: a watchdog-owned abort must affect only its originating generation; delayed internal abort events must never reset a newer successful turn; genuine user cancellation must remain terminal; no competing retry may be dispatched.
- Base: `238c65280ec341e174f1aa6b6ed582fbba952c4b`
- Reviewed head: `7afa6a11824e2e1f1712afd515dcc597e56661f9`
- Diff: 106 files, 6,844 insertions, 503 deletions; 32 non-evidence files. The full diff and surrounding runtime-fallback implementation were inspected.
- Evidence inspected as untrusted input: `.omo/evidence/20260716-pr-6043-main-watchdog/`.
- ULW status: no plan exists (`ULW_LOOP_PLAN_MISSING`), so the fallback report path is used. No goal notepad was present.

## Status

- `codeQualityStatus`: BLOCK
- `recommendation`: REQUEST_CHANGES
- `reportPath`: `.omo/evidence/pr-6043-code-review.md`

## CRITICAL

None.

## HIGH

### Delayed prior-generation abort resets a newer turn after assistant progress

`cancel()` clears every retained watchdog abort generation for the session (`packages/omo-opencode/src/hooks/runtime-fallback/first-prompt-watchdog.ts:39-49`). Normal assistant progress calls that function (`packages/omo-opencode/src/hooks/runtime-fallback/first-prompt-watchdog.ts:142-145`). If generation one's watchdog abort event is delayed until after generation two has produced progress, the generation-one provenance has therefore been erased. The later abort-shaped `session.error` cannot be recognized as prior/internal (`packages/omo-opencode/src/hooks/runtime-fallback/first-prompt-watchdog.ts:154-171`), and the base handler classifies it as a new external cancellation, resetting the accepted fallback model and `attemptCount` (`packages/omo-opencode/src/hooks/runtime-fallback/event-handler.ts:182-194`).

Independent composed-hook reproduction at the reviewed head:

```json
{"dispatchCount":1,"afterFirst":{"originalModel":"openai/gpt-5.4-mini","currentModel":"anthropic/claude-haiku-4-5","fallbackIndex":0,"attemptCount":1,"pendingFallbackModel":"anthropic/claude-haiku-4-5"},"afterDelayed":{"originalModel":"openai/gpt-5.4-mini","currentModel":"openai/gpt-5.4-mini","fallbackIndex":-1,"attemptCount":0}}
```

This violates exact-generation ownership and regresses a successfully responding newer turn. The adjacent race test covers a delayed abort while generation two is still armed (`packages/omo-opencode/src/hooks/runtime-fallback/first-prompt-watchdog-generation-race.test.ts:137-194`), but no test covers the delayed abort arriving after generation-two assistant progress has cancelled its watchdog.

## MEDIUM

None. The missing regression is part of the HIGH correctness finding rather than a separate test-only issue.

## LOW

None.

## Verification

- Exact head/base and merge base verified locally.
- `git diff --check`: pass.
- Focused watchdog/deferred-event tests: 55 pass, 0 fail.
- Full runtime-fallback suite: 275 pass, 0 fail.
- OpenCode adapter typecheck: pass.
- Biome over all 29 changed runtime-fallback TypeScript files: no errors; one pre-existing warning at `event-handler.test.ts:243`, last changed before this PR.
- OpenCode QA harness self-check: pass with isolated XDG cleanup.
- Committed live evidence is runtime-identical to the reviewed head, but its successful fallback followed by later cancellation does not exercise the blocking delayed-abort-after-progress ordering.

## Skill Perspective

The `programming` TypeScript guidance and `remove-ai-slops` criteria were explicitly loaded and applied before judging maintainability and tests.

- `programming`: violated by the session-wide cleanup of generation provenance, which permits an older event to mutate newer-generation state. No new `any`, non-null assertion, brittle prompt test, or production boundary parsing was introduced by the reviewed production diff.
- `remove-ai-slops`: no deletion-only, requested-removal-only, tautological, constant-mirroring, or needless production extraction/normalization was found. Changed production and test modules remain under the 250-pure-LOC ceiling. The meaningful gap is the missing adversarial ordering above.
- The standalone no-excuse script could not load its TypeScript dependency in this worktree invocation; Biome, strict typecheck, and manual criteria inspection covered the same changed surface.

## Blockers

1. Preserve prior-generation abort provenance when a newer watchdog is cancelled by ordinary assistant progress, until the matching old abort event is consumed or safely expired.
2. Add a composed-hook regression for: generation-one watchdog fallback, generation-two user turn, generation-two assistant progress, then delayed generation-one abort-shaped `session.error`; assert fallback state remains on generation two and `attemptCount` is not reset.
