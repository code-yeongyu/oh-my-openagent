# Engine probes

Spike probes for the engine. They measure, and they write a ledger. They ship no engine code, and no engine source reads them at run time. A later constant that depends on a ledger row cites it in a comment, in the form `cites crates/omo-computer-engine/probes/relay-limits.tsv:<row id>`.

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
