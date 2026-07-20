WHAT WAS TESTED

- `bun test packages/omo-opencode/src/hooks/atlas/final-wave-approval-gate-regression.test.ts packages/omo-opencode/src/hooks/atlas/final-wave-approval.test.ts packages/omo-opencode/src/hooks/todo-continuation-enforcer/todo-continuation-enforcer.test.ts packages/omo-opencode/src/hooks/todo-continuation-enforcer/parent-wake-race.test.ts packages/omo-opencode/src/hooks/todo-continuation-enforcer/opencode-overload-continuation.test.ts packages/omo-opencode/src/hooks/todo-continuation-enforcer/dispose.test.ts`
- `bunx tsgo --noEmit -p packages/boulder-state/tsconfig.json`
- `bunx tsgo --noEmit -p packages/omo-opencode/tsconfig.json`
- `bash script/agent/qa-docker.sh exec bash -lc 'bash .agents/skills/opencode-qa/scripts/lib/common.sh --self-check && bash .agents/skills/opencode-qa/scripts/sse-hook-probe.sh --self-test'`

WHAT WAS OBSERVED

- `focused-tests.txt`: 76 tests passed, 0 failed. The new regression drives Atlas final-wave completion and then the todo-continuation idle hook with pending todos; `promptAsync` remains at 0 while Boulder has `pause.reason = "final_wave_approval"`, and the pause clears on a user message.
- `typecheck-boulder-state.txt`: no output, command exited 0.
- `typecheck-omo-opencode.txt`: no output, command exited 0.
- `opencode-docker-qa.txt`: disposable Docker QA image had all OpenCode QA dependencies, the isolated XDG sandbox self-check passed, and `/event` delivered `server.connected`.

WHY IT IS ENOUGH

- The regression covers the reported surface: Atlas sets the final-wave approval gate, then the separate todo/Boulder continuation hook observes the same session and does not inject a continue prompt.
- The direct package typechecks cover the changed core state package and the OpenCode adapter hook consumers.
- The OpenCode QA harness ran in the recommended disposable container and proved the event stream used by OpenCode hook delivery works without touching the host database.

WHAT WAS OMITTED

- Local host `opencode-qa/scripts/lib/common.sh --self-check` was attempted but omitted from pass evidence because the host lacks `sqlite3`. Docker QA was used instead and passed with `sqlite3` present.
- No provider-backed `opencode run` was used; this change is hook/state control flow and is covered by the isolated hook driver plus OpenCode SSE hook-delivery smoke.
