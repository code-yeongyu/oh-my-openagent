# Windows CI timing flake QA

## What was tested

1. `bun test packages/senpi-task/src/team/member-extension/index.test.ts packages/senpi-task/src/team/tasks.test.ts --rerun-each 20`
   - Proves both adjusted tests preserve their assertions across 20 consecutive executions.
2. `bun --cwd packages/senpi-task run typecheck`
   - Proves the package remains type-correct.
3. `bun --cwd packages/senpi-task test`
   - Proves the complete `senpi-task` package suite.
4. `bun run test:senpi`
   - Proves the mandatory Senpi plugin build, adapter typecheck, and package test gate.
5. `bun packages/senpi-task/scripts/manual-qa.ts /tmp/omo-windows-ci-flake-manual-qa`
   - Drives task record persistence, transitions, traversal rejection, redaction, corruption handling, and cleanup.
6. `SENPI_BIN=packages/senpi-task/node_modules/.bin/senpi node packages/omo-senpi/scripts/qa/team-e2e.mjs`
   - Drives the real pinned Senpi CLI through member injection, team wait, task claim/update, shutdown, durability, reclaim, and crash recovery.
7. `SENPI_BIN=packages/senpi-task/node_modules/.bin/senpi node packages/omo-senpi/scripts/qa/task-e2e.mjs`
   - Drives the real pinned Senpi CLI through background, follow-up revive, blocking output, batch, sync, and invalid-input paths.

## What was observed

- Focused stress: 140 passed, 0 failed.
- `senpi-task` package: 823 passed, 0 failed.
- Mandatory `test:senpi` gate: 304 passed, 0 failed.
- Team live QA: `PASS`, all 25 behavioral checks true, no leaked processes.
- Task live QA: `PASS`, all 12 checks passed, no leaked processes, and the real Senpi agent directory was unchanged.
- Manual task-store QA completed with identical reload, redaction, traversal rejection, no outside write, final completed status, and successful cleanup.

Exact structured results are recorded in:

- `team-e2e.json`
- `task-e2e.json`
- `manual-task-store.json`

## Why this is enough

The code change only widens bounded test budgets. The focused stress run exercises the two exact assertions repeatedly, the package and adapter gates cover their surrounding implementation, and the live Senpi drivers prove that member polling, task claiming, message delivery, and recovery still work through the actual CLI surface.

## Isolation and omissions

- Live passing QA used the repository-pinned Senpi `2026.7.5-2`, matching `packages/senpi-task/package.json`.
- An initial run accidentally selected global Senpi `2026.7.22`; that runtime compacted immediately because of a compatibility mismatch and never reached the scripted actions. Those failed `/tmp` debug logs are not committed because they are not evidence about this change.
- The passing task QA reported `realSenpiUntouched: true`, no changed real paths, and four sandbox `SENPI_CODING_AGENT_DIR` values.
- No credentials, auth files, environment dumps, or raw private session transcripts are included.
