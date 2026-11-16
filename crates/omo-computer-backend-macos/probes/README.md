# macOS spike probes

Spike instruments for the macOS backend. They ship no engine code: each spike is one Bun probe script, the shell
helpers it calls, and one ledger file that later constants cite as `cites <ledger file>:<row id>`.

## SP-T: TCC responsibility for the launcher (`probe-sp-t.ts`, ledger `macos-tcc.tsv`)

What it measures, one ledger row per question per condition:

| row id prefix | question |
|---|---|
| `charged.*` | which process `tccd` charges for the launcher: by-path `open` re-exec, `responsibility_spawnattrs_setdisclaim` spawn, a plain spawn (control); from a GUI-resident host and from an ssh child |
| `client-type.*` | which `client_type` `TCC.db` records for the grant (0 = bundle id, 1 = path), per launch path |
| `swap.*` | whether the grant survives a `generations/<cdhash>/` swap under `current`, per launch path |
| `identity-path.*` | the `identity.path` the launcher reports (`open_a` or `disclaim`) |
| `by-name-open-a.*` | with `current` and `previous` both registered, whether by-name `open -a` launches `current` |
| `rebuild.*` | whether a grant survives a rebuild signed with the same identity (same designated requirement, new cdhash) |
| `domain.*` | which launchd session the launcher lands in, from a GUI-resident host and from an ssh child |
| `prompt.*` | whether the TCC prompt appears at all for an ssh-spawned launcher (with a GUI positive control) |
| `bunshin-domain.*` | which launchd domain the bunshin agent runs in on a Mac |
| `untagged.*` | which key route a session tap sees as untagged hardware input (hypervisor keyboard in a VM, virtual HID device) |

Rows ending `.m26` run on the QA account's macOS 26 GUI session (host prerequisites H1/H3); rows ending `.m15` and
`untagged.hypervisor-vkbd` run inside a virtual machine (H2, `SPT_HOST_ROLE=h2`); `untagged.vhid` needs the virtual
HID keyboard (H4, `SPT_HW_ROUTE=vhid`). A row whose host or route does not exist yet reads `UNMEASURED` with the
reason in the `note` column; nothing is guessed.

Ledger columns: `id`, `question`, `condition`, `host`, `verdict`, `rerun`, `host_build`, `measured`, `evidence`,
`note`. The `evidence` column names the row's evidence file under the run's evidence root (`$EV`), which holds the
launcher's own report, the `tccd` log lines, and the `TCC.db` read-back.

### How the probe works

- The probe bundle is a minimal LSUIElement `omo-computer-helper.app` with the final bundle id
  `ai.sisyphuslabs.omo-computer-helper`, display name "OmO Computer Use" and `CFBundleExecutable`
  `omo-computer-engine`. It is signed with the run-local T3 identity (`sp-t-identity.sh create`: a self-signed
  code-signing certificate in a dedicated keychain file under `$CU_RUN/t3-signing/`; never the login keychain, no
  trust setting, no dialog).
- The executable reports its pid, parent, `proc_pidpath`, its responsible process
  (`responsibility_get_pid_responsible_for_pid`), `launchctl managername`, `SessionGetInfo`, and the three
  non-prompting preflights (`AXIsProcessTrusted`, `CGPreflightScreenCaptureAccess`,
  `CGPreflightListenEventAccess`). Only `--request-grant` and the `prompt.*` rows ask for a prompt; the prompt rows use
  a separate never-granted identifier (`...omo-computer-helper.sp-t-prompt`) and reset it with `tccutil` before and
  after.
- A GUI-resident host is a Bun process started by a one-shot LaunchAgent in `gui/<uid>` (`sp-t-gui-leg.sh`); an ssh
  child is the probe's own process context when the probe is started over ssh.
- `TCC.db` is read only (`sp-t-tccdb.sh`, `mode=ro`); reading it needs Full Disk Access for the reading process, and
  the system database also needs root. An unreadable database makes the `client-type.*` rows `UNMEASURED`.

### Host procedure

Run as an administrator account over ssh, with the QA account logged in to its GUI session, one run at a time.

```sh
export CU_RUN=<host-side run root, readable by the QA account>
export SPT_QA_USER=<QA account> SPT_COMMIT=<commit of this directory> SPT_BUN=<a bun the QA account can execute>
P=<this directory, staged under $CU_RUN>
bash $P/sp-t-identity.sh create                 # once per run; writes $CU_RUN/t3-signing/IDENTITY
bun $P/probe-sp-t.ts --setup                    # spawner, two generations (current, previous), the prompt probe
bun $P/probe-sp-t.ts --measure --out $P/macos-tcc.tsv   # no grant, no prompt: person rows read WAITING-PERSON
# only in a slot with a person at the QA session (SPT_PERSON_PRESENT=1):
bun $P/probe-sp-t.ts --request-grant            # H3: the dialog for "OmO Computer Use"; the person grants it
bun $P/probe-sp-t.ts --check-grant              # expects accessibility 1
bun $P/probe-sp-t.ts --measure --out $P/macos-tcc.tsv   # now also the grant and prompt rows
bun $P/probe-sp-t.ts --verify $P/macos-tcc.tsv  # from a clean shell, in the same person slot; see below
bun $P/probe-sp-t.ts --cleanup                  # receipts: procs 0, dir REMOVED; keeps the identity and the H3 grant; exit 1 on a failed receipt
```

