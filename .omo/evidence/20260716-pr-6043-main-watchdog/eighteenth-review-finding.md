# PR #6043 Code Quality Review

## Pinned State

- Requested base: `6457ca1da78fcfd2a39ea391ee559b8d945b240a`
- Requested head and checked-out `HEAD`: `31e9ce1d5b8fef9f86211993187e55bb87657f4b`
- Ancestry: the requested base is an ancestor of the requested head.
- Scope: full `base...head` diff, runtime-fallback state machine, tests, repository rules, and committed evidence under `.omo/evidence/20260716-pr-6043-main-watchdog/`.
- `omo ulw-loop status --json` returned `ULW_LOOP_PLAN_MISSING`, so the required fallback report path is used. No notepad path was supplied.

## Verdict

- `codeQualityStatus`: `BLOCK`
- `recommendation`: `REQUEST_CHANGES`
- `reportPath`: `.omo/evidence/pr-6043-code-review.md`

## CRITICAL

None.

## HIGH

### 1. A delayed same-generation watchdog abort rewinds a fallback after that fallback has already completed successfully

Files:

- `packages/omo-opencode/src/hooks/runtime-fallback/first-prompt-watchdog.ts:198`
- `packages/omo-opencode/src/hooks/runtime-fallback/message-update-handler.ts:66`
- `packages/omo-opencode/src/hooks/runtime-fallback/event-handler.ts:182`
- `packages/omo-opencode/src/hooks/runtime-fallback/hook-current-generation-delayed-terminal.test.ts:78`

The exact-head repair consumes current-generation abort provenance only when `sessionAwaitingFallbackResult` is still set. A visible assistant response clears that ownership flag and the pending fallback marker. If the original watchdog abort's `session.error` arrives after the successful response and idle edge, the watchdog clears its provenance and lets the event reach `handleSessionError`, which classifies it as external cancellation and resets retry state to the failed primary model.

Independent composed-hook reproduction against the exact head:

```json
{"phase":"accepted","model":"anthropic/fallback","attempts":1,"awaiting":true}
{"phase":"completed","model":"anthropic/fallback","attempts":1,"awaiting":false}
{"phase":"delayed-terminal","model":"openai/primary","attempts":0,"awaiting":false}
```

This violates fallback persistence when `restore_primary_after_cooldown` is false, erases the failed-primary cooldown and attempt budget, and can send the next user turn back to the provider/model that just stalled. The new regression is overfit to the implementation predicate: its fake dispatcher directly sets `sessionAwaitingFallbackResult`, and the test asserts the terminal only while that flag remains true. It never drives a visible successful fallback response, so it misses the completed lifecycle that reproduces the bug.

Required change: retain exact-generation abort ownership through successful fallback completion until the owned terminal is consumed or an explicit lifecycle boundary safely retires it. Add a composed regression that drives accepted dispatch, visible assistant output, idle, and then the delayed abort terminal; also preserve a boundary test proving a genuine cancellation in a later generation still resets state.

### 2. The committed live OpenCode QA does not cover the exact production head

Files:

- `.omo/evidence/20260716-pr-6043-main-watchdog/seventeenth-review-final-integrity.txt:1`
- `.omo/evidence/20260716-pr-6043-main-watchdog/seventeenth-review-live-watchdog-run.txt:4`
- `.omo/evidence/20260716-pr-6043-main-watchdog/README.md:399`

The final integrity receipt identifies `af1ce820bfc9ef7cb90ce9f6d22290151ad36399`, and the final live-harness result is also pinned to that parent. No committed artifact in the requested evidence directory contains the exact head hash `31e9ce1d5b8fef9f86211993187e55bb87657f4b`. The exact head changes production watchdog ownership logic after the recorded live run.

Repository rules require real isolated OpenCode QA after every OpenCode-connected source change, with the tested source identity recorded. The static/focused outputs may have been run on an uncommitted candidate, but the only live artifact demonstrably covers the pre-fix parent. Therefore the mandatory exact-head live gate is absent, and the README's final-cycle success summary is not sufficient evidence for this head.

Required change: after fixing the runtime defect, rerun the `opencode-qa` live path on the final exact source state and commit a reviewer-readable artifact that records the exact source hash, behavior observed, hook/event proof, and unchanged real database receipt.

## MEDIUM

None.

## LOW

None.

## Skill-Perspective Check

The `remove-ai-slops`, `programming`, TypeScript, and code-smell skill instructions were explicitly loaded and applied before judging tests and maintainability.

- `remove-ai-slops`: no deletion-only, removal-only, tautological, or constant-only tests were found. The current-generation regression is useful for the pending-result state, but it is implementation-coupled and incomplete for the successful-response lifecycle, producing false confidence around the blocking defect.
- `programming`: no new `any`, prompt-string test, or unnecessary boundary parsing was identified in the production diff. The diff violates the async/state-machine and observable-behavior test perspective because abort ownership is tied to a transient implementation flag rather than the full generation lifecycle.

## Independent Verification

- Exact `HEAD` and ancestry checks: pass.
- `git diff --check base...head`: pass.
- `bun test packages/omo-opencode/src/hooks/runtime-fallback`: 286 passed, 0 failed across 42 files.
- `bunx tsgo --noEmit -p packages/omo-opencode/tsconfig.json`: pass.
- OpenCode QA harness self-check: pass with isolated XDG cleanup.
- Full changed-file Biome with warnings as errors reports a pre-existing non-null assertion in `event-handler.test.ts`; blame shows it predates the requested base, so it is not counted as a PR finding.
- The programming skill's standalone no-excuse script could not run in this environment because its TypeScript default import resolved incorrectly; the documented criteria were still applied directly, and Biome/typecheck were run independently.

## Blockers

1. Preserve same-generation watchdog abort ownership when its delayed terminal arrives after visible fallback success, without swallowing genuine later-generation cancellation.
2. Add the completed-fallback composed regression described above.
3. Record mandatory isolated live OpenCode QA for the final exact source head after repair.
