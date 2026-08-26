# QA Evidence — dag tool wait: monitor-style detach by default

Date: 2026-08-26 · Branch: `feat/dag-wait-detach` · Slug: `20260826-dag-wait-detach`

## What was tested

The dag tool's `wait` action no longer blocks the session turn by default:

1. **Detach-by-default** against a live run — returns a `detached` envelope with the live snapshot and registers NO waiter on the real wait surface.
2. **Blocking preserved** — `detach: false` blocks for real, then settles through the real `createDagJournal` append path (scheduler reducer + WAL + `publishCommit` → the wait surface's durable channel).
3. **Terminal-immediate** — a settled run returns the final `waited` result immediately, never a detached envelope.
4. **Wake path** — the terminal wake is delivered through the real `IdleInjectionCoordinator` (production flush window) as a `steer` message naming the run, the outcome, and the full DAG verification directive.
5. **Live-session wiring** — the plugin loads and runs in a real `senpi` session in strict isolation (`drive.mjs`).

## What was observed

- `dag-wait-detach-qa.json`: driver `packages/omo-senpi/scripts/qa/dag-wait-detach-qa.ts` — `"result": "PASS"`, zero failures. Captured `detached_text` shows the model-facing detach notice; `wake_delivery` shows the real `omo-senpi:wake` steer with the directive verbatim.
- `drive-self-test.json`: `drive.mjs --self-test` rc=0 (isolation harness works).
- `drive-live.json`: `"result": "PASS"`, `realSenpiUntouched: true`, `providedSenpiCodingAgentDir: "IGNORED"`, sandbox agent dir under the driver's own tmp root.

Unit/e2e gates (repo root): `bun test packages/senpi-task` 1758 pass / 1 skip (Windows) / 0 fail; `bun test packages/omo-senpi` 2291 pass / 1 skip / 0 fail on the branch and 0 fail on a pristine origin/dev baseline worktree — an earlier first run's 5 fails were not reproducible on either tree (env flakiness, not caused by this change); `tsgo --noEmit` clean on both packages; `build-extension.mjs --check` current, including after the dev merge (bundle conflict resolved by regeneration).

## Why this is enough

The detach contract has three halves and each is proven on its real surface: the tool envelope (real `runDagTool` + real `DagManager` + real wait surface, waiter-count observability), the settle path (real journal append through the production reducer, not a stubbed notify), and the wake delivery (real coordinator flush, not injected timers). The assembled-runtime e2e (`dag-e2e-lifecycle.test.ts`) adds the full composition proof: detached tool wait → child settle → batched terminal steer. Live plugin loading is proven by `drive.mjs`.

## What was omitted

- No spawned-senpi dag run: repo precedent for dag features is real-component drivers (`dag-gate-proof.ts`, `dag-paused-header-qa.ts`); no live-senpi dag driver exists in the harness. The mock-provider child-scripting lift was deliberately not taken.
- Windows/macOS matrix: covered by CI, not by this local run.

## Cleanup receipts

- `dag-wait-detach-qa.ts` temp store root removed by the driver itself (`finally` rmSync); verified absent.
- `drive.mjs` sandbox (`omo-senpi-qa-oSVrPQ`) self-cleaned; verified absent.
- Suite-spawned leaks killed and verified dead: lsp-daemon pid 21842, typingsInstaller pid 22021 (into the deleted sandbox), memory facts fixtures pids 27099/27104/27109; `omo-facts-runner-zqHW2y` temp dir removed.
- No changes to the real `~/.senpi/agent` (`realSenpiUntouched: true`).
