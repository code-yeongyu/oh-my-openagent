# PR 7072 print recovery flush guard QA

## What was tested
- `bun test packages/omo-senpi/src/components/task/event-bridge-session-lifecycle.test.ts packages/omo-senpi/src/components/task/session-transition-bridge.test.ts`
- `bunx tsgo --noEmit -p packages/omo-senpi/tsconfig.json`
- `bun run test:senpi`
- `node packages/omo-senpi/scripts/qa/drive.mjs --self-test`
- `PATH="$PWD/node_modules/.bin:$PATH" SENPI_QA_OUT_DIR=<evidence>/live-drive node packages/omo-senpi/scripts/qa/drive.mjs`
- `node packages/omo-senpi/plugin/scripts/build-extension.mjs`

## What was observed
- Focused lifecycle/transition tests: 17 pass, 0 fail.
- Typecheck: pass.
- Senpi package gate: 2211 pass, 1 Windows-only skip, 0 fail; evidence resolver suite 10 pass, 0 fail.
- Driver self-test: PASS (`drive-self-test.log`).
- Real Senpi driver: PASS (`live-drive.log`). It reported `ultraworkInjected: true`, `commentChecker: PASS`, and `realSenpiUntouched: true`.
- The driver used isolated agent dir `/private/var/folders/6g/qsrg81cx42xfz2chj2vszv3r0000gn/T/omo-senpi-qa-8Z5m4p/agent` and isolated cwd `/private/var/folders/6g/qsrg81cx42xfz2chj2vszv3r0000gn/T/omo-senpi-qa-8Z5m4p/project`.
- Extension bundle generation completed successfully and refreshed `packages/omo-senpi/plugin/extensions/omo-task.js`.

## Why it is enough
The focused tests prove that `agent_end` releases exactly one print-mode recovery buffer while a subsequent switch transition cancels that ownership and leaves transition-buffered completions to `SessionTransitionBridge`. The full package gate covers adapter regressions, and the real isolated Senpi run proves the built plugin still loads and exercises the harness without touching the real Senpi agent directory.

## What was omitted
No environment dumps, authentication material, or raw model transcripts were recorded. The live driver emits only its bounded final JSON.
