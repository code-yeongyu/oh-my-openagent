# omo daemon - engine hosts per session

Every OmO session that runs task children as host sessions gets its own senpi RPC host.
A terminal session's `process` children run on a task host keyed by that session
(`p-*`), and each Desktop interactive thread runs on its own thread host (`i-*`).
A crash, an idle exit, or a handoff on one of those hosts does not touch the others.
The socket `rpc.sock` stays as the operator endpoint: `omo daemon run` ensures it, and
`thread_create` opens its sessions there. A terminal session runs its own session in its own
process and never joins a host; other sessions reach it through its control endpoint (see
[omo thread](./omo-thread.md)), and `omo daemon adopt` moves a session a host holds into a
terminal.
`omo daemon` is the operator's view of every one of these hosts in one agent directory.
Everything that decides *who serves a socket* lives in the engine (`senpi host`);
this command supplies omo's launch spec, reads the policy out of the omo config, and
turns the engine's answer into an exit code a script can branch on.

```bash
omo daemon run                 # ensure the operator daemon on rpc.sock: start, reuse, or hand off
omo daemon run --json          # the engine's JSON line verbatim
omo daemon adopt <session> [--interrupt] [--force]   # take a host session into this terminal
omo daemon status [--json] [--include-workers]   # every endpoint, then a machine aggregate
omo daemon gc [--json] [--prune-store-index]     # remove dead endpoint state and its owner sidecars
omo daemon stop [--drain]      # the operator endpoint only
omo daemon stop --all          # every discovered endpoint
omo daemon stop --drain --all --wait --timeout 600
omo daemon handoff             # upgrade-gated handoff across every live endpoint
omo daemon rollback-prepare [--store <dir>]... [--allow-missing-index] [--dry-run] [--json]
```

Bare `omo` never ensures the operator daemon on `rpc.sock`. Only `run` and `handoff` can
bring it into existence (per-session hosts are started by the task
engine ahead of a session's first child: on its first prompt by default, at session start or
only at the first spawn per `task.host_shard_prewarm`, never by bare `omo` itself); `status`, `gc` and `stop` work on an install whose plugin payload was
never built. `--persistent` is still accepted and does nothing; `--foreground` exits 2,
because the engine host always detaches. There is no `attach` subcommand any more: a terminal
no longer runs its session on a host, so to continue a host session in a terminal, adopt it.

## Per-session hosts

**Naming.** A task host listens on `<shardRoot>/p-<key>.sock`, where `key` is the first
16 hexadecimal characters of `sha256("p:" + sessionId)` for the session that roots the
tree. A Desktop thread host uses the same rule with kind `i` and the thread id:
`<shardRoot>/i-<sha256("i:" + threadId)[:16]>.sock`. The shard root is
`OMO_RPC_SHARD_ROOT` when it is set, else `<agentDir>/rpc/shards`. When the socket, or
the successor and close-shield names a host binds beside it (`.next-<generation>`,
`.shield-<pid>`), would not fit the platform's 103-byte socket path limit, the same
basename goes under the alternate root `/tmp/omo-rpc-<sha256(agentDir)[:8]>` (created
`0700`, refused unless it is a real directory the current user owns with no group or
other permissions), and the session gets a `host_notice:shard_alt_root` notice. A socket is never
truncated and never moved to a different endpoint. `senpi host shard-path --kind <p|i>
--owner <id>` prints the same path without contacting any host.

**How children pick their host.** A session outside any host (a terminal parent, a
per-child-process child, a Desktop thread) is the root of its own tree: its children
go to `p-<its own key>`. Each child a host session opens carries its tree's key in its
session context as `tree_key` and `shard_key`. When that child spawns children of its
own, it reads `shard_key` and puts them on the host it already lives on. It may only
connect to that host: it never ensures, starts, or hands it off, and a silent host is
`own_host_unreachable`. A child is never routed on a guess. With no session id at
routing time the spawn fails with `shard_identity_missing`.

