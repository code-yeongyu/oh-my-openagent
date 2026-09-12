# Evidence: #6391 - objectives longer than 2000 chars crashed the prompt

## WHAT WAS TESTED

- Failing-first regression tests (written BEFORE the fix; RED run failed on the then-missing
  `MAX_OBJECTIVE_LENGTH` / `truncateObjective` exports across all 4 touched test files):
  - `packages/omo-opencode/src/plugin/chat-message.test.ts`: an over-limit chat message and an
    over-limit first message with `default_mode.goal` must resolve WITHOUT throwing, with the
    objective captured by `setGoal` clamped to 2000 chars. The setGoal mock runs the real
    `validateObjective`, so pre-fix behavior (InvalidObjectiveError propagating out of the
    chat.message handler) fails these tests.
  - `packages/omo-opencode/src/plugin/command-execute-before.test.ts`: native `/goal <2000+ char args>`
    must not throw; captured objective is clamped to 2000.
  - `packages/omo-opencode/src/plugin/tool-execute-before.ulw-loop.test.ts`: `/goal` skill with a
    >2000-char `user_message` must not throw; captured objective is clamped to 2000.
  - `packages/omo-opencode/src/hooks/goal/validation.test.ts`: `truncateObjective` unit coverage
    (trim passthrough, clamp at cap, exact-cap unchanged, clamp output passes validateObjective).
- Scoped suites: `bun test packages/omo-opencode/src/hooks/goal/ packages/omo-opencode/src/plugin/`
  (392 tests, 57 files) plus the 4 directly touched files (64 tests).
- Typecheck: `bun run typecheck` (tsgo root + script + all workspace packages), exit 0.

## WHAT WAS OBSERVED

- RED (pre-implementation): all 4 test files failed with
  `SyntaxError: Export named 'MAX_OBJECTIVE_LENGTH' not found in module .../hooks/goal/validation.ts`.
- GREEN (post-implementation): 64 pass / 0 fail on the 4 touched files; 392 pass / 0 fail on the
  scoped goal+plugin suites. Artifacts: `scoped-tests-green.txt`.
- Crash mechanism reproduced against the real module (`repro-before-after.txt`):
  `validateObjective(<4000 chars>)` throws `InvalidObjectiveError: Objective exceeds maximum length
  of 2000 characters`; `truncateObjective(...)` returns 2000 chars that pass validation.
- Typecheck exit 0 (`typecheck-green.txt`).

## WHY IT IS ENOUGH

The owner-confirmed crash path is `handleGoalMessage -> hooks.goal.setGoal -> validateObjective`
throwing through Plugin.trigger with no try/catch in any caller. Every prompt-adjacent dispatch site
that feeds user-controlled text into setGoal now clamps via `truncateObjective` before the call:
chat.message setObjective branch, default_mode.goal auto-start branch (defense-in-depth),
command.execute.before `/goal`, tool.execute.before `/goal` skill. Controller-level validation is
intentionally untouched: goal tools (`create_goal`/`update_goal`) surface throws as tool errors, not
prompt crashes, and their descriptions document the 2000-char contract. Regression tests pin the
no-crash + clamp behavior at each site using the real validator inside the mocks.

## WHAT WAS OMITTED

- Live opencode harness drive (opencode-qa skill: CLI/TUI/SSE) was NOT run in this network-restricted
  worktree environment; verification scope for this task was defined as failing-first regression tests
  + scoped bun tests + typecheck. Residual risk: an integration-level regression in handler wiring is
  not covered here; the changed seam is pure synchronous clamping ahead of an unchanged call.
- No secrets, tokens, or env dumps are contained in these artifacts.
