# Disturbance sentinel

Records whether anything about a person's desktop session changed, even for a moment, while computer use works in
the background: eight signals (`key_focus`, `window_raised`, `typing`, `pointer`, `clipboard`, `space`, `dialog`,
`activation`), judged "happened at any moment", never "restored". QA instrument only; nothing here ships in the
engine binary, and it refuses to run outside a disposable QA desktop session (`OMO_COMPUTER_QA_SESSION=1`).

- `sentinel.ts`: the driver (`--self-test --os <os> [--sabotage drop-detector=<signal>]`) and `recordsOn(os)`.
- `with-sentinel.ts`: `withSentinel(scenario, fn, { session, windowMs })` for scenario sets.
- `observe-cell.ts`: the per-cell desktop observer the conformance catalog attaches to every background cell.
- `summary.ts` / `events.ts`: the pure reducer and the recorder's JSONL wire format.

## Adding a recorder for another OS

OS names are the conformance vocabulary's, exactly: `macos`, `windows`, `x11`, `wayland`. A recorder lives in the
directory of that name (`<os>/recorder.swift` or `<os>/recorder.ts`) and its OS is added to `RECORDED_OSES` in
`sentinel.ts` under the same string; `records-on.test.ts` fails when the two disagree. A consumer writes the eight
signals as `not_observed` on every OS `recordsOn` answers false for, so a misspelled key makes a real recorder read
as unavailable.

The self-test must plant each disturbance and prove each detector can miss it (`--sabotage`) before the OS counts.