No agent clicks a TCC grant or answers a permission prompt. The rows that need the H3 grant (`client-type.*`,
`swap.*`, `rebuild.*`), a Deny answer (`prompt.*`), or the Input Monitoring grant and a key press (`untagged.*`) read
`WAITING-PERSON` with the reason and launch nothing unless `SPT_PERSON_PRESENT=1` is set for a slot with a person at
the QA session; `--request-grant` refuses without it. In such a slot the `prompt.*` rows print an `OPERATOR:` line: a
dialog naming "OmO Computer Use SP-T prompt probe" appears in the QA session and the person answers Deny.

The `prompt.*` rows reset the prompt-probe identifier with `tccutil reset Accessibility` before and after the prompt
(as the QA account, not root). A failed reset before the prompt makes the row `UNMEASURED` with the reason and raises
no dialog; a failed reset after it is named in the note. Still unverified: whether a non-root `tccutil reset` clears
an Accessibility row held in the system `TCC.db`; the first person slot reads it back with `sp-t-tccdb.sh`.

A failed reader is never read as a negative: a `log show` or `TCC.db` read-back that exits non-zero (or a `TCC.db`
read with either database unreadable) makes the row `UNMEASURED` with the reason, a `pgrep` error is an error and not
"not running", and every other command whose output a verdict depends on fails the row with its exit code.

The leg results directory (`$CU_RUN/sp-t-work/results`) belongs to the QA account with mode 0700, because its spec
files decide what a QA-account leg runs; the probe refuses it when it is a symlink, has another owner or another
mode, and reads and writes it as the QA account. `--self-test` checks the pure classification logic and the row table
against fixed inputs on any host.

`--verify` re-measures every row of this host and compares only the verdict column. It writes its evidence to
`$EV/task-9.sp-t/<id>.verify.txt`, so the `<id>.txt` file behind the recorded verdict is never replaced:

- Without `SPT_PERSON_PRESENT=1` the person rows re-measure as `WAITING-PERSON`. That matches a ledger written
  without a person (exit 0, `VERIFY_OK`), but against a ledger that holds their measured verdicts it prints `DIFF` for
  each of them and ends `VERIFY_FAILED` (exit 1).
- With `SPT_PERSON_PRESENT=1` every row is measured again, so the `prompt.*` rows raise the Deny dialog again and the
  `untagged.*` rows wait for the key press again: run it only in a person slot. Every verdict identical gives
  `VERIFY_OK` and exit 0. The T3 identity and the H3 grant stay for the later macOS rows and are removed
at the final teardown (`sp-t-identity.sh delete`, and `tccutil reset` of the helper bundle id).

`--measure` and `--row` exit 0 when every measured row gets a verdict (`UNMEASURED` and `WAITING-PERSON` included) and 1 when any row ends in `ERROR` (an unexpected failure inside a measurement); `--measure` still writes the ledger. Every exit code comes from the probe's one `EXIT` table, and `--self-test` checks that this README and the code agree.

`--cleanup` runs every step even when one fails, and prints one receipt per step. `--cleanup` exits 0 when every receipt is clean and 1 when any receipt contains `FAILED` or `STILL PRESENT`, after it has removed everything it can.

Any single row re-measures with the command in its `rerun` column. On a host without the preconditions (for example
a Linux compute host) every mode except `--print-skeleton` exits 2 with one line naming the first missing
precondition and writes no ledger row.

## SP-M: macOS private symbols on macOS 15 and 26 (`probe-sp-m.ts`, ledger `macos-spi.tsv`)

This directory holds the spike SP-M of the computer-use v3 plan (row 6). It contains no engine code: only the probe
script `probe-sp-m.ts` and the ledger `macos-spi.tsv` it writes. A constant in a macOS crate that depends on a
ledger row cites it in a comment of the form `cites crates/omo-computer-backend-macos/probes/macos-spi.tsv:<id>@<macos>`.

### Running

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

### macOS-host checks owed

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

### Columns

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

### Verdict grammar

- `CONFIRMS`: the design's statement holds on that version.
- `CONTRADICTS`: it does not; the row's reason names the degrade the design prescribes (for example
  `capabilities.spaces.move:false`, `pointer_only`, the SCK-only capture path).
- `NEW-EDGE`: it holds in a shape the design did not name (for example a different exported symbol name).
- `UNMEASURED`: not measured; the reason says why. Never a pass.

### Hosts

- macOS 26 (H1): a macOS 26 host with a QA account and its graphical session. Not available yet: the host first
  named has no QA account, so every macOS 26 row reads `UNMEASURED` with the reason
  `awaiting H1: the named host has no QA account`.
- macOS 15 (H2): not available yet; every macOS 15 row reads `UNMEASURED` with the reason `awaiting H2`.

While both hosts are pending the row stays open: its happy scenario (`--verify` on the host the ledger names) has
no host to run on. When a host arrives, `--measure --out macos-spi.tsv` replaces that major's rows.
