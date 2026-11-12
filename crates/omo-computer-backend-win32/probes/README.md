# SP-N probes: Windows background delivery numbers

`win32-delivery.tsv` is the ledger of spike SP-N. Each row answers one question
under one condition, measured on a named host. Later Windows rows cite a row as
`cites crates/omo-computer-backend-win32/probes/win32-delivery.tsv:<id>`
wherever a constant or a default depends on it. The spike ships no engine code.

## Running

```sh
# measure every row on this host; rows of other hosts in the file are kept
bun crates/omo-computer-backend-win32/probes/probe-sp-n.ts --measure

# measure the rows of this host again; exits 0 only when every verdict matches
bun crates/omo-computer-backend-win32/probes/probe-sp-n.ts --verify crates/omo-computer-backend-win32/probes/win32-delivery.tsv

# one row
bun crates/omo-computer-backend-win32/probes/probe-sp-n.ts --verify crates/omo-computer-backend-win32/probes/win32-delivery.tsv --row n-dwmflush-ms
```

Preconditions, checked first: Windows, an interactive desktop
(`OpenInputDesktop` succeeds and the session id is not 0), and an elevated
administrator shell. Without one the probe prints one `PRECONDITION <name>: ...`
line, exits 2 and writes nothing. `--host <label>` names the host column; the
default is `hosted windows-latest` under GitHub Actions and
`H6 Windows 11 VM` elsewhere.

The legs that change the session (disconnect, lock, console display off) put
the session back with a SYSTEM scheduled task (`tscon <id> /dest:console`) and
record whether that worked in the row. Run them only on a desktop nobody is
using.

On hosted CI the workflow `.github/workflows/computer-spike-windows.yml` runs
the precondition, `--measure` and `--verify` on `windows-latest` and uploads the
ledger as an artifact.

## Time budget

Every group of legs has its own budget (`budgetS` in `probe-sp-n.ts`), plus the time its cleanups may take
after a timeout (`cleanupS`). Starting the target windows has `SETUP_BUDGET_S`.

When a group runs out of budget:
- its helper processes are killed, and its later legs, SYSTEM tasks and target spawns refuse to start;
- its registered cleanups still run before the run removes its directory or exits: reconnecting a
  disconnected or locked session with `tscon`, and dropping a SYSTEM task;
- each of its rows is written `UNMEASURED` with `timeout after Ns`, where N is the seconds it ran, followed by
  the cleanup results. Such a row is never dropped and never gets a verdict.

A target still starting when setup runs out of budget is killed, and its rows say why.

`TOTAL_BUDGET_S` is the budget of one pass. The hosted workflow runs two passes (`--measure`, then
`--verify`), so the self-test reads the workflow and checks that passes x `TOTAL_BUDGET_S` +
`JOB_OVERHEAD_S` + `JOB_MARGIN_S` fits its `timeout-minutes`.

Timing rows decide only outside a 10 % band around their limit. Inside it they read `UNMEASURED`, so two
back-to-back passes do not flip between `CONFIRMS` and `CONTRADICTS`.

## Self-test

`bun crates/omo-computer-backend-win32/probes/probe-sp-n.ts --self-test` runs on any OS. It has one check
per review finding it guards, for example:
- a leg past its budget gives exactly the timeout row;
- no `return` sits inside a loop body of a PowerShell leg;
- no leg sends input without the foreground check;
- the WebView2 package hash is pinned;
- the workflow budget fits its timeout;
- the committed ledger keeps both wheel rows INVALID.

`--measure` and `--verify` run the same logic checks first and refuse to measure when one fails.

## End of a run

The probe writes its output (the ledger, or the verify comparison) before any cleanup, even when the measurement
threw. The cleanup then:
- ends every child's process tree (`taskkill /T /F`) and waits, bounded, for each to exit;
- removes the run's directories, retrying a busy one 10 times over about 5 s.

