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
bun crates/omo-computer-backend-macos/probes/probe-sp-m.ts --self-test              # any host: the pure decisions
```

`--self-test` runs on any host, Linux included, and makes no native call. It prints `SELF-TEST PASS` or one
`SELF-TEST FAIL <check>` line per failed check. Each check is named `<group>: <what it proves>`; the groups are below,
and the `readme` check fails the self-test when this list and the checks in the script differ.

### Self-test checks

- `verifySummary`: `--verify` never passes when nothing was measured, prints the `unmeasured` count, fails on a diff.
- `uncoveredMajors`: the ledger grammar; a major is covered only by a `--pending` reason or a row for every question.
- `parsePending`: an empty or blank reason and an unsupported major are refused; a reason is kept.
- `spaceDecision`: the copy-spaces decision, including `unread` for a 0 Space, an empty list or an unreadable entry.
- `symbolLocation`: `yes`, `elsewhere`, `no` and `load-error`.
- `absenceOutcome`: a load error is `UNMEASURED` with the loader text; only a proven absence is `CONTRADICTS`.
- `windowFromFields`: a window-list entry with an unreadable id, layer or bounds is dropped, never defaulted.
- `frameDecision`: an unread frame is `UNMEASURED`; transparent is `CONTRADICTS`; opaque `CONFIRMS`.
- `frameAlpha`: no bytes is `unread`, all-zero alpha is `transparent`, one non-zero alpha byte is `opaque`.
- `authOffsetsOutcome`: unreadable candidates are counted and named in `measured`; a clean read shows `unreadable=0[]`.
- `scanCandidates`: over a fake address space, the sentinel record is the one hit at its position, and an unreadable
  slot and an unreadable record are both named.
- `hostOptions`: `--with-capture` turns the capture leg on; without it the leg is off.
- `hostFromParts`: the parsed option reaches the `Host` the rows read.
- `readLedger`: a file that is not an SP-M ledger is an error value.
- `cli`: `--measure` and `--verify` over such a file exit 2 with one line, no stack trace.
- `qHwCapture`: without `--with-capture` the row is `UNMEASURED`, names the flag and makes no native call.
- `readme`: this list names exactly the self-test groups.

`--pending-only` measures nothing and needs no host; it is how the ledger is written while neither host exists.

`--measure` replaces the rows of the host's own major and keeps the other major's rows (or writes them as
`UNMEASURED` with the `--pending` reason); it refuses to write anything but every question on both majors, and
refuses a `--pending` with an empty reason. `--verify` measures every row of the host's major again and exits 0 only
when the verdict column is identical on every row AND at least one row was measured (its summary prints the
`unmeasured` count); other columns may differ (rects are bucketed to 8 px, timings vary). A symbol found only in
another loaded image than the one the design names reads `elsewhere` in `measured`, not `no`, on every row that
reports a C symbol (the Objective-C class and selector of the auth-message row read `yes` / `no`). An existing `--out`
or `--verify` file that is not an SP-M ledger is refused with one line and exit 2.

A negative verdict is proven only by a returned value: a symbol is `no` (and its row `CONTRADICTS`) only when its
image loaded and `dlsym` answered null. An image that failed to load reads `load-error` and its row is `UNMEASURED`
with the `dlerror()` text. A window-list entry whose id, owner pid, layer or bounds cannot be read is dropped, never
defaulted to 0. The copy-spaces row is `UNMEASURED` when the display Space reads as 0, when the window's Space
list cannot be built or comes back empty, or when an entry cannot be read and no readable entry matches. The
`hwcapture` row is `UNMEASURED` when a frame comes back but its pixel data cannot be read; it is never recorded as
fully transparent.

One exception is fail-closed by design: in `auth-offsets`, a candidate pointer (24 / 32 / 16) that cannot be read
counts as a failed candidate, because the design prescribes an engine self-check that degrades to `pointer_only` in
the same case (no engine implements that self-check yet). Such a row
can read `CONTRADICTS`; its `measured` column names the unreadable candidates as `unreadable=<count>[<offsets>]`, so
it is never confused with a clean read that found no sentinel (`unreadable=0[]`).

By default the probe raises no dialog, posts no input, moves no window and adds no Space. A question that needs one of
those, a grant the host does not have, or a fixture a later row builds is recorded `UNMEASURED` with the reason. The
one exception is opt-in: `--with-capture` (with `--measure`, `--verify` or `--row`) runs the `hwcapture` leg, a legacy
window capture that may raise the macOS 15.1+ capture reminder on a host holding the Screen Recording grant; without
the flag that row is `UNMEASURED` and the probe makes no capture call.

## macOS-host checks owed

The self-test runs the probe's decisions on Linux through pure seams (`hostFromParts`, `frameAlpha`,
`scanCandidates`). The thin glue that feeds them from macOS calls cannot run here, so a mutation in it survives the
self-test. Each one is owed a check on the first macOS 15 or 26 GUI run:

- `buildHost`: passes `precondition()`, `sessionFacts()` and `hostOptions(args)` to `hostFromParts`; owed: `--session`
  and `--row hwcapture` with and without `--with-capture` on the host, the row `UNMEASURED` without the flag.
- `qHwCapture` frame bytes: the `CGImageGetDataProvider` / `CGDataProviderCopyData` / `CFDataGetBytePtr` chain that
  hands `frameAlpha` its bytes (or null); owed: one `--with-capture` capture of a known opaque window reading
  `non-transparent`.
- `qAuthOffsets` reads: the event built from the combined-session source and `safeRead` (`mach_vm_read_overwrite`)
  handed to `scanCandidates`; owed: one `--row auth-offsets` run reading `unreadable=0[]` and exactly one hit.

DEFERRED: these three checks are owed to the first run on H1 (macOS 26) or H2 (macOS 15); until then they are not
proven.

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
