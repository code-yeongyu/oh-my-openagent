WHAT WAS TESTED

- `bun test packages/omo-opencode/src/hooks/atlas/final-wave-approval-gate-regression.test.ts packages/omo-opencode/src/hooks/atlas/final-wave-approval.test.ts packages/omo-opencode/src/hooks/todo-continuation-enforcer/todo-continuation-enforcer.test.ts packages/omo-opencode/src/hooks/todo-continuation-enforcer/parent-wake-race.test.ts packages/omo-opencode/src/hooks/todo-continuation-enforcer/opencode-overload-continuation.test.ts packages/omo-opencode/src/hooks/todo-continuation-enforcer/dispose.test.ts`
- `bunx tsgo --noEmit -p packages/boulder-state/tsconfig.json`
- `bunx tsgo --noEmit -p packages/omo-opencode/tsconfig.json`
- `bun run build`
- `bash script/agent/qa-docker.sh exec bash -lc 'bash .agents/skills/opencode-qa/scripts/lib/common.sh --self-check && bash .agents/skills/opencode-qa/scripts/sse-hook-probe.sh --self-test'`

WHAT WAS OBSERVED

- `focused-tests.txt`: 77 tests passed, 0 failed. The regression suite now covers three Atlas gate scenarios plus the reviewer-fix scenario (a later non-pausing subagent completion must not clear an active `final_wave_approval` pause). The new test was confirmed to fail against the pre-fix code (`Received: undefined`) and pass against the fixed code.
- `typecheck-boulder-state.txt`: no output, command exited 0.
- `typecheck-omo-opencode.txt`: no output, command exited 0.
- `bun run build`: completed successfully (`build: all steps completed`, exit 0).
- `opencode-docker-qa.txt`: disposable Docker QA image had all OpenCode QA dependencies, the isolated XDG sandbox self-check passed, and `/event` delivered `server.connected`.

WHY IT IS ENOUGH

- The regression covers the reported surface: Atlas sets the final-wave approval gate, then the separate todo/Boulder continuation hook observes the same session and does not inject a continue prompt.
- The reviewer-fix scenario pins the invariant the original PR violated: only an explicit user message in the orchestrator session clears a persisted `final_wave_approval` pause. The test was verified to fail before the fix and pass after, so the invariant is now load-bearing on the test suite.
- The direct package typechecks cover the changed core state package and the OpenCode adapter hook consumers.
- The OpenCode QA harness ran in the recommended disposable container and proved the event stream used by OpenCode hook delivery works without touching the host database.

REVIEWER FIX (PR #6224 follow-up)

- Reviewer (acamq) flagged that `buildSubagentCompletionReminder()` had an `else if (input.orchestratorSessionId) clearBoulderPause(...)` branch that cleared the persisted pause on any later subagent completion where `shouldPause` was false, contradicting the PR's stated invariant.
- Fix: removed the `else if` branch from `packages/omo-opencode/src/hooks/atlas/subagent-completion-reminder.ts` and dropped the now-unused `clearBoulderPause` import. Pause clearing now happens only in `event-handler.ts` on a user message.
- New regression test: `final-wave-approval-gate-regression.test.ts` -> "a later non-pausing subagent completion does not clear an active final-wave approval pause".

WHAT WAS OMITTED

- Local host `opencode-qa/scripts/lib/common.sh --self-check` was attempted but omitted from pass evidence because the host lacks `sqlite3`. Docker QA was used instead and passed with `sqlite3` present.
- No provider-backed `opencode run` was used; this change is hook/state control flow and is covered by the isolated hook driver plus OpenCode SSE hook-delivery smoke.
