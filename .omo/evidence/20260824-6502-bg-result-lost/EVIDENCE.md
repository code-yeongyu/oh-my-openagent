# EVIDENCE — 20260824-6502-bg-result-lost

## WHAT WAS TESTED

1. Failing-first regression tests (RED before fix, GREEN after):
   - `bun test packages/omo-opencode/src/features/background-agent/manager.get-task-by-session-id.test.ts packages/omo-opencode/src/tools/background-task/create-background-output.session-fallback.test.ts`
   - Surfaces driven: `BackgroundManager` task lifecycle (trackTask -> complete -> removeTask eviction) and the `background_output` tool (`createBackgroundOutput`) resolution path.
   - Behavior meant to prove: a completed background task remains queryable by its `bg_` id AND by its session ID after the cleanup timer evicts it from the live map, with the result payload retained; `background_output` accepts a `ses_` id as a fallback and returns the task result; not-found guidance explains eviction/reload and points at `session_read`.
2. Scoped suites after the fix:
   - `bun test packages/omo-opencode/src/tools/background-task/ packages/omo-opencode/src/features/background-agent/manager.get-task-by-session-id.test.ts` -> 50 pass / 0 fail.
   - Full feature suite: `bun test packages/omo-opencode/src/features/background-agent/` -> 747 pass / 0 fail.
3. Type gate: `bun run typecheck` (tsgo --noEmit root + script + all workspace packages) -> exit 0.

## WHAT WAS OBSERVED

- RED (before implementation): 7 fail / 1 pass across the two new files.
  - 4 manager tests: `TypeError: manager.getTaskBySessionId is not a function`.
  - 3 tool tests: session-ID fallback unresolved / enriched guidance missing.
- GREEN (after implementation): 8 pass / 0 fail. The result-retention assertions
  (`byBgId?.result` and `bySessionId?.result` equal to the payload set before
  completion) pass, proving `archiveCompletedTask` no longer drops `result`.
- Scoped re-run after widening both `BackgroundOutputManager` definitions:
  50 pass / 0 fail across 13 files.
- Full background-agent suite: 747 pass / 0 fail (no regression from the new
  archive field or registry scan).
- `bun run typecheck`: initially caught one missed consumer
  (`tools/index.ts:41` via the duplicate `BackgroundOutputManager` in
  `background-task/types.ts`); after widening that Pick too, clean.
- Isolation: no opencode/codex/senpi process was spawned; all tests are
  hermetic bun tests using in-memory managers and mock clients. No real
  `~/.local/share/opencode/opencode.db`, `~/.codex`, or `~/.senpi/agent` was
  touched (nothing on this machine runs those harnesses against this worktree;
  no XDG sandbox needed because no harness binary was launched).

## WHY IT IS ENOUGH

- The regression test pins the exact issue #6502 scenario end to end at the
  unit seam where the bug lived: complete task -> `removeTask()` eviction ->
  later lookup still resolves (by bg_ id with result payload, and by session
  ID). This is the "complete task -> later lookup still returns result"
  contract required by the issue.
- The tool-level tests pin the LLM-facing behavior: ses_ fallback resolution,
  retry semantics, and actionable not-found guidance for both id shapes.
- The full 747-test background-agent suite plus repo-wide tsgo typecheck cover
  the blast radius of the widened Pick types and the new public manager method.
- Remaining risk: lookup-by-session is a linear scan over bounded collections
  (live map, archive cap 100, registry cap 100), so worst-case cost is small
  and only paid on direct-map misses. Cross-process restart recovery beyond
  the in-process archives remains out of scope (session DB access via
  `session_read` guidance covers that path).

## WHAT WAS OMITTED

- No raw env dumps, tokens, auth headers, or logs are reproduced here; test
  output above is summarized pass/fail counts and assertion targets only.
- Live OpenCode TUI/CLI QA was omitted: the change is fully covered by
  hermetic unit seams (manager lifecycle + tool execute) and no harness binary
  behavior (hooks, SSE, config loading) was modified. The known pre-existing
  `packages/omo-native` payload.test.ts failure was not part of any scoped run
  and was not triggered here.
