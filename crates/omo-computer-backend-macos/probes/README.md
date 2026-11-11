# SP-M probe ledger: macOS private symbols on macOS 15 and 26

This directory holds the spike SP-M of the computer-use v3 plan (row 6). It contains no engine code: only the probe
script `probe-sp-m.ts` and the ledger `macos-spi.tsv` it writes. A constant in a macOS crate that depends on a
ledger row cites it in a comment of the form `cites crates/omo-computer-backend-macos/probes/macos-spi.tsv:<id>@<macos>`.

## Running

The probe needs a macOS 15 or 26 host and a process inside that host's graphical (Aqua) session. Started anywhere
else it prints one line naming the missing precondition, exits 3 and writes nothing.

```sh
bun crates/omo-computer-backend-macos/probes/probe-sp-m.ts --session                 # session type and grants only
bun crates/omo-computer-backend-macos/probes/probe-sp-m.ts --measure --out <tsv> \
    --pending 15="awaiting H2"                                                      # measure this host's major
bun crates/omo-computer-backend-macos/probes/probe-sp-m.ts --verify crates/omo-computer-backend-macos/probes/macos-spi.tsv
bun crates/omo-computer-backend-macos/probes/probe-sp-m.ts --row <id> --macos <major> # one row, as the rerun column says
bun crates/omo-computer-backend-macos/probes/probe-sp-m.ts --pending-only --out <tsv> \
    --pending 15="awaiting H2" --pending 26="awaiting H1: ..."                  # no host: every row UNMEASURED
```

`--pending-only` measures nothing and needs no host; it is how the ledger is written while neither host exists.

`--measure` replaces the rows of the host's own major and keeps the other major's rows (or writes them as
`UNMEASURED` with the `--pending` reason). `--verify` measures every row of the host's major again and exits 0 only
when the verdict column is identical on every row; other columns may differ (rects are bucketed to 8 px, timings
vary).

The probe raises no dialog, posts no input, moves no window and adds no Space. A question that needs one of those, a
grant the host does not have, or a fixture a later row builds is recorded `UNMEASURED` with the reason.

## Columns

| column | meaning |
|---|---|
| `id` | question id, stable across versions; one id per question per condition |
| `macos` | macOS major the row was measured on (`15`, `26`) |
| `subject` | the symbol or the measured surface |
| `condition` | the one condition this row measures |
| `verdict` | `CONFIRMS`, `CONTRADICTS`, `NEW-EDGE` or `UNMEASURED` |
| `rerun` | the exact command that measures this row again |
| `resolves` | `yes` / `no` from `dlsym`; `-` when the question is not a symbol |
| `behaves` | what the exercised call did; `-` when it was not exercised |
| `measured` | the raw facts (symbol-by-symbol resolution, hit sets, timings, grant states) |
| `host_build` | the host's `sw_vers` version and build, or `none (<reason>)` when no host of that major was available |
| `reason` | for `UNMEASURED`, why; for `CONTRADICTS` / `NEW-EDGE`, the consequence the design names |

## Verdict grammar

- `CONFIRMS`: the design's statement holds on that version.
- `CONTRADICTS`: it does not; the row's reason names the degrade the design prescribes (for example
  `capabilities.spaces.move:false`, `pointer_only`, the SCK-only capture path).
- `NEW-EDGE`: it holds in a shape the design did not name (for example a different exported symbol name).
- `UNMEASURED`: not measured; the reason says why. Never a pass.

## Hosts

- macOS 26 (H1): a macOS 26 host with a QA account and its graphical session. Not available yet: the host first
  named has no QA account, so every macOS 26 row reads `UNMEASURED` with the reason
  `awaiting H1: the named host has no QA account`.
- macOS 15 (H2): not available yet; every macOS 15 row reads `UNMEASURED` with the reason `awaiting H2`.

While both hosts are pending the row stays open: its happy scenario (`--verify` on the host the ledger names) has
no host to run on. When a host arrives, `--measure --out macos-spi.tsv` replaces that major's rows.