**`OMO_RPC_SOCKET*` never route task children.** `OMO_RPC_SOCKET`, `SENPI_RPC_SOCKET`,
`PI_RPC_SOCKET` and `OMO_RPC_SOCKET_PATH` name the operator endpoint only. `omo daemon`
and the thread tools read them; the task host resolver does not. A process whose
environment names another operator socket therefore still puts its own task children on
its own `p-*` host, keyed by its own session id, not on that socket.

**Owner sidecar.** Starting a `p-*` or `i-*` host writes `<kind>-<key>.meta.json` beside
the socket: `{ socket, kind, root, owner_session_id?, owner_session_file?, created_at,
created_by_pid, notice?, stores }`, where `stores` lists the task stores that opened
children there. The sidecar is informational. The authoritative list of stores is the
agent-dir store index `<agentDir>/rpc/task-stores.json`, which gc does not touch.

**Per-endpoint state and logs.** Each socket has its own state directory
`<agentDir>/rpc-host-daemon/<sha256(socket)[:16]>/`, where `socket` is the canonical path
(directory resolved through its deepest existing ancestor). It holds `endpoint.json`,
the endpoint's `stderr.log`, and `crashes.jsonl` (supervised host children that died
rather than stopped). A supervisor that exits removes its generation's files but
leaves these three, so an endpoint that crashed or idled out is still listed.

**Idle exit and session eviction.** A host exits after 15 minutes with no attached
connection and no running turn (`tunables.idleExitMs: 900000` in the launch spec;
`task.host_idle_exit_ms` overrides it per install). senpi's own default for evicting an
idle retained session is 30 minutes, but OmO's launch path sets
`SENPI_RPC_SESSION_IDLE_EVICTION_MS` to the idle-exit window, so both are 15 minutes by
default. A longer inherited eviction window is kept. The trade-off, measured in the cost
section below: a departed parent's own host idles out even when other clients stay
connected elsewhere, while the previous release's single host, kept alive by any other
client, used to keep the departed parent's retained sessions for the whole eviction window.