A cleanup that fails, hangs or leaves a child running prints `SP-N WARNING (cleanup)` and never changes the
written output or the exit code. A measurement error prints `SP-N ERROR (measurement)` before the cleanup
warnings.

## Shared directory

SYSTEM tasks and the elevated helpers exchange files through a fresh directory under `%ProgramData%`:
- Its name is `omo-sp-n-<pid>-<random>`. A directory that already exists is refused, never reused.
- Only SYSTEM and Administrators may access it, and Administrators own it. This is checked after creation by SID
  only (`S-1-5-18`, `S-1-5-32-544`): never by a name, an SDDL alias or icacls text. A failed read reports its own
  error.
- Every path on a command line is quoted.

The ACL is read in the compiled C# (.NET `DirectorySecurity`), not with `Get-Acl`. No leg uses a PowerShell
module cmdlet, and every child the probe spawns gets its environment without `PSModulePath`: a Windows
PowerShell 5.1 child that inherits pwsh 7's module path cannot load its own modules.

The medium-integrity helper cannot write there, so it uses the run's own temp directory.

The WebView2 target extracts the SDK from the pinned, hash-checked package into a fresh subdirectory of this
directory.

## Files

| file | role |
|---|---|
| `probe-sp-n.ts` | orchestrator: preconditions, targets, verdicts, ledger read and write |
| `sp-n.ps1` | runs one leg per process and prints one JSON object |
| `sp-n-legs-delivery.ps1` | foreground and posted barrier, chords, UIPI, wheel after a raise |
| `sp-n-legs-capture.ps1` | capture class per session state, the affinity overlay, `IsSupported` |
| `sp-n-legs-session.ps1` | preconditions, host facts, timers, window lookup, disconnect, lock |
| `sp-n-native-*.ps1` | the C# P/Invoke fragments compiled by `sp-n.ps1` |
| `sp-n-target.ps1` | target windows that report their own text: WinForms TextBox, WPF, WebView2 |

## Ledger columns

`id`, `question`, `condition`, `measured`, `verdict`, `rerun`, `host`, `build`, `notes`.

`notes` is free text kept across re-measures of the same host and row, for example the design decision that adopted a finding. It never changes a verdict.

- `verdict` is one of:
  - `CONFIRMS`: the design's statement held.
  - `CONTRADICTS`: it did not.
  - `NEW-EDGE`: a result the design does not name.
  - `UNMEASURED`: the leg could not run. The reason is in `measured`; nothing is guessed.
  - `INVALID`: measured by a probe with a known defect. The reading stays in `measured` and the defect in
    `notes`; the next run supersedes the row.
- A `notes` value starting `SUSPECT` marks a verdict that rests on a read path later found to swallow errors. The
  verdict is kept as measured, and the next measurement of the row drops the note.

## Errors are results, never verdicts

A failed read is never counted as a negative:
- A leg that throws emits `legError`, and the probe raises it.
- A target state file that cannot be read makes the leg throw.
- `waitFile` rejects with the file's last parse error, or with "not written".
- A failed `WTSQuerySessionInformationW` raises its Win32 error.
- A failed UIA query is UNMEASURED with its text.

The affected rows read `UNMEASURED` with the error text. The self-test checks each of these paths.
- `rerun` is the exact command that measures the row again.
- Timings are 31 measured runs after 5 warm-ups, reported as p50 and p95.

## Oracles

- **Effect.** Every input row reads its effect from the target itself, never
  from the route that sent it:
  - The test windows write their own text to a state file.
  - For Notepad the probe sends `WM_GETTEXT` to its edit control.
- **Pixel class.** Capture rows classify a frame with the design's near-black
  sampler: at least 98 % of every 4th pixel near black is `black_frame`, and no
  image is `null_frame`.
- **Overlay.** Affinity rows count the overlay's magenta inside its rect. A
  control row without the flag must see the overlay first; if it does not, the
  dependent rows read `UNMEASURED`.
