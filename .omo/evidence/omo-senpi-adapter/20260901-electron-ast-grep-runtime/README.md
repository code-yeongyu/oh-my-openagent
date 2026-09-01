# Electron ast-grep runtime QA

## What was tested

- Ran `node packages/omo-senpi/scripts/qa/drive.mjs --self-test`.
- Ran `node packages/omo-senpi/scripts/qa/drive.mjs` against the real `senpi` binary.
- Ran the focused ast-grep component regression test before and after the fix.

## Observed result

- The QA driver self-test reported `SELF-TEST OK`.
- The live driver reported `PASS`, injected the expected ultrawork directive, and passed the comment checker.
- Both real agent homes remained untouched with no observed, volatile, protected, or credential changes.
- The regression test failed before the implementation because `ELECTRON_RUN_AS_NODE` was absent, then passed all four cases after the implementation.

## Why this is enough

The component test pins the child-process environment that controls Electron runtime behavior. The live driver proves the changed Senpi adapter still loads and runs in the real harness while preserving strict home-directory isolation.

## Isolation and cleanup

- Real homes checked: `/Users/alreadygiven/.senpi/agent`, `/Users/alreadygiven/.omo/agent`
- Driver sandbox: `/private/var/folders/_9/n7j5ydvn20g78wqjtjjj02zc0000gn/T/omo-senpi-qa-oEFOel/agent`
- Driver project: `/private/var/folders/_9/n7j5ydvn20g78wqjtjjj02zc0000gn/T/omo-senpi-qa-oEFOel/project`
- Driver-owned temporary paths were removed by the driver before it returned.
- No task-owned child processes were started by this QA case.

## Omitted

- Task, team, and DAG live drivers were not run because this change only affects the ast-grep MCP child process environment.
