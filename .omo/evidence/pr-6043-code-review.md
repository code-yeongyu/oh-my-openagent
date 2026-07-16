# PR #6043 Independent Exact-Head Code Review #1

Date: 2026-07-16

## Review Identity

- HEAD: `38fbb576823955386e9a78a8362305d4af9aa110` (verified exact)
- origin/dev: `6457ca1da78fcfd2a39ea391ee559b8d945b240a` (verified exact)
- Merge base: `6457ca1da78fcfd2a39ea391ee559b8d945b240a`
- Runtime source commit: `1e0b44d5a8a08ec168a14d542456c11212a7c610`
- `1e0b44d5..HEAD` changes only committed evidence files.

## Skill-Perspective Check

The `remove-ai-slops` and `programming` skills were explicitly loaded and applied before judging tests and maintainability.

- `remove-ai-slops`: VIOLATION. The deletion-cleanup tests expose and assert private generation bookkeeping through a test-only production parameter instead of observable behavior.
- `programming`: VIOLATION. The same test seam mirrors implementation state, and this PR adds more tests to `plugin/event.test.ts`, which is already far beyond the documented 250 pure-LOC ceiling.

## CRITICAL

None.

## HIGH

### 1. The committed live OpenCode QA does not exercise the twentieth active-root repair

The live harness creates one root session, prompts that same session twice, and aborts the second turn. It never creates roots A and B concurrently, never deletes B to restore A, and never proves that an older active root remains watchdog-eligible after B becomes latest. See `.omo/evidence/20260716-pr-6043-main-watchdog/run-live-watchdog-qa.sh:136-165`.

The only two-root watchdog test manually seeds the registry with `setMainSession()` and invokes the watchdog directly (`packages/omo-opencode/src/hooks/runtime-fallback/first-prompt-watchdog-main-session.test.ts:22-55`). The deletion test separately checks only the latest getter (`packages/omo-opencode/src/plugin/event.test.ts:1390-1422`). Neither drives the real plugin event ordering, where runtime-fallback hooks run before lifecycle registration/removal.

This leaves the exact behavior introduced by the twentieth repair without the mandatory real-harness proof required for OpenCode-connected lifecycle changes. The README's sufficiency claim at `.omo/evidence/20260716-pr-6043-main-watchdog/README.md:495-509` is therefore unsupported for the active-root change.

Required before approval: add exact-source isolated OpenCode QA that creates root A, creates root B, keeps A silent and proves A still falls back; then deletes B and proves A remains current/eligible. Commit the resulting event and isolation artifacts.

### 2. The final evidence labels non-executed/sanitized checks as successful exact-source gates

The committed whole-file Biome artifact records one error and two warnings (`twentieth-biome-all-changed.txt:1-62`). The purported passing Biome artifact states that it modified three legacy lines in temporary copies before checking them (`twentieth-biome-scoped.txt:1-5`), so it is not a check of the exact repository source.

The README also says the standalone no-excuse helper could not load TypeScript (`README.md:485-486`), but later states that the helper completed successfully (`README.md:516-518`). `twentieth-no-excuse-scoped.txt:1-2` is a manual diff-pattern assertion, not output from the documented helper. I independently reproduced both facts: typecheck passed, while exact-source Biome failed and the no-excuse helper threw before analysis.

This is contradictory success reporting in the required QA evidence. The pre-existing nature of the Biome diagnostics can be documented, but a temporary-copy pass and a manual substitute must not be represented as successful exact-source tool gates.

Required before approval: correct the evidence narrative and provide honest exact-source gate results. If a gate is waived because failures predate the PR, prove that with base/head comparison and label it as a qualified failure, not a pass.

## MEDIUM

### 1. Missing-ID coverage does not assert the active-root membership contract

The malformed `session.created` regression asserts only `getMainSessionID()` (`packages/omo-opencode/src/plugin/event.test.ts:1424-1450`). The watchdog now relies on `isMainSession()` (`packages/omo-opencode/src/hooks/runtime-fallback/first-prompt-watchdog.ts:114-117`). A regression that preserved `_mainSessionID` while clearing `mainSessionIDs` would pass this test but disable the watchdog for the preserved root.

Add an assertion on `isMainSession(rootSessionID)` or, preferably, drive a subsequent user event and prove the root watchdog still arms.

### 2. Deletion tests mirror private bookkeeping through a test-only production seam

`createFirstPromptWatchdog()` accepts a mutable `sessionGenerations` map (`first-prompt-watchdog.ts:27-32`) solely so `first-prompt-watchdog-deletion.test.ts:18-64` can inspect whether internal entries were deleted. This is implementation-mirroring coverage and unnecessary production API surface under both required skill perspectives.

Cover deletion through observable behavior: delete an armed/suspended session, reuse the ID or advance the old timer, and assert that no stale abort/fallback occurs and a fresh generation behaves correctly.

### 3. New tests extend an already oversized test module

`packages/omo-opencode/src/plugin/event.test.ts` is approximately 1,566 pure LOC after this PR, and the twentieth repair adds another 70 lines there. This violates the loaded programming skill's 250 pure-LOC ceiling and makes lifecycle regressions harder to isolate. Move the new root-registry lifecycle cases to a focused module.

## LOW

None.

## Independent Verification

- `bun test packages/omo-opencode/src/hooks/runtime-fallback`: 291 pass, 0 fail.
- `bun test` for `event.test.ts`, `event.monitor.test.ts`, and session state: 53 pass, 0 fail.
- `bunx tsgo --noEmit -p packages/omo-opencode/tsconfig.json`: pass.
- Exact-source Biome over the six twentieth-repair files: fail with 1 error and 2 warnings, matching the committed failure artifact.
- No-excuse helper: crashes before analysis because `ts.ScriptTarget` is unavailable, matching the committed qualification.
- `git diff --check origin/dev...HEAD`: pass.
- Worktree was clean before review commands; tests did not alter tracked source.

## Verdict

- codeQualityStatus: BLOCK
- recommendation: REQUEST_CHANGES
- blockers:
  1. Add real OpenCode QA for the two-active-root and deletion-restoration behavior.
  2. Correct the contradictory/static-gate evidence and stop labeling temporary-copy/manual audits as successful exact-source tool runs.

BLOCK
