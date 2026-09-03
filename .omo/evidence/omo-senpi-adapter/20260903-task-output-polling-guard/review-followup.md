# PR #7662 review follow-up

## Evidence location

The evidence path was resolved before this follow-up with:

```bash
node .agents/skills/senpi-qa/scripts/resolve-evidence-dir.mjs \
  --repo-root "$(git rev-parse --show-toplevel)" \
  --slug 20260903-task-output-polling-guard
```

It resolved to this directory. This receipt contains only commands, source-level outcomes, test counts, and bundle SHA-1 values; it contains no credentials, environment dump, or raw session log.

## Failing first

Before the source fixes, this focused command ran 12 tests and failed exactly two assertions:

```bash
bun test ./packages/omo-senpi/src/components/task/task-rpc-codec.test.ts \
  ./packages/omo-senpi/src/components/task/event-bridge-session-lifecycle.test.ts
```

1. `boundedTaskOutput` returned an overlong `no_progress.task_id` and `reason` unchanged.
2. A `session_compact` payload without `accepted: true` cleared the task-output status-read cache.

## Fix and regression coverage

- `boundedTaskOutput` now has an explicit `no_progress` branch. It bounds `task_id` to 256 characters and `reason` to 2,000 characters, matching the function's bounded-output contract.
- `session_compact` now forgets task-output reads only when `payload.accepted === true`.
- The compact lifecycle regression covers `accepted: false`, a payload without `accepted`, and `accepted: true`; only the last case clears the cache.
- Re-running the focused command after the fix passed: 12 tests, 0 failures, 35 assertions.
- After rebasing with the remote RPC polling guard, the codec, event bridge, and RPC bridge regressions passed together: 18 tests, 0 failures, 61 assertions.

## Completed local verification

```bash
bunx --bun tsc --noEmit -p packages/omo-senpi/tsconfig.json
bunx --bun tsc --noEmit -p packages/senpi-task/tsconfig.json
bun test ./packages/senpi-task
bun test ./packages/omo-senpi/src/components/task
bun run test:senpi
node packages/omo-senpi/scripts/qa/drive.mjs --self-test
node packages/omo-senpi/scripts/qa/task-rpc-e2e.mjs --self-test
```

Each completed with exit status 0, and the listed checks were re-run after rebasing onto the fork's polling-guard commits. The final `bun run test:senpi` run covered 2,541 tests across 335 files: 2,540 passed, 0 failed, and one Windows-only production task-driver test was skipped on this macOS host. Both Senpi QA driver self-tests reported `SELF-TEST OK`.

## Live adapter wiring

```bash
SENPI_BIN="$(realpath node_modules/.bin/senpi)" \
  node packages/omo-senpi/scripts/qa/drive.mjs
```

This isolated manual QA passed with `ultraworkInjected=true` and `commentChecker=PASS`. It reported `realSenpiUntouched=true`, `realOmoUntouched=true`, empty changed-path arrays, and unchanged credential digests for both real agent homes. The driver-owned sandbox was removed after the run.

## Generated extension integrity

`node packages/omo-senpi/plugin/scripts/build-extension.mjs` regenerated the runtime bundle.
`node --check packages/omo-senpi/plugin/extensions/omo-task.js` passed.
The runtime bundle contains three parsed `no_progress` markers.

All generated JavaScript bundles other than `omo-task.js` retained their SHA-1 values:

| Bundle | SHA-1 before | SHA-1 after |
| --- | --- | --- |
| `omo-init-deep-advisor.js` | `ef9ac053e0ffb1424c9f8e043840a52ac4032662` | `ef9ac053e0ffb1424c9f8e043840a52ac4032662` |
| `omo-member.js` | `bf95bc5072953df9a45162318f3fd7482caf3e9d` | `bf95bc5072953df9a45162318f3fd7482caf3e9d` |
| `omo-memory-mcp.js` | `f38706996414e8e6477a52720624dc8d568ede23` | `f38706996414e8e6477a52720624dc8d568ede23` |
| `omo.js` | `25697bee889a8565a5ded2a91232226a95acc885` | `25697bee889a8565a5ded2a91232226a95acc885` |

`omo-task.js` is the expected exception: it changed from `e3ab6da368bc788dc3010671f7f28c8144447b7a` to `9758fd9657eacec3b192f616e59b9bde253e4cf3` for the local source fix. After rebasing onto the fork's polling-guard changes, its remote baseline was `d01cfef3d2b5e6234559305604bea791833e3672`; `b940dd7eb57bae3b223ada320b31706ef33cfc92` was the then-current regeneration. The current source was rebuilt and exercised before the final commit: its generated `omo-task.js` SHA-1 is `b844f133680cdcce87ec578d894482e061afa9a0`. That bundle passed `node --check`, contained the parsed `no_progress` markers, and produced the scoped real-Senpi receipt below.

## Scoped live task-output follow-up

The initial broad driver mixed task revival and output-peek assertions in one process. Its `task_output` check could not execute after the parent print-mode session had ended, so that aggregate FAIL was not valid evidence for the direct output surface.

The corrected scoped driver uses two real Senpi invocations in the same explicit session: the first starts and completes a background child, and the second invokes `task_output` twice against that child. It passed all seven checks, including a first `status` and second `no_progress` result, durable JSONL ordering, no leaked PIDs, and real-agent isolation. The sanitized receipt is `live-task-e2e/verdict.json`; it contains no task IDs, PIDs, host paths, or raw model/session output.

Separately, a minimal executable `task_output` library-surface driver repeated terminal task status reads with notifications disabled and enabled. It passed only when the no-notification case said that no completion notification will be sent, while the notification-enabled case retained the await guidance. This exercises the terminal guidance introduced for the additional review finding.

## Current-head Codex follow-up

The current-head review correctly identified further gaps. The scoped driver proves the actual generated bundle's second unchanged `status` read returns `no_progress`, rather than only exercising `mode:"tail"`, and treats a nonzero follow-up Senpi process exit as a failed polling-guard check even if those events were emitted. Guidance preserves notification intent while a task is pending or running; after it is terminal, it requires a notifying status and an unacknowledged notification epoch. The TUI renders the factual `no_progress` reason instead of unconditionally instructing the user to await a notification. The current bundle SHA and scoped receipt above bind this latest QA run to the shipped generated artifact.

## Why this is enough

The focused failing-first receipt proves both original review findings were observable before the fix. The terminal guidance regression proves the later finding. The focused regression, both package typechecks, the full Senpi task package suite, the complete omo-senpi task-component suite, the repository `test:senpi` gate, driver self-tests, parsed generated-bundle marker, scoped real-binary output receipt, and direct terminal-notification driver cover the changed source and its shipped runtime form. The platform-specific skipped driver test is disclosed above rather than counted as a local pass.
