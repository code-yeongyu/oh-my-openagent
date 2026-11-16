# Engine probes

Spike ledgers for the remote hand. Spikes ship no engine code. The only outputs are the probe
script and the ledger file. Every later constant that depends on a ledger row cites it in a
comment of the form `cites <ledger file>:<row id>`.

## SP-B: bunshin hosting gaps (`bunshin-hosting.tsv`)

`probe-sp-b.ts` classifies each of the ten bunshin hosting gaps the contract lists (persistent
session, input tier, fleet stop/resume, image artifact type, root agent without a display, no
Windows service, TCC on the agent, capability advert, sidecar audit, MCP) as `closed`,
`open-with-row` or `needs-installer`. It writes one row per measured condition. A condition
this host cannot measure reads `UNMEASURED`, and its `owner` column names the host that owes
it (`host H1`, `host H6`) or the row that has to build it first.

```sh
bun crates/omo-computer-engine/probes/probe-sp-b.ts --verify crates/omo-computer-engine/probes/bunshin-hosting.tsv [--allow-sudo]
bun crates/omo-computer-engine/probes/probe-sp-b.ts --verify <ledger> --row <id>
bun crates/omo-computer-engine/probes/probe-sp-b.ts --row <id> [--allow-sudo]
bun crates/omo-computer-engine/probes/probe-sp-b.ts --write <ledger> [--row <id>] [--allow-sudo] [--detail <file>]
```

Modes and their combinations:

- `--verify <ledger>` measures every row again and compares only the verdict column, because
  measured numbers may differ between runs. It exits 0 when every verdict matches, exits 1 on
  a mismatch, and never writes. Every ledger row must be measured, so a ledger row the probe no
  longer has is a mismatch.
- `--verify <ledger> --row <id>` measures and compares that one row only. The other ledger rows
  are not checked. For a root-leg row without `--allow-sudo` it would check nothing, so it exits 2
  and says so.
- `--row <id>` alone measures one row and prints it.
- `--write <ledger>` measures every row and regenerates the ledger from this run's measurements,
  so a row the probe no longer has is dropped. The only lines carried over from the existing ledger
  are the root-leg rows this run did not measure (`B-05c` and `B-05e` without `--allow-sudo`),
  byte for byte, and only if the existing ledger parses. A missing or malformed existing ledger
  does not block the write: the ledger is regenerated, and a malformed one draws a warning that
  its root rows could not be carried.
- `--write <ledger> --row <id>` measures one row and replaces (or adds) only that row. Every other
  row of the existing ledger is kept as it is, so the ledger must already exist and parse.
- `--verify` and `--write` cannot be combined.

Each source row's expected verdict is in `probe-sp-b.ts`, so the repository can falsify a row.
The local check file holds only the search patterns. A source row whose checks no longer hold
reads `CHANGED`, and `--verify` fails on it.

Preconditions. Each one that is missing ends the run with exit 2 and a single line naming it:

- A bunshin binary: `BUNSHIN_BIN`, or `bunshin` on `PATH`. The probe runs it with an empty
  environment and a fresh temporary `HOME`. It uses only the local `schema`, `manifest` and
  `--help` surfaces, so it never contacts a running agent, a hub or another machine.
- The local source-check file: `SPB_SOURCE_CHECKS`, else
  `$CU_RUN/evidence/task-11.bunshin-source-checks.json` (with `CU_RUN` defaulting to
  `~/omo-runs/cu-v3`). It names the bunshin checkout and the search patterns for the read-only
  `git grep` checks behind the `(source)` rows. Bunshin internals stay in that run-local file
  and in the proof file the `evidence` column points to. Neither belongs in this repository.
- With `--allow-sudo` only: Linux, passwordless `sudo`, and `python3` as root.
- The ledger that `--verify`, or `--write --row`, has to read.

The source-check file is validated before anything is measured. It needs an entry for every
`(source)` row. Each entry needs at least one check, and each check needs a `kind` of `present`
or `absent`, a non-empty `pattern`, and a `paths` list (an empty list searches the whole
checkout). `bunshinSrc` must be a non-empty path to an existing git checkout that is not this
repository. A file that fails any of this exits 2 with one line naming the file and the reason.

The root leg (rows `B-05c` and `B-05e`) runs root code, so it runs only with `--allow-sudo`.
Without the flag both rows read `UNMEASURED` with the reason. `--verify` reports them as
`NOT-RUN`: they are not counted as a match, and the summary line names how many did not run.
With the flag the probe runs `probe-sp-b-root-watch.sh` through `sudo -n`. The helper builds a
stand-in tree (root agent, launcher, engine; no bunshin), drops the launcher to your uid,
SIGKILLs the agent, and reports how the launcher ended and how fast. Each leg leaves exactly
one host-death watch live, so the mechanism is measured, not inferred:

- `B-05c`: the pidfd watch alone. The parent-death signal stays cleared by the uid drop, so
  the launcher passes only if it ends by its own `exit 137`.
- `B-05e`: the parent-death signal re-armed after the drop, with no pidfd poll. The launcher
  passes only if it ends by `signal 9`.

The stand-ins run in their own process group. Every failure exit of the helper prints its
reason first and then kills that whole group, so a timeout or an early exit leaves no stand-in
behind. The helper's engine reports ready only after it has armed its own parent-death signal and
checked that the launcher is still its parent, so a launcher that dies early can't leak an
engine. Running the helper directly with mode `none` gives the negative control: no watch, so
the launcher is still alive after the 2 s window and the helper kills it. The live row with the
real launcher (`B-05d`) waits for row 62.

