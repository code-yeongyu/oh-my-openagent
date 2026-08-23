# PR 7072 transition-buffer flush QA

## What was tested

- Focused lifecycle and transition tests for print-mode session recovery ordering.
- `bunx tsgo --noEmit -p packages/omo-senpi/tsconfig.json`.
- `bun run test:senpi`.
- `node packages/omo-senpi/plugin/scripts/build-extension.mjs` and generated output verification.
- Real Senpi 2026.8.22-2 task driver using the isolated `task-e2e.mjs` harness.

## What was observed

- The new regression test fails on the prior head because `transitions.onSessionStart` runs during print-mode `session_start`.
- After the fix, transition-buffer resolution runs first inside deferred `before_agent_start`, before reconciliation. Interactive starts still resolve immediately.
- Focused tests: 26 pass, 0 fail.
- Typecheck: pass.
- Senpi gate: 2233 pass, 1 Windows-only skip, 0 fail.
- Live task driver: PASS; all 28 checks pass, including task output polling guard and resume flows.
- Isolation: `realSenpiUntouched=true`, no changed real-agent paths, and `leakedPids=0`. Exact bounded driver result is in `live-task/verdict.json`.

## Why it is enough

The focused regression pins the reported ordering bug directly. The package gate covers adapter and task-engine regressions, while the real isolated driver proves the changed generated adapter still works through Senpi task, polling, completion, and resume surfaces.

## What was omitted

Raw Senpi logs and sandbox tokens were not copied into this README. The bounded verdict records only reviewer-relevant outcomes and isolation fields.
