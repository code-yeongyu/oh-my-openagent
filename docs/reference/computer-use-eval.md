# Computer-use eval and latency bench

`packages/omo-senpi/scripts/qa/cu-eval/` measures computer use end to end: seven tasks through three arms, each judged by its own oracles, plus a latency bench with per-host baselines. Neither ever calls a real model.

## Tasks

| id | Task | Fake-engine oracle | Live oracle (macOS) | Restore and post-check |
|----|------|--------------------|---------------------|------------------------|
| `calculator-multiply` | Calculator 7 x 8 | four AX presses in the engine audit; the result is `unverified` (the fake runs no app logic) | display reads `56` | clear; display reads `0` |
| `finder-sidebar-navigate` | Finder sidebar to Downloads | the sidebar press in the audit; the folder change is `unverified` | a Finder window titled `Downloads` | back to the start folder, window closed |
| `textedit-korean-no-save` | Korean text in TextEdit, never saved | AX value equals the text; Save never pressed | AX value equals the text | text cleared, document closed `saving no`; the file on disk is unchanged |
| `safari-form-fill` | Fill a form in Safari | both field values | both field values | fields cleared, tab closed |
| `settings-toggle` | One System Settings switch | the press in the audit; the flip is `unverified` | the switch value flipped | pressed back; value equals the one read before the task |
| `textedit-two-windows-target` | Type into one of two TextEdit windows | the named window holds the text, the other is untouched | same | cleared and closed `saving no`; both files unchanged |
| `menu-path-select` | Format > Text > Show Ruler | `menus.select` in the audit, the path exists in the window menu | the menu now offers Hide Ruler | Hide Ruler, document closed; file unchanged |

A task is `pass` when every check holds, `fail` when any check is false, and `unverified` when none is false but an effect could not be observed (the fake backend's AX writes are real, app logic is not). Live tasks expect an English UI.

## Arms

- `sdk-direct`: no model. The SDK's `spawn` transport starts `senpi-desktop-engine --stdio` through `engine-port.mjs`, which runs the host handshake (`engine.hello`, `session.open` with `reportMode: "object"`, `stopPath.start`, a 500 ms heartbeat) and the task plan runs through the facade.
- `model-tool`: the real senpi CLI and the built plugin against a local fake model server (`mock-completions-server.mjs`) scripted to call the `computer` tool with `run` code.
- `model-cua`: the same, scripted to call `computer_actions` (`cua_adapter: true`) with clicks at element centers and typed text. A menu path has no pixels on the fake desktop, so that task fails by design.

The model arms read the result back with a harness-owned `computer` run after the arm's own calls; those calls are counted as `harnessCalls`, never as `steps`.

## Metrics

Every row carries `steps`, `tokens`, `wallMs`, `status`, the check list, a restore verdict, and a disposition histogram. sdk-direct takes dispositions from ActionReports. The model arms take them from the engine trace (`computer.trace: true`); a `null` reply from a session without report mode counts as `legacy_null`. The fake model server reports no usage, so model-arm tokens are an estimate (request characters / 4) and say so in `tokens.source`.

## Bench

`bench.mjs` runs 3 warm-up and 30 measured rounds of `windows`, `capture`, `observe`, `ax.query`, `click`, `ax.setValue`, `ax.typeText` and (fake only) `ax.perform`. It records wall time at the stdio port and the engine's per-stage `ActionReport.timings` (microseconds) as nearest-rank p50/p95, with the host load averages before and after. `--write-baseline` writes `baselines/<platform>-<arch>-<fake|live>.json`. `--compare <baseline>` exits 1 when an op's wall p50 rises more than 30% above the baseline and by more than 0.5 ms.

## CI regression job

`.github/workflows/desktop-bench.yml` runs on a pull request only when it touches `crates/senpi-desktop-*`, `packages/senpi-desktop-*`, `packages/omo-senpi/scripts/qa/cu-eval/`, the Cargo manifests, the toolchain pin or the workflow itself; `workflow_dispatch` takes a `base_ref` (default `dev`) once the file is on the default branch. One job checks out the PR's base and the PR's merge result, builds `senpi-desktop-engine` at both, and runs the head's `bench.mjs --fake-engine` against each in 10 interleaved rounds of 30 measured runs, swapping which side goes first every round. The head's harness is copied into the base checkout, so only the SDK and the engine differ between the sides. Each side keeps its best wall p50 per op, and the job fails when any head p50 is more than 30% and more than 0.5 ms above the base's, the same rule as `--compare`.

The step prints one line per op and a closing `bench comparison: base <sha> vs head <sha>: PASS|FAIL (...)` line, writes the same table to the job summary, and uploads every round's JSON plus `comparison.json` as the `desktop-bench` artifact. A round that keeps fewer than 90% of an op's samples fails the job (a concurrent stop-path heartbeat reply can displace a sample, so a single lost sample is tolerated and counted). A base without `packages/senpi-desktop-sdk` fails with that reason, since there is nothing to compare against.

## Commands

```bash
cargo build --release -p senpi-desktop-engine
node packages/omo-senpi/scripts/qa/cu-eval/run.mjs --arm sdk-direct --fake-engine --json
node packages/omo-senpi/scripts/qa/cu-eval/run.mjs --arm all --fake-engine --out cu-eval.json
node packages/omo-senpi/scripts/qa/cu-eval/run.mjs --arm sdk-direct --fake-engine --mismatch safari-form-fill   # QA control: exits 1
node packages/omo-senpi/scripts/qa/cu-eval/bench.mjs --fake-engine --compare packages/omo-senpi/scripts/qa/cu-eval/baselines/linux-x64-fake.json
# macOS (a QA account, apps in English):
node packages/omo-senpi/scripts/qa/cu-eval/run.mjs --arm sdk-direct --live --json --out cu-eval-live.json
node packages/omo-senpi/scripts/qa/cu-eval/bench.mjs --live --write-baseline --out bench-live.json
```

Both scripts re-run themselves on Bun when started with Node (the SDK is TypeScript source). `--engine <path>` or `CARGO_TARGET_DIR` picks the engine binary. Exit 0 means every task ran with no `fail` or `error` and every restore post-check held.
