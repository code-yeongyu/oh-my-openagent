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

Every group of legs has its own budget (`budgetS` in `probe-sp-n.ts`), and starting the target windows has
`SETUP_BUDGET_S`. A group past its budget has its helper processes killed, and each of its rows is written
`UNMEASURED` with `timeout after Ns`, where N is the seconds it ran. Such a row is never dropped and never
gets a verdict. `TOTAL_BUDGET_S` is the sum, and it is held at or below 30 minutes, under the hosted job's
40-minute timeout. `bun crates/omo-computer-backend-win32/probes/probe-sp-n.ts --self-test` checks both on
any OS: a fake leg past its budget must produce that exact row, and the total must stay under the limit.

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

`id`, `question`, `condition`, `measured`, `verdict`, `rerun`, `host`, `build`.

- `verdict` is one of:
  - `CONFIRMS`: the design's statement held.
  - `CONTRADICTS`: it did not.
  - `NEW-EDGE`: a result the design does not name.
  - `UNMEASURED`: the leg could not run. The reason is in `measured`; nothing is guessed.
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