**Memory pressure is observability only.** Every host samples and reports its own
memory. `status` shows `rss_mb` (the endpoint's whole process tree) and `host_rss_mb`
(supervisor and host only) per endpoint and per generation. The engine never refuses a
session because of memory, and pressure on one endpoint never gates another.

**`status`, `status --json`, `gc`, `handoff`, `stop --all`.** `status` runs one
read-only engine sweep (`senpi host status --all --include-workers`), joins each shard
row with its sidecar, prints one row per endpoint (operator daemon, `shard p-<key>
(parent <id prefix>, <session file>)`, `thread i-<key>`, or `endpoint <name>`), one line
per generation when a handoff left more than one alive, and ends with the machine
aggregate. `omo doctor` prints the same rows as `INFO` lines and a dead row as a
`WARN` that points at `omo daemon gc`. `--json` returns the engine rows unchanged plus
`owner` (the sidecar) and an `aggregate`:

```json
{
  "endpoints": [
    {
      "socket": "/tmp/example/rpc/shards/p-0123456789abcdef.sock",
      "shard": { "kind": "p", "key": "0123456789abcdef" },
      "owner": { "owner_session_id": "session-id" },
      "rss_mb": 120,
      "host_rss_mb": 88,
      "generations": []
    }
  ],
  "aggregate": {
    "live": 1,
    "terminals": 0,
    "shards": 1,
    "threads": 0,
    "sessions": 2,
    "rss_mb": 120,
    "host_rss_mb": 88,
    "crashes": 0
  }
}
```

`aggregate.live` counts reachable hosts only. `aggregate.terminals` counts reachable terminal
(`endpoint_kind: "tui"`) endpoints; they are listed in `endpoints` but never counted in `live`,
`shards`, `threads`, `sessions` or the RSS totals, because a terminal is not a host.

`status` never prunes, signals, unlinks, or refreshes an idle host. A dead row is kept
until `omo daemon gc` asks the engine (`senpi host gc`) to remove it. The engine removes
an endpoint only under its ensure lock, and only when no generation pid is alive, no
session-path claim has a live owner, and the socket refuses connections. Only after the
engine reports an endpoint removed does OmO delete its owner sidecar. Everything else is
kept with a reason: `live_generation`, `live_claim`, `reachable`, `locked`,
`legacy_layout`, `unknown_identity`, or `failed`. An `unknown_identity` row has
`socket: null`: nothing in its directory names the socket, so its lock cannot be taken
and gc never removes it. Remove such a directory by hand only after checking that no
pid named in its `generations/*/host.pid` or `reservations/*.json` is running and that
no process still holds a file under it (`lsof +D <dir>` prints nothing; `lsof -U` lists
the unix sockets processes still hold). The store index survives ordinary gc; only
`gc --prune-store-index` drops entries whose store directory no longer exists.

`handoff` walks every live endpoint through the engine's upgrade gate: `rpc.sock`
through `senpi host handoff`, every other endpoint through `senpi host ensure --policy
upgrade --socket <socket>`, so an older client can never replace a newer host.
`stop --all` applies the engine's stop rules to every endpoint that is reachable, has a
live generation, or holds a live claim.

**An omo update hands off each session's own host.** A session's first ensure after an
update meets its own `p-*` host running the older build and, under the default
`upgrade` policy, hands that host off to the new build. With N live session hosts that
is N successor spawns, one per host as each session next ensures it, instead of the
single handoff the previous release's one host needed.

**Older clients see only `rpc.sock`.** An `omo daemon status` from before per-session
hosts asks for the single socket `rpc.sock`, and so does an older Desktop. Neither
lists `p-*` or `i-*` hosts, and neither can stop or reap them.

### What it costs (measured)

One sharded endpoint costs the same as today's shared daemon when idle; what grows is
the count. Each session with host children keeps its own supervisor and host, so memory
scales with the number of busy sessions. Nothing caps it: there is no limit on hosts,
children, or memory.

Measured on an Apple M-series 14-core machine with 64 GB, under load from other work,
with engine senpi 2026.9.28-3, against the previous release, which ran every session's
children on one host (20 samples per latency scenario):

| Idle endpoint (0 sessions) | RSS MB | Physical footprint MB |
| --- | --- | --- |
| One task host (supervisor + host) | 245.4 | 126.2 |
| Previous release's one host (supervisor + host) | 248.6 | 137.3 |

| Parents, 4 children each | Per-session hosts RSS / footprint MB | One host for all RSS / footprint MB |
| --- | --- | --- |
| 1 | 620.7 / 203.8 | 666.6 / 228.6 |
| 2 | 1353.7 / 432.5 | 753.7 / 255.3 |
| 4 | 2699.2 / 808.0 | 778.6 / 242.1 |

That is the price of isolation: with 4 parents x 4 children, per-session hosts use
2.7 GB RSS and 0.8 GB physical footprint, against 0.78 GB and 0.24 GB for one shared
host. Judge idle memory on physical footprint, not on RSS: RSS counts the roughly 65 MB
of clean, file-backed pages that the supervisor and the host both map (the compiled
binary and shared system libraries) once in each process. On one host, the first
child's turn added 408.7 MB RSS and 45.6 MB footprint, and the host reached 544 MB RSS
at 4 children.

| Latency (ms) | p50 | p95 |
| --- | --- | --- |
| First child on a cold host | 2222 | 7484 |
| First turn on a warm host | 1237 | 1451 |
| Session start on a warm host | 1163 | 1347 |
| Reattach after a host crash | 1701 | 4145 |
| Ensure, 1 live host | 1149 | 1377 |
| Ensure, 4 live hosts | 2262 | 3805 |

Idle exit: with no client left, every endpoint was gone 16 minutes later in both
configurations. With one parent still connected and two departed, both departed
parents' hosts were gone by then while the live parent kept its own. The previous
release's one host stayed up for the live parent: it held 0 retained sessions under the default eviction
window and 4 under a 1-hour window. The per-session configuration also used less
memory in both cases (237.5 against 279.7 MB RSS by default, 235.7 against 263.9 MB
with the 1-hour window).

Reproduce with the QA driver (about 35 minutes; it runs in a sandbox agent dir and
leaves the real one untouched):

```bash
node packages/omo-senpi/scripts/qa/task-host-e2e-shard-cost.mjs \
  --bin <omo binary with per-session hosts> \
  --before-bin <omo binary of the previous release> \
  --out <evidence dir>
```

## Where it lives

| What | Where |
| --- | --- |
| Operator socket | `<agentDir>/rpc/rpc.sock` (the canonical agent dir, see `omo doctor`) |
| Session hosts | `<shardRoot>/{p,i}-<key>.sock`; `<shardRoot>` is `OMO_RPC_SHARD_ROOT` or `<agentDir>/rpc/shards`, else the short alternate root above |
| Host owner sidecar | Beside a session host socket as `{p,i}-<key>.meta.json` |
| Task store index | `<agentDir>/rpc/task-stores.json` |
| Host state | `<agentDir>/rpc-host-daemon/<sha256(socket)[:16]>/` |
| Endpoint log | `<host-state>/stderr.log` |
| Crash records | `<host-state>/crashes.jsonl` (newest 50 counted by status) |
| Launch spec | `<pluginRoot>/daemon-launch-spec.json`, shipped inside the omo plugin payload |
| Operator endpoint override | `OMO_RPC_SOCKET=<socket>` (read by `omo daemon` and the thread tools; task children ignore it) |

## Launch spec

The spec is the **only** argv source for every host OmO starts: `omo daemon run`, a
child-triggered ensure and the desktop server all read the same file, so they
cannot drift from one another. It is a small JSON document:

```json
{
  "spec_version": 1,
  "core": { "session_runtime": "in-process", "multi_session": true, "extensions": [".", "..."] },
  "tunables": { "idleExitMs": 900000, "coldStart": "transient" },
  "env": { }
}
```

Trust rules match the engine's own: a group- or world-writable spec, or one whose
path contains `..`, is refused before anything is started. Edit the spec by
rebuilding the plugin, not by hand.

## Policy and configuration (`~/.omo/omo.jsonc`)

`task.host_engine_policy` and `task.host_idle_exit_ms` are read through the omo config
loader, like every other `task.*` key: `~/.omo/omo.jsonc` (or `~/.omo/omo.json`, comments
allowed) plus the project `.omo` layers, nearest project last. The agent-dir file
(`~/.omo/agent/omo.json`) is deprecated: it still supplies either key when no config layer
sets it, and `omo doctor` then prints one `WARN task.<key>: read from deprecated <path>`
line per key with the move to make. A legacy `"never"` policy is told to use
`--no-upgrade` instead, because the config key accepts only `upgrade` or `fallback`.

| Key | Values | Meaning |
| --- | --- | --- |
| `task.host_engine_policy` | `upgrade` (default) · `fallback` | what `run` may do when a host from another build already serves the socket |
| `task.host_idle_exit_ms` | milliseconds | a host exits after this long with no sessions (default 15 minutes, from the launch spec) |
| `task.host_shard_prewarm` | `first-turn` (default) · `session-start` · `off` | when to warm this session's derived task host; resumed sessions with suspended host children always warm their recorded hosts |
| `task.default_execution_mode` | `auto` · `in-process` · `process` | see *Execution mode* below |
| `task.process_runner` | `host` · `child-process` | which runner a `process` child gets |

`--no-upgrade` on the command line forces `never` (reuse or start, never hand off)
for that call; `never` is a command-line policy only, not an `omo.json` value. A flag
beats config; config beats the default.

### Generations and handoff

Every build carries an ordinal (`<calver>+<build epoch>.<sha>`) and a launch
profile id. With `upgrade`, a newer build that finds an older host serving the
socket asks it to **hand off**: the old generation drains, the new one takes the
socket, live sessions keep their transcripts (the same session path, more lines,
never fewer) and the old process exits. Two builds whose ordinals cannot be
compared — different launch profiles, or an ordinal the host does not report —
never hand off; the newer side reuses or refuses, and says why.

`omo daemon handoff` applies that same gate independently. The operator endpoint
uses `host handoff`; every other discovered endpoint uses
`host ensure --policy <policy> --socket <socket>`, where `<policy>` is
`task.host_engine_policy` (default `upgrade`) or `never` under `--no-upgrade`. An
older client therefore cannot replace a newer host.

## Migration

Nothing needs converting when you update. Task children recorded on `rpc.sock` by the
previous release keep living there: they reattach and revive only on the socket their
record names, until they finish or are reaped. Every new child goes to its session's
own host. `rpc.sock` stays the operator endpoint and the endpoint the thread tools
create sessions on; the thread tools list the sessions of every endpoint. Desktop
threads move to their own `i-*` hosts with the Desktop release that adopts this
contract, not with the omo update.

## Rollback

Roll back only to **R0**, the omo release immediately before per-session hosts. R0
is the oldest release with the reopen continuation fix (#9027, commit `ebd01f84e`): a
child interrupted mid-turn continues that turn after the downgrade. A release older
than R0 reopens the child's transcript but never continues the interrupted turn, so
rolling back past R0 is unsupported.

Install R0 only on a quiesced machine. R0 reopens every session through `rpc.sock`,
while a per-session host may still hold, and still write, the same session file; path
reservations are per endpoint, so nothing stops two hosts writing one transcript. A
`drained` answer alone authorizes nothing: a drain request (`senpi host stop --drain`,
or `omo daemon stop --drain --all` without `--wait`, which prints
`requested (not awaited)`) sends the drain signal and returns at once, while the host
may keep working for minutes. Follow these steps in order:

1. **Quit every omo terminal session and the Desktop app.** `ps -ax -o pid,command |
   grep '[o]mo'` must show no interactive `omo` session and no Desktop server; the
   remaining lines are host supervisors and hosts, which step 2 stops.
2. **Drain every endpoint and wait:** `omo daemon stop --drain --all --wait --timeout
   600`, and require exit 0. It waits until every generation of every endpoint is
   `alive: false` and every endpoint's `claims_live` is 0. Reachability is not
   evidence: a draining host refuses new connections while it still owns work. A
   non-zero exit (`TIMEOUT: still live`) means a host is still writing: wait, or stop
   the process that owns it, and repeat this step. Never downgrade past it.
3. **Confirm nothing answers:** `omo daemon status --json` must report
   `aggregate.live` 0 (the command exits 3 when no endpoint answers).
4. **Still on this release, run `omo daemon rollback-prepare` and require exit 0.** It
   finds every task store from the agent-dir store index, the sidecars, and each
   `--store <dir>`, refuses if any recorded endpoint is still live, and rewrites every
   retained child's record from its `p-*`/`i-*` socket to `rpc.sock` through the locked
   task-store path (one `host_session_migrated` event each). Task records live in one store per
   project: `<agent dir>/projects/<folder>-<path hash>/senpi-task`, a project's older
   `.omo/senpi-task` directory, or a custom `task.state_dir`, so every such store must be covered. Its last line must say
   `endpoints without a store map: none`. It refuses with exit 3 when the store index
   is missing or unreadable while shard state exists: then pass `--store <dir>` for
   every project that ran task children (a complete list), or `--allow-missing-index`
   only after confirming that no project has retained children. `--dry-run` prints the
   same plan without writing. This step must run before the downgrade because R0
   knows nothing about per-session hosts: its revival probes the socket a record names,
   and a child still recorded on a `p-*` socket would stay parked `daemon_unavailable`
   forever. Then run `omo daemon gc` and check that it reports the dead endpoints
   reaped.
5. **Only then install R0.**
6. **Start R0 and resume.** Run `omo daemon run` (or let the first spawn ensure the
   daemon) and resume the parent sessions. Their retained children revive through
   `rpc.sock` from their transcripts, and a child that was mid-turn gets its one
   continuation.

Desktop threads have no task record to rewrite: the previous Desktop release opens
every thread on the default endpoint, whose host step 2 stopped, and the thread
transcripts stay on disk.

## Pre-warm

When a session resumes with suspended host-session children, each distinct recorded
socket is ensured at `session_start`, so the host boots while the reconcile scans the
records. This revival pre-warm is always on, warms only the hosts of the children that
reconcile will revive, and never warms the session's own endpoint. It does nothing when
`resume_children` or `reattach_on_reconcile` is off.

A session's own task host is warmed before its first child by default, so the first
child does not wait for a host to boot. `task.host_shard_prewarm` picks when:

- `first-turn` (default): on the session's first prompt (`input`, or
  `before_agent_start` for a turn that skips it), so the boot overlaps the first model
  call. A session that is opened and never prompted starts no host. A session running
  inside a Desktop thread host (an `i-*` endpoint) warms on its first delegation intent
  instead: the moment the model starts streaming a `task` or `task_send` call, before
  its arguments arrive.
- `session-start`: at `session_start`, also for sessions that never prompt.
- `off`: the host boots at the first `process` child, as before.

Warming is admitted like a spawn: the session's task store is registered in the
agent-dir store index (`rpc/task-stores.json`) first, and when that fails nothing is
ensured or warmed and nothing is reported (the first spawn fails
`store_index_unavailable` on its own). Then two fire-and-forget steps: the
execution-mode gate ensures the session's host (`warm()`: a success is kept exactly as
the first spawn's `ensure()` would keep it; a failure is only logged and settles
nothing, so the first spawn asks again and reports its own `host_unavailable:*`
notice), then the host's `warm` command loads what a child's session needs (the
extension graph and the runtimes a `worker`/`child` session loads) without opening a
session. A host pays for its first session (the extensions compile and the task runtime
loads there): without it a pre-warmed host's first child still waited about 0.2-0.3 s
longer than the same child on an already-used host. The warm carries the `child` role,
a private temp state directory that is removed afterwards, and the `host_warmup`
context key; it holds no session, so the host's idle exit is unaffected. An engine from
before the `warm` command (or a host that cannot warm) gets one throwaway child-shaped
session instead, opened and closed at once and never retained. A failure of either is
logged and changes nothing for the first child.

