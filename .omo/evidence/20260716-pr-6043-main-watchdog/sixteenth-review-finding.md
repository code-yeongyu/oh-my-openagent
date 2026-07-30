# PR #6043 Final Code Quality Review

## Pinned State

- PR: `#6043`
- Base: `fb7d4b66f541e22e9718a4f51314702c6ac68e53`
- Head and checked-out `HEAD`: `bd8233f30cbc430a67ed9909ee28365e5ecb2639`
- Merge base: `fb7d4b66f541e22e9718a4f51314702c6ac68e53`
- Scope: exact range `fb7d4b66f541e22e9718a4f51314702c6ac68e53..bd8233f30cbc430a67ed9909ee28365e5ecb2639`
- `omo ulw-loop status --json` returned `ULW_LOOP_PLAN_MISSING`, so this report uses the required fallback path. No notepad path was supplied.

## Verdict

- `codeQualityStatus`: `BLOCK`
- `recommendation`: `REQUEST_CHANGES`
- `reportPath`: `.omo/evidence/pr-6043-code-review.md`

## CRITICAL

None.

## HIGH

### Two delayed watchdog abort terminals cancel the current silent generation and rewind retry state

The abort-provenance store intentionally allows more than one earlier watchdog generation to remain outstanding. That state is reachable when an earlier watchdog abort is acknowledged, its fallback returns successfully, and the abort's SSE terminal event remains delayed while another user turn repeats the same cycle.

When a third user turn is armed and both delayed abort-shaped `session.error` events arrive before assistant-parent correlation, the first event suspends the current watchdog and is deferred. The second event enters the already-suspended branch, clears internal ownership, calls `cancel(sessionID)` and returns `resolve-terminal` (`packages/omo-opencode/src/hooks/runtime-fallback/first-prompt-watchdog.ts:173-186`). This cancels the third generation's timer and clears all remaining abort provenance even though the second terminal can also belong to an earlier generation.

The composed hook has only one deferred terminal slot per session and immediately replays that first event when the second event returns `resolve-terminal` (`packages/omo-opencode/src/hooks/runtime-fallback/hook.ts:78`, `packages/omo-opencode/src/hooks/runtime-fallback/hook.ts:102-119`). Because ownership was just cleared, the normal event handler classifies the replayed abort as external cancellation and resets the fallback chain (`packages/omo-opencode/src/hooks/runtime-fallback/event-handler.ts:182-193`). The still-silent third request is then left without its watchdog.

I reproduced the complete sequence through `createRuntimeFallbackHook` against the exact head using stdin-only Bun execution:

```json
{
  "afterFirstDelayedAbort": { "attemptCount": 2, "currentModel": "google/fallback-2" },
  "afterSecondDelayedAbort": { "attemptCount": 0, "currentModel": "openai/gpt-5.4-mini" },
  "afterThirdGenerationDeadline": { "abortCount": 2, "dispatchCount": 2 }
}
```

The third deadline should have produced abort/dispatch number 3 while preserving attempt 2 until the next fallback was prepared. Instead, the current request remains silent, retry sequencing is rewound, and two internal aborts are reported as user cancellation. This directly violates the PR goal's recovery, abort-provenance, and retry-ordering requirements.

The new race tests do not cover multiple terminal candidates during one suspended correlation window. For example, the three-generation regression resolves each single deferred abort before proceeding (`packages/omo-opencode/src/hooks/runtime-fallback/first-prompt-watchdog-three-generation.test.ts:68-98`), and the composed deferred tests use one terminal candidate per resolution (`packages/omo-opencode/src/hooks/runtime-fallback/hook-deferred-terminal.test.ts:57-103`).

## MEDIUM

None.

## LOW

None.

## Evidence And Verification

- Inspected the complete exact diff and relevant surrounding runtime-fallback state-machine code and tests.
- Verified commits after runtime source commit `43a3704e92d66fdd7b7133568fe4c9e5e99b4b3a` change only reviewer evidence; production code and tests at the requested head are identical to that runtime commit.
- Independently ran `bun test packages/omo-opencode/src/hooks/runtime-fallback`: `283 pass`, `0 fail` across 40 files.
- Independently ran `bunx tsgo --noEmit -p packages/omo-opencode/tsconfig.json`: pass.
- Independently ran `git diff --check` for the exact range: pass.
- Inspected `.omo/evidence/20260716-pr-6043-main-watchdog/README.md`, the fifteenth exact suite/static/integrity artifacts, and the production-duration live watchdog artifact.
- The live evidence validly proves one silent-primary recovery and a later ordinary user abort, but it does not exercise two delayed abort terminal events in one suspended correlation window. The passing suite likewise lacks this ordering, so it does not contradict the reproduction.

## Skill Perspective Check

The `remove-ai-slops` and `programming` skills were explicitly loaded and consulted before judging maintainability and test relevance.

- `remove-ai-slops`: no deletion-only, removal-only, tautological, constant-mirroring, or otherwise useless tests were identified; no unnecessary production parsing or normalization was added. No independent slop violation was found, but the useful race suite is incomplete for the blocking ordering above.
- `programming`: the diff violates the behavioral/state-machine perspective because a singleton per-session deferred terminal plus branch-state inference cannot preserve multiple generation-owned aborts, and no composed observable regression exercises that supported ordering. No untyped escape hatch, brittle prompt test, or unrelated abstraction issue was found.

## Blockers

1. Preserve and correlate multiple outstanding watchdog abort terminal events without allowing a second delayed internal abort to cancel the currently armed generation or clear unrelated provenance.
2. Add a composed regression with two prior watchdog aborts, a third armed silent turn, and two delayed abort-shaped `session.error` events before parent correlation. Assert that retry state is not reset and the third watchdog still fires/advances the chain.
3. Re-run the scoped unit, static, and isolated live OpenCode QA gates and record exact repaired-head evidence.