Errors are never verdicts. A row whose measurement throws (for example a failed `git grep`)
reads `UNMEASURED` with the error text. A root leg whose helper fails reads `UNMEASURED` with its exit code and stderr:
no parseable report, exit 4 (the stand-in never reported ready), exit 5 (`pidfd_open`
unavailable), or any other code such as a traceback or a timeout. The same holds for a report
of the wrong mode, and for a pidfd leg whose launcher had no pidfd. Only a parsed report of the
right mode can read `CONTRADICTS`. A source-check file that is missing, unreadable,
empty, not JSON or without `bunshinSrc`/`rows` ends the run with one exit-2 line that names
the file and the reason.

Verdicts: `closed`, `open-with-row`, `needs-installer` and `UNMEASURED` are the ledger
grammar. A probe that finds a different state prints `CHANGED` (a source check no longer holds,
or a precondition that used to be missing is now present) or `CONTRADICTS` (a control or a
premise failed), so `--verify` fails until the row is re-measured.

## SP-R: relay and same-network pipe limits

- `probe-sp-r.ts` is the probe, a Bun script.
- `relay-limits.tsv` is the ledger it writes. The file is tab-separated, with the header `id pipe question measured verdict rerun host_build note`.
  - `verdict` takes one of `CONFIRMS`, `CONTRADICTS`, `NEW-EDGE` or `UNMEASURED`.
  - `CONFIRMS` and `CONTRADICTS` are read against the design's assumption that the row names, including the 5 / 15 / 120 s liveness windows.
  - `NEW-EDGE` records a limit the design did not state.
  - `UNMEASURED` gives its reason in `note` and is never a guess.

### Running it

```sh
CI=true SP_R_RELAY_CHECKOUT=<relay checkout> bun crates/omo-computer-engine/probes/probe-sp-r.ts --write  crates/omo-computer-engine/probes/relay-limits.tsv
CI=true SP_R_RELAY_CHECKOUT=<relay checkout> bun crates/omo-computer-engine/probes/probe-sp-r.ts --verify crates/omo-computer-engine/probes/relay-limits.tsv [--only <id,id>]
```

- `--verify` measures every row again. It exits 0 only when every verdict matches the ledger, and it writes nothing. The measured numbers may differ between runs.
- A measurement that fails (a probe error, a socket that never opens, a helper that returns nothing, a close the row did not expect) is recorded as `UNMEASURED` with its reason. `--verify` never counts such a result as a match, even against an `UNMEASURED` ledger row.
- `bun crates/omo-computer-engine/probes/probe-sp-r.ts --self-test` checks every verdict rule by class, without a relay or a pair. It also runs `probe-sp-r-pair-selftest.sh` (Linux or macOS; needs `bun` and `lsof`).

### Preconditions

`SP_R_RELAY_CHECKOUT` names a checkout of the relay that has its dependencies installed.
- The probe starts a local relay from that checkout's own local test harness (the local Workers runtime) and stops it again when it exits.
- It mints every credential itself, signed by a key generated for the run and served on loopback.
- It uses no account, no hosted relay and no model.

Run it on a Linux host, inside a container or with `CI=true`; this is the harness's own host rule. When a precondition is missing, the probe exits 2 with one line naming it and writes no ledger row.

### What the relay rows cover

| Rows | What they cover |
| --- | --- |
| R-AUTH-* | Authentication lifetime: when the hub is awake, across one hub hibernation, at dial time, and for a refresh after a hibernation, both with and without in-band re-proof. |
| R-HIB-* | Hub hibernation: when it starts, whether the channel survives one hibernation and the first heartbeat after the wake, delivery of a command, and how long the channel lives with a keepalive and without one. |
| R-SIZE-* | Message size: the per-class payload cap, and the cap on one transport message. |
| R-LIVE-* | Whether the 5 / 15 / 120 s liveness windows hold across one hibernation. |

These rows measure a local relay, and the hibernation onset is the local runtime's. The hosted runtime's numbers are not part of this ledger.

### Same-network pair and the hosted relay

`probe-sp-r-pair.sh` is a helper that the probe sends to each host of a same-network pair. `SP_R_PAIR_A` and `SP_R_PAIR_B` are each a command prefix that runs one command on one host and keeps its arguments as given; the probe checks that first and refuses a prefix that joins them (as `ssh` does).

The helper is read-only. In `state` mode it first starts a listener of its own on loopback and on all interfaces, and requires `lsof` to show both. Only then does it read the device service: its version, whether `lsof` can see it at all, and whether it listens off loopback or holds discovery sockets. If `lsof` is missing, silent, erroring or blind to the device service, the helper exits 2 and the row is `UNMEASURED`; it never reports a zero it could not see.

In `silent` mode it opens one unauthenticated socket to the hosted relay named by `SP_R_HOSTED_RELAY` (`wss://<host>`), sends nothing, and records when and how the relay closes it.

The helper refuses to run when the host's 1-minute load is at or above its core count. Its temp dir and its control listener are removed on every exit path, and nothing stays resident.

- `L-STATE-A` and `L-STATE-B` record that the shipped device service has no same-network direct path.
- `R-HOSTED-1-A` and `R-HOSTED-1-B` compare the hosted relay's deadline with the local one.
- `R-HOSTED-2` (a silent admitted channel on the hosted relay) and the other L-* rows stay `UNMEASURED`, each with its reason.