Measured on the compiled binary (a fresh session, its first turn, a mock model answering
after 1-3 s with a `task` call; time from the parent's `task` call to the child's first
model request; 60 samples per configuration over two runs, interleaved with a control on
the previous release's one host, already running):

| configuration | p50 | p95 |
| --- | --- | --- |
| `off` (host boots at the first child; 20 samples) | 1666 ms | 3280 ms |
| `first-turn` (default) | 1116 ms | 1678 ms |
| `session-start` | 1115 ms | 1648 ms |
| previous release, its one host already running | 979 ms | 1593 ms |

The pre-warm removes the host boot from the first child's wait; what remains, about
0.1 s at p50, is the new host's first turn. `first-turn` is the default because it
matches `session-start` on latency and starts no host for a session that is never
prompted. A pre-warmed host of a session that never spawns a child costs 169 MB of
physical footprint (`first-turn`; 201 MB for `session-start`) until its idle exit.

Pre-warm runs only for the POSIX `host` runner, at most once per session id, only for
the root of a session tree (a child session is already served by its tree's host), never
when `task.default_execution_mode` is `in-process`, and never blocks the session or a
turn. It does not run on Windows: task children there run in-process or as their own
processes, never on a task host, so there is nothing to warm (the named-pipe host serves
Desktop threads, which open their own host).

There is no warm spare host. A host's socket is derived from the session that owns it,
so a spare started before the session exists could not be adopted by it, and it would
cost an idle host's memory (126.2 MB footprint as measured above) until its own idle exit.

## Desktop

The Desktop implements the same contract for its threads:

- Each interactive thread runs on its own host `<shardRoot>/i-<key>.sock`, named with
  senpi's `shardSocketPath` (`kind: "i"`, the thread id as owner). The thread's own task
  children run on the `p-*` host keyed by the thread's session id, like a terminal
  parent's.
- `senpi host status --all` and `senpi host gc` are the only ways to enumerate and to
  reap hosts; the Desktop keeps asking the engine CLI (`host ensure/status/stop`) and
  never signals or supervises a host itself.
- A thread host's sidecar has the shape above; a sidecar the Desktop writes carries
  `stores: []`, and omo upgrades it in place when a task store registers.
- The status fields `shard`, `crashes` and `session_rows` are additive: a decoder that
  does not know them ignores them.
- Thread hosts use the same idle-exit tunables: the launch spec's `idleExitMs` and
  `task.host_idle_exit_ms`.
- The draft pre-warm warms the thread's own host.
- Crash notices reach the thread through `ui.notify`: a host-attached session forwards
  them as `notify` UI requests, which the Desktop renders as thread rows.

## Execution mode: what `auto` does

With `task.default_execution_mode: auto` the parent session resolves the mode
**once**, at its first ensure of its own task host:

- the host is reachable and advertises what `auto` needs (session kind/context,
  retain-on-disconnect, the host protocol) → children run as **sessions in that
  host** (`process` mode, `host` runner);
- otherwise → **in-process**, exactly as before.

An unresolved `auto` reads as in-process, so no child is ever routed on a guess.
A user-set `in-process` / `process`, and every per-agent `execution_mode`, still
wins over the host check. Real fallbacks to a per-child process happen only for
a capability or policy `engine_mismatch`, on win32, or on a Node without bun.

## Adopting a session into this terminal

`omo daemon adopt <session-id|name>` takes a session a host holds (a Desktop thread on its `i-*`
host, a daemon or task session) into the terminal you run it in. It finds the session through the
thread address book (`omo thread list --all-scope`), asks its host to hand it over (senpi
`release_session`, reason `takeover`), and then resumes it with the normal interactive launch on
`--session <session file>`, in the session's own directory. The host keeps nothing: it writes a
`session_released` entry, closes the session and releases the file.

- A quiet session is handed over as is. A session that is running a turn, or owes one to queued
  input, is refused `turn_active` (exit 4); `--interrupt` stops the turn first. Input the
  interrupt took out of the host's queue becomes this terminal's first prompts, in their queued
  order, after `--`, so none is read as a launch option (a message starting with `@` is printed
  instead, since the launch would read it as a file; an empty or whitespace-only one is dropped).
  When the release is refused after the interrupt, that input is printed so it can be sent again.
- A session another client is attached to (a Desktop thread window) is refused `attached` with
  the client count (exit 4); `--force` takes it anyway, and those clients are told the session was
  released.
- A terminal session is refused as "already a terminal session" (exit 4), and a session no running
  host holds exits 3 with the `omo --session` command that resumes it instead.
- Gateway messages the host had admitted but not yet written are not lost: the adopting terminal's
  inbox applies them again.
- `--json` prints `{kind:"released", thread_id, session_path, attachments, dropped}` or
  `{kind:"refused", error, thread_id?, dropped?}` on stdout before the terminal starts.

Terminal endpoints are listed by `status` as `tui <name> pid <n> cwd <path>`
(`endpoint_kind: "tui"` in `--json`), but they belong to their terminal: `handoff` prints them as
skipped, `stop --all [--wait]` neither stops nor waits on them, and `gc` reaps only a terminal whose
process is gone (the engine's evidence rules).

### `omo host status --all`

`omo host status --all [--json] [--include-workers]` is the engine's machine-wide inventory, one JSON
line `{"endpoints": [...]}` with the engine's exit code (0 while anything answers, 3 when nothing
does). OmO passes every row through unchanged and adds one field to each terminal
(`endpoint_kind: "tui"`) row:

| Field | Type | Meaning |
| --- | --- | --- |
| `last_activity_at` | ISO 8601 string or `null` | The top-level `timestamp` of the final complete, valid JSONL entry in the row's session file (`owner.session.path`). It is the value `omo thread list` shows as `updated_at` for that session when its endpoint reports none, including degraded/resumable rows. The reader takes the first and last 64 KiB plus at most 256 KiB while locating and validating the final record, so its cost never grows with the transcript. `null` means freshness is unknown: the row names no session, the file is missing/unreadable/headerless, the final line is partial or malformed, or that final entry exceeds 256 KiB. It never substitutes an older entry or the file mtime; copying, restoring or touching a file can change mtime independently of the entry clock. |

```json
{"socket": "/tmp/example/rpc-host-daemon/0123456789abcdef/t-0123456789abcdef.sock", "endpoint_kind": "tui", "alive": true, "reason": null,
 "owner": {"pid": 4242, "cwd": "/work", "session": {"id": "session-id", "path": "/tmp/example/sessions/--work--/session.jsonl", "name": "my-tui"}},
 "last_activity_at": "2026-09-30T01:07:30.000Z"}
```

Rows of any other kind carry no `last_activity_at`. When the engine prints no inventory line (a usage
error), its output passes through untouched.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | done — the engine's `action` says which of start / reuse / handoff |
| 2 | usage: no subcommand, an unknown one, or `--foreground` (the engine is not called) |
| 3 | `adopt`: no running host holds the session; `status`: no endpoint answers (`daemon: not running`); `stop --all`: an endpoint refused or, with `--wait`, is still live at the timeout; `handoff`: an endpoint refused; `rollback-prepare`: refused before writing |
| 4 | unsupported platform: win32 has no unix socket to share (the engine is not called); `adopt`: the host refused the hand-over (`turn_active`, `attached`, `session_busy`, ...) or the session is already a terminal session |
| 5 | the engine refused — read its line; the launch spec may be missing; `adopt`: the host could not write the hand-over (`release_failed`) |

## Troubleshooting

**`daemon: not running`** — nothing serves the socket. `omo daemon run` starts one;
if it exits 5, read the engine's reason (a missing spec means the plugin payload
was not built for this install).

**`omo doctor` endpoint rows** — each live daemon, shard, thread, and other
layout-2 endpoint reports pid, generation, engine, sessions, whole-tree RSS,
supervisor-plus-host RSS, descriptors, and crash count. Dead retained state is a
warning that points to `omo daemon gc`. The closing `INFO Hosts:` line is the
machine aggregate.

**`legacy host (no session context)`** — an older engine, started before the v2
state dir, is serving the socket. It has no session kind/context and cannot be
handed off to; `omo daemon stop` (or wait for its idle exit), then `run`.

**Threads grow with sessions** — about one OS thread per session is expected while
the `config-reload` builtin spawns a filesystem-watch worker per session
(tracked upstream as senpi#1794); with that builtin disabled the increment is 0.
It is linear, not flat; size a long-lived host from those numbers.

See also: [omob dev binary](./omob-dev-binary.md), [omo.json](./omo-json.md),
[senpi-task guide](../guide/senpi-task.md).
