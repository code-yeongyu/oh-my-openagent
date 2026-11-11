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

A live sdk-direct task runs its restore steps and teardown ops on every exit path. If the task throws (a window that never appears, a refused plan step, a failed restore step), the steps it did not finish still run one by one before the engine closes and before its scratch files are removed. A step that fails there is listed in the row's optional `restoreErrors` (strings), and the row keeps its own `error` or `fail` status. An `onlyIfChanged` press whose state cannot be read back is skipped and listed there, never pressed blind.

## Bench

`bench.mjs` runs 3 warm-up and 30 measured rounds of `windows`, `capture`, `observe`, `ax.query`, `click`, `ax.setValue`, `ax.typeText` and (fake only) `ax.perform`. It records wall time at the stdio port and the engine's per-stage `ActionReport.timings` (microseconds) as nearest-rank p50/p95, with the host load averages before and after. `--write-baseline` writes `baselines/<platform>-<arch>-<fake|live>.json`. `--compare <baseline>` exits 1 when an op's wall p50 rises more than 30% above the baseline and by more than 0.5 ms.

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
