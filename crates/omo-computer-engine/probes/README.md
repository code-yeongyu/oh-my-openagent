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
bun crates/omo-computer-engine/probes/probe-sp-b.ts --verify crates/omo-computer-engine/probes/bunshin-hosting.tsv
bun crates/omo-computer-engine/probes/probe-sp-b.ts --row B-05c
bun crates/omo-computer-engine/probes/probe-sp-b.ts --write <ledger> [--detail <file>]
```

`--verify` measures every row again. It compares the verdict column only, because measured
numbers may differ between runs. It exits 0 when every verdict matches and writes nothing.
`--write` rewrites the ledger.

Preconditions. Each one that is missing ends the run with exit 2 and a single line naming it:

- A bunshin binary: `BUNSHIN_BIN`, or `bunshin` on `PATH`. The probe runs it with an empty
  environment and a fresh temporary `HOME`. It uses only the local `schema`, `manifest` and
  `--help` surfaces, so it never contacts a running agent, a hub or another machine.
- The local source-check file: `SPB_SOURCE_CHECKS`, else
  `$CU_RUN/evidence/task-11.bunshin-source-checks.json` (with `CU_RUN` defaulting to
  `~/omo-runs/cu-v3`). It names the bunshin checkout and the read-only `git grep` checks behind
  the `(source)` rows. Bunshin internals stay in that run-local file and the proof file the
  `evidence` column points to. Neither belongs in this repository.
- Row `B-05c` also needs Linux and passwordless `sudo`, otherwise it reads `UNMEASURED`. It runs
  `probe-sp-b-root-watch.sh`, which builds a stand-in tree (root agent, launcher, engine;
  no bunshin) and measures the kernel premise of the root-agent host-death watch. It reads
  `PR_GET_PDEATHSIG` right after the uid drop, checks that the host pidfd is in place, and times
  the teardown after `kill -9` of the agent. The live row with the real launcher (`B-05d`)
  waits for row 62.

Verdicts: `closed`, `open-with-row`, `needs-installer` and `UNMEASURED` are the ledger
grammar. A probe that finds a different state prints `CHANGED` (a source check no longer holds,
or a precondition that used to be missing is now present) or `CONTRADICTS` (a control or a
premise failed), so `--verify` fails until the row is re-measured.
