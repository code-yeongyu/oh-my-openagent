## deep-low drops its GPT-5.6 Sol rung and gate

`category/fallback-chains.ts` removes the trailing `gpt-5.6-sol` medium rung from `deep-low`, leaving
`chatgpt-subscription/gpt-6-sol-fast` medium -> `gpt-6-sol` medium. `category/openai-categories.ts`
narrows `DEEP_LOW_GATE_MODELS` to `gpt-6-sol-fast`, `gpt-6-sol`, so the task tool's category listing
reads `(requires gpt-6-sol-fast or gpt-6-sol)` and a GPT-5.6-Sol-only registry leaves `deep-low`
unavailable. `ultrabrain` keeps its GPT-5.6 Sol max fallback. omo#8718.

## deep-high runs GPT-6 Astra at xhigh; deep-low leads with GPT-6 Sol Fast medium

`category/fallback-chains.ts` mirrors the model-core table: `deep-high`'s single Astra rung moves
from `high` to `xhigh`, and `deep-low` gains a `chatgpt-subscription/gpt-6-sol-fast` medium head
rung ahead of the existing `gpt-6-sol` and `gpt-5.6-sol` medium rungs. The Fast (priority) tier is
published only on the ChatGPT subscription lane, so Copilot and OpenCode Zen keep resolving the
lane through plain `gpt-6-sol`. `category/openai-categories.ts` routes the `deep-low` default
through `chatgpt-subscription/gpt-6-sol-fast` and adds it to `DEEP_LOW_GATE_MODELS`, and the
`deep-high` default runs at `xhigh`. `ultrabrain` (Astra max) and `unspecified-high` (Opus 5.5 max
first) are unchanged. omo#8714.

## deep-low leads with GPT-6 Sol; every Luna rung is GPT-6 Luna Fast; Fable chains step down to Opus 5.5

`category/fallback-chains.ts` mirrors the model-core table: `deep-low` gains a `gpt-6-sol` medium
rung ahead of the existing `gpt-5.6-sol` medium rung (deep-high stays Astra-only), `quick`'s first
rung and the `explore` / `librarian` OpenAI rung in `agents/builtin/fallback-chains.ts` become
`gpt-6-luna-fast` low, and `artistry` moves `claude-opus-5-5` max ahead of `kimi-k3`.
`category/openai-categories.ts` routes the `deep-low` default through `chatgpt-subscription/gpt-6-sol`
and gates the lane on either Sol tier (`DEEP_LOW_GATE_MODELS`), and `quick`'s default through
`gpt-6-luna-fast`. `architect` is untouched: it is hard-gated on Fable 5.1 and never falls back.
The manual QA scripts under `scripts/` follow the new quick rung. omo#8701.

## A crashed reclaimer's stale sentinel cannot wedge DAG lock acquisition on Windows

Clearing a stale `.reclaim` sentinel renames and unlinks files that the host's antivirus or
search indexer can briefly hold open; on win32 that surfaces as EPERM/EBUSY sharing violations
POSIX rename does not have. The quarantining rename threw the refusal raw, and the stall budget -
which resets only when the canonical holder changes - charged the reclaim's own I/O until
`withLock` timed out behind an unchanged dead holder, exactly the intermittent windows-latest
failure of "the sentinel cannot wedge acquisition". The rename now retries transient refusals
like the final unlink already did, clearing a stale sentinel republishes the reclaim mutex in
place instead of handing a wasted poll back to the waiter, and a pass that cleared a sentinel
resets the stall budget: the loop observes the sentinel's disappearance, not the clock.
omo#8671.

## unspecified-low leads with MiMo V2.6 Pro; the Grok rung moves to 4.7

`CATEGORY_FALLBACK_CHAINS["unspecified-low"]` and the builtin category config now lead with
`xiaomi|mimo-v2.6-pro (max)`. The Grok rung is `grok-4.7 (xhigh)` on `xai|github-copilot|opencode-go`:
`opencode` does not serve 4.7 (models.dev, measured), `opencode-go` does. The `mimo-v2.5-pro` rung
stays last. Chain order is proven by resolving against a registry that serves every rung at once,
so the winner demonstrates order rather than availability. omo#8652.

## The persisted run stats keep their failure count

`store/run-stats-parse.ts` parses the persisted `run_stats` block field by field, and it had no
branch for `failed_turns` - so the counter survived only in memory. Every read back from disk
(`task_output` on a terminal child, the completion notification's details, a reconciled record)
silently dropped it, leaving a record that claims zero turns and offers no evidence that any
attempt was ever made. The parser now reads it with the same absent-tolerant, type-strict rule as
the other optional stats: a record written before the field shipped still loads, and a present
value of the wrong shape rejects the record instead of being discarded. omo#8627.

## A live row reads "starting" until a real turn lands

`status-line.ts` emitted `turn N` whenever stats existed, so the row the user complained about
read `turn 4 · $0.0000 · running` while six provider attempts had failed and nothing had run. The
stats tokens now come from ONE shared `buildLiveStatsTokens`: a run with no successful turn and no
tool call renders no turn token at all, failed attempts render as their own `failed N` counter,
and spend still follows reported cost - which a failed-only run never carries, while a successful
zero-cost turn keeps rendering `$0.0000`. `progress.ts` selects the verb the same way:
`running <tool>` while a tool executes, `starting` before anything has landed, `retrying` once a
failure proved the child is alive, and plain `running` only after a successful turn.
`ToolProgressDetails` carries `failedTurns` (round-tripped through `readToolProgressDetails`,
which still accepts records omitting it, and emitted as `failed_turns` by the RPC codec) so DAG
and RPC consumers read the same facts. omo#8627.

## A failed assistant turn is no longer a turn

`run-stats.ts` counted every assistant `message_end` as a turn and folded in whatever usage it
claimed, so a provider error produced a run with `turns: 6` and `cost_status: "reported"` even
though nothing executed - the measured payload was an all-zero usage block with a zeroed cost
breakdown. A turn is now a SUCCESSFUL assistant turn only: `stopReason` neither `error` nor
`aborted`, the same predicate the transcript log and the runner outcome mapping already apply.
A failed turn contributes nothing to tokens, cost, usage coverage or generation time; it only
increments a new `failed_turns` counter on `TaskRunStats` (emitted when greater than zero) and
re-anchors the generation window, so a failure's wall time never inflates the next successful
turn's `generation_ms`. A run with no successful turn reports `token_status`/`cost_status`
`unavailable` and omits `cost_usd`, while a successful turn reporting a genuine zero cost still
yields `cost_status: "reported"` with `cost_usd: 0`. omo#8627.

## The fake host rebinds a fresh pipe when it restarts

`fake-host-transport.ts` derives the win32 named pipe from the logical socket path plus a random
secret and publishes the secret at `<path>.secret` for connecting clients. The fake host's
`restart()` closed the server and rebound the SAME pipe name, but Windows keeps a pipe name
reserved while any handle is open - including a reconnecting client still holding the old pipe -
so the rebind raced the dying handles and failed with `EADDRINUSE`. The transport now exposes a
`rotate()` that mints a fresh secret (and with it a fresh pipe name) and republishes it where
clients read it, and `restart()` rebinds through it; a restarted generation answering the same
logical path as a new pipe instance is exactly the story the recovery suites pin. POSIX keeps
rebinding the same socket path, as before. omo#8604 (same dev full-matrix shard).

## Isolated children run in a copy-on-write clone and merge back when they settle

`isolation/` wraps `@oh-my-opencode/isolation-core` as an injectable port (`runtime.ts`
`createIsolationRuntime`, seven backends, `~/.omo/wt` sweep roots). `prepare.ts` resolves the repo
root, captures the baseline and clones BEFORE the record is committed to a launch, so a repository
that cannot be cloned refuses the spawn `isolation_unavailable` instead of quietly running the child
against the real checkout. `settle.ts` runs before the terminal record is written - every result
surface therefore reports one merge outcome - and only a completed child merges: anything else keeps
the delta as a patch plus a summary under `<stateDir>/isolation/<taskId>/`, and a `not-applied` or
`branch-merge-failed` replay renames the clone aside as `<base>.retained-<ts>` with a
`git apply --3way` manual command rather than deleting the user's only copy of that work.
`salvage.ts` reclaims a crashed host's clones at session start by salvaging the delta before the
sweep. An isolated record is never revived: `reviveClaimed`, `revive-detached` and the legacy
respawn path all answer `isolated_not_revivable`.

The manager takes the port as `TaskManagerOptions.isolation` and the lifecycle as `isolation` +
`isolationProbe` (defaulting to `processOwnerProbe`); `manager/isolation-wiring.ts` owns the binding
map, the post-spawn owner re-stamp and the settle. `createIsolationRuntime` is exported from the
package barrel so the omo-senpi adapter can build ONE runtime per engine and hand the same object to
both seams - an adapter that supplies neither refuses every isolated spawn, which is what
`packages/omo-senpi/scripts/qa/isolation-e2e.mjs` pins against the real senpi binary. omo#8574.

## A foreground wait parks the parent's lane lease

`manager/concurrency.ts` keeps parked leases in `#parked`, a per-lane map of `(taskId, runEpoch)`
entries held outside `#counts` and outside the FIFO. `park()` drops the lease and dispatches, so a
child is admitted while its parent waits; `unpark(token, signal, { overflow })` resumes that exact
entry and is a no-op for a stale token, so a released task cannot be resurrected and an earlier
token cannot resume a later parking of the same epoch. The drain prefers a resumable parked owner
over the queue head, which is what re-admits the parent ahead of everything that queued while it
waited; `overflow: true` (promotion to background) re-counts the parent immediately, bounded to one
overflow per parked lease, and an abort while parked releases instead of resuming. `tryAcquire`
refuses an epoch whose `leaseState()` is anything but `undefined` and `releaseLease` drops the held
lease AND any parked entry for that key, so a parked epoch is neither re-acquired nor double-released.

`tools/task/execute-single.ts` and `tools/task/execute-batch.ts` park the live caller - resolved
through `manager.findTaskByChildSession(sessionId)` plus live ownership rather than a new context
field - and unpark in `finally`. `tools/output` reports `lease: "held" | "parked"` on the snapshot
(`OutputManager` now also picks `concurrency`). Residency and TTL policy are untouched. Pinned by
`manager/concurrency.test.ts` and `tools/task/lease-parking.test.ts`, the latter driving the real
in-process runner through two- and three-level spawn trees at cap 1. omo#8575.

## Host-session children reattach after a lost transport and wait out host memory pressure

`runners/rpc-host/handle.ts` takes an optional `reattach` port (`runners/rpc-host/reattach.ts`). A
`transportGone` under a live child (intent running, not parked/detached/exited) no longer ends it:
`runners/rpc-host/handle-reattach.ts` `recoverLostTransport` calls the port, adopts the new
`HostSessionPort` + identity it returns, and re-prompts a continuation only when a turn was in
flight AND the reopened session is not streaming (`get_state.isStreaming`) - a cut connection to a
host that kept the session needs no prompt; a host that reopened the session from JSONL does.
Commands issued during recovery wait on the reattach promise and retry once on the new port;
`HostSessionLiveness` carries `isStreaming`; `hostSession` is a getter over the live identity.
`runners/rpc-host.ts` supplies the port: `reattachDelaysMs` backoff (500 ms .. 8 s) over
`ensureDaemon` -> `openAdmitted(sameSessionPath)`. `openAdmitted` waits out senpi#1905's
`host_memory_pressure` refusal (`HostSessionOpenError.retryAfterMs`, bounded by `admissionWaitMs`,
warned once) and never reaches the fallback runner. `session-wire.ts` `HostSessionOpenError`
carries `retryAfterMs`. Fixture: `fake-host` gained `cutConnections()` and per-session
`streaming` state. Pinned by `runners/rpc-host/handle-reattach.test.ts` and
`runners/rpc-host-recovery.test.ts`. omo#8563.

## Detached host sessions cannot crash heartbeat or teardown

The host-session heartbeat catches an in-place `HostSessionDetachedError` as well as a rejected
state read, using the existing diagnostic. Teardown stops the heartbeat before abort or close can
drop the connection. Its best-effort wrapper invokes each operation inside the error boundary,
so a synchronous abort failure is logged and still proceeds to close and settle the child.
This incorporates ayden94's heartbeat fix from #8495 for #8494 and covers the host teardown
failure reported in senpi#1840. Subprocess regressions count both uncaught exceptions and
unhandled rejections; a withheld-close test pins heartbeat cancellation before detachment.

## RPC child heartbeat and disposal contain connection failures

The child-process heartbeat also catches synchronous `send(get_state)` failures while keeping
the existing exited-client and harmless-pipe-error policy. Disposal awaits `detach()` and logs
either a thrown error or a rejected promise instead of leaving a nested rejection unobserved.
These are the remaining two call sites from senpi#1840. The current protocol client returns
rejections from `send` and detaches synchronously; subclass probes exercise both failure forms
at the handle boundary with a real child process.

## Package-provided extensions reach RPC children

Process and host child runners can now select extension paths that the parent actually loaded from
configured packages, while preserving the parent's argv extensions as the base list. Package paths
are filtered to installed package roots, exclude synthetic and already-covered paths, and retain
load order, so children can resolve providers shipped by packages without forwarding unrelated
agent or project extensions.

## A refused model names its cause, and the category chain is walked

Two halves of #8492 that forwarding package extensions does not reach.

`publicStartFailureMessage` collapses every runner failure to one sentence on purpose: `RunnerFailure.message`
is stderr-derived child output and `store/redaction.ts` redacts by key name only, so free text carrying a
credential would be persisted verbatim. `model_unavailable` fell through that collapse to the generic
sentence, which is why an admission refusal reached the caller as `Task runner failed to start.` The cause
now rides an optional `RunnerFailureReason` - a closed union the parent authors, never the child - and the
manager maps it through a fixed table. `knownFailureReason` makes that lookup total, so an off-enum value
degrades to the classification sentence instead of being echoed; the same guarded value is recorded as
`failure_reason` beside `failure_kind`. `createRpcModelAdmission` tags its three refusals accordingly.

`#launch` now loops. On `model_unavailable` it advances to the next `fallback_models` entry and retries;
every other kind fails immediately, because a depth refusal or a failed session create would reproduce on
every remaining entry. Nothing has executed yet at that point - the child does not exist - so advancing
repeats no work, unlike the post-outcome runtime fallback that must guard on `tool_calls === 0`.

The epoch advances on every hop, and that is load-bearing. `#releaseSlot` is guarded per (task, epoch) and
remembers the highest epoch it released, so retrying under the same epoch makes the eventual completion's
release a silent no-op and leaks the lane's lease for the life of the process. Record bookkeeping mirrors
the runtime fallback, and `#launch` reports the epoch and resolved model it ended on so `start()` cannot
return the pre-fallback pair.

## The launch profile no longer depends on how the spec's path is spelled

The compiled entry reaches `daemon-launch-spec.json` through the install prefix; the in-process
runner reaches the same file through the bundle's real location. On macOS `/tmp` is a symlink, so
the two spellings hashed to two profile ids, the parent's ensure judged the healthy daemon foreign
and handed the socket over to itself - dropping every live child session. The spec directory is
now canonicalized before extension paths are resolved into the profile.

## The daemon runner creates the child session directory before opening

The first live run of daemon-hosted children failed every `open_session` with `ENOENT ... lstat
<stateDir>/sessions/<taskId>`: the host checks the JSONL's directory before it opens the session,
and on the daemon path nobody had created it (a child process used to do that for itself).
`RpcHostRunner.openChild` now creates the directory for a fresh child. The fake host gained an
`enforceSessionDir` option that mirrors the host's check, so the regression test fails for the
right reason.

## 2026-09-17 — The shared daemon is where a process child runs by default

`task.default_execution_mode` ships as `auto`. A parent session answers it ONCE, at the first spawn
that needs an answer: `process` when the platform is not win32, `task.process_runner` is `host`, and
the ensured daemon advertises `session_context` + `generation_handoff`; `in-process` otherwise. The
answer is a SESSION fact (`manager/execution-mode.ts` `createExecutionModeGate`) - a daemon that dies
later never changes the mode of the next child, and the daemon is asked exactly once per session.

Precedence is unchanged where it matters: `spec.execution_mode ?? agentDef.executionMode ?? config`,
with `auto` contributing only the resolved value. A user-set `in-process`/`process` wins and never
even ensures a daemon, and curated read-only agents stay in-process. A spec that names no mode
because `auto` has not resolved yet reaches the manager WITHOUT `execution_mode`, and the manager
resolves it (awaiting that one resolution) instead of anyone guessing in-process.

Two new seams carry the decision outward. `ensureTaskDaemon` returns the daemon's `capabilities`
(probed for a host that was already up, asked once for one it just started) so the mode decision has
the facts it needs without a second connection. `ManagedChildHandle` carries `hostSession`, and
`recordSpawnedRunner` stamps `runner_kind: "host-session"` plus that identity onto the record at
spawn - the fields the lifecycle already branches on now have a production writer.

`readSessionRole` (`runners/rpc-host/session-role.ts`) is the reader half of `buildChildContext`:
one extension set serves every session of the daemon, so a component asks what THIS session is
(`pi.sessionContext.role`) and only falls back to `OMO_SENPI_TASK_RPC_CHILD` / `SENPI_TASK_MEMBER`
for the per-child process runner. The member extension follows: `resolveMemberExtensionConfig` takes
its identity from the session context when there is one, a session with no member identity now
registers nothing instead of throwing `missing_env`, and while the run is live the member publishes
a `wake_source_state` source so the host never parks it mid-run.

## 2026-09-17 — Session-aware lifecycle for daemon-hosted children

The lifecycle now knows the difference between a child that owns an OS process and one that is a
SESSION of the shared daemon. The seam is `lifecycle/host-session.ts`: `hostSessionProbe`
(`daemonAlive` / `sessionLive`), the `hostSessionClose` writer, and `hostRetry` — the two bounded
waits the daemon path owns. `createHostSessionProbe` takes ONE `probeHost` and ONE
`list_sessions { include_workers: true }` per pass, per socket, and matches records against it by
`session_path`; `refresh()` is what starts the next pass. Reconciliation and the TTL sweep each call
it once, so a hundred daemon children still cost one round trip, never one per record.

| event | child-process child | daemon-hosted child |
| --- | --- | --- |
| parent session shutdown | terminate (SIGTERM/SIGKILL), then dispose | DETACH — the session keeps running, record parks `rpc_detached` |
| cancel / evict / TTL orphan | signal `record.pid` | `abort` + `close_session` via `runners/rpc-host/close.ts`, only when the session is still live |
| reconcile liveness | `record.pid` alive | `daemonAlive && sessionLive` (`host_pid` stays the omo PARENT's pid) |
| resume path | newest JSONL in the child's session dir | `host_session.session_path` from the record |
| daemon/host gone | mark lost | park `rpc_detached`, bounded reconcile 1 s / 4 s / 16 s, then stay parked |

Nothing signals a pid for a host-session record, and nothing can: `ResidentHandle.kind` gained
`"host-session"`, and every teardown branches on it (`destroy.ts`, `shutdown.ts`, `ttl.ts`). The
kind now comes from the RUNNER — `ManagedChildHandle.kind`, set by `adaptInProcessHandle` and
`adaptRpcHandle` — because `pid === undefined` cannot tell an in-process child from a daemon session,
and reading it wrong silently turned `terminate()` into a no-op that leaked the session.

Two failures are explicitly NOT losses. `session_path_in_use` from a generation that is still
draining after a handoff becomes `RespawnResult{ code: "host_draining", retryAfterMs }`, retried on
the host's own delay (2 s default) up to 10 attempts and then deferred as `deferred/host_draining`.
A daemon that stops answering parks the child and retries three times on a fixed backoff. Both leave
a durable `suspension_reason` on the record (`host_draining` / `daemon_unavailable`), which is what
`task_output` reports instead of the generic "resumes with session" line.

Parked children stay reachable. `isColdRevivalCandidate` and `messageability` treat an
`rpc_detached` host-session record as revivable in every non-`pending` state — including `running`,
because a parked session names no live process anyone could talk over — so a `task_send` or team
mail reopens it (`open_session { sessionPath }`, no prompt replay) and delivers, instead of refusing
with `not_continuable`. Revival also stops reading the disk for that record's transcript: a
host-session child NAMES its session path, so the "terminal with no transcript, dispose it" rule can
no longer throw away a session the daemon still holds.

Respawn follows the same rule. `manager/manager-respawn.ts` resumes `host_session.session_path`, and
when the daemon answers `attached` it skips BOTH `switch_session` and the interrupted-turn nudge —
the session never stopped, so re-opening it or injecting a continuation prompt would duplicate a
turn that is still running. A session the daemon EVICTED is reopened from JSONL and still gets the
nudge when its tail shows an unanswered turn.

The legacy pid path is untouched: a record with a bare `pid` and no `runner_kind` reconciles,
terminates and TTL-sweeps exactly as before, and `src/__adversarial__/chaos-host.test.ts` pins the
new branches against a seeded mix of `hostKill` / `daemonRestart` / `idleEvict` / `handoff`.

Two files were split to stay under the size ceiling while absorbing this: `manager-reattach.ts`
(out of `manager-respawn.ts`) and `revive-rollback.ts` (out of `reconcile-reclamation.ts`).

CAVEAT, pinned engine: omo pins `@code-yeongyu/senpi` 2026.9.17, whose `RpcClient.listSessions()`
takes no options, so `include_workers` does not reach the wire yet and worker rows stay hidden. The
probe therefore reads "no session is live", which is the conservative answer everywhere — the
lifecycle reopens from JSONL instead of attaching, and closes nothing. It starts attaching for real
once the pin moves to an engine whose client forwards the flag.

## 2026-09-17 — Process-mode children as daemon sessions (`RpcHostRunner`)

`runners/rpc-host.ts` is the runner that turns a `process`-mode child into a SESSION of the shared
daemon. It composes what the previous todos built and adds nothing of its own: `rpc-host/daemon.ts`
for attach-or-create, `rpc-host/session-context.ts` for the child's `kind`/`context` and its JSONL
path, `rpc-host/session-client.ts` for the per-child connection, `rpc-host/handle.ts` for the
steerable handle, and `rpc/model-admission.ts` + `rpc/start-cleanup.ts` unchanged from the
child-process runner. It spawns nothing, signals nothing, and holds no pid.

One start, in order: inherited parent extensions are applied to a spec that carries none (same rule
as `rpc-process.ts`), `modelAdmission(spec)` runs FIRST so a model the child profile cannot resolve
never reaches the daemon, then `ensureTaskDaemon` decides whether there is a daemon to use, and only
then is a session opened - `retain_on_disconnect: true`, `auto_title: false`, `kind: "worker"`, the
child context, the parent's cwd, `provider`/`modelId` split off `spec.model`, and the thinking level
from `reasoning ?? variant`.

Resume semantics are the reason a daemon child is cheaper than a process child:

| start | session path | what the runner sends |
| --- | --- | --- |
| fresh child | `<stateDir>/sessions/<taskId>/<iso>_<uuid>.jsonl` | `startInitialPrompt(spec.prompt)` |
| resume, host still holds it | `spec.resumeSessionPath` | nothing (re-joined under a new routing handle) |
| resume, reopened from JSONL | `spec.resumeSessionPath` | nothing (the transcript IS the state) |

No `switch_session` is ever issued for a resume: the session is OPENED at that path, so the handle's
`switchSession(target)` answers `{ cancelled: false }` for the path it already owns and only a
different path reaches the wire. That keeps `manager/manager-respawn.ts` working unchanged.

The fallback is loud and narrow. Whether a refusal may run the child as its own process is NOT
re-decided here: `HostUnavailableError.fallbackAllowed` (set in `rpc-host/daemon.ts` from the
engine's own verdict - `capability`, `engine_mismatch`, `win32`, `runtime`) is the single source of
truth, and the runner additionally requires a `fallback` runner to delegate to. The reason is warned
ONCE per runner, carrying the `host_unavailable:<reason>` token so a surface can show it; everything
else - including `ensure_failed` WITH a fallback present - fails closed as
`RunnerError{ kind: "host_unavailable" }`, which is the new `RunnerFailure` kind this change adds.
A refused client never starts a second host beside the daemon (invariant I1).

Failure cleanup mirrors the child-process runner exactly: the exit outcome is captured BEFORE
cleanup, `discardUnstartedRpcHandle` aborts and closes the session (never a signal), and the throw is
`child-prompt-failed` with `rejected_while`. An `open_session` that fails for any other reason
(`session_path_in_use`, `invalid_launch_profile`) becomes `session_unavailable` with the typed engine
error preserved as `cause`, so the lifecycle work can branch on it without re-parsing a message.

## 2026-09-17 — The steerable child handle over a daemon session

`runners/rpc-host/handle.ts` (`createHostSessionHandle`) is the `RpcChildHandle` a daemon-hosted
child is driven through. Turn semantics are the child-process runner's, unchanged and reused rather
than re-derived: `rpc/delivery-semantics.ts` for the steer → followUp fallback, `rpc/turn-outcome.ts`
for `agent_end` classification, terminal assistant facts, prompt failures and exit-to-outcome
mapping. The heartbeat is `get_state`, which records `lastSeen` and the durable session id exactly
as the process handle does.

What a session does NOT have is a process. `pid` is `undefined` ALWAYS — the daemon's pid is not
this child's, and writing it into a record would arm `lifecycle/destroy.ts`'s `record.pid` signal
against a machine-wide host (invariant I1). Nothing in this module sends a signal: `terminate()` is
`abort` (≤ 2 s) then `close_session` (≤ `closeGraceMs`), each bounded on its own, so a daemon that
answers nothing still lets a parent shut down. `close()` is the same teardown without the abort.
`detach()` drops the connection and leaves the session running; `dispose()` IS `detach()`, because
a parent going away must never end a child that outlives it.

`runners/rpc-host/exit-mapping.ts` is the session-shaped sibling of `runners/rpc/exit-mapping.ts`:
the same `ChildExitOutcome` vocabulary, with `pid`/`code`/`signal` absent and the host's reason
riding `stderrTail` so the lifecycle's error text is identical for both runners. The classifier reads
one fact this client owns — what it last asked for (`running` / `closed` / `terminated`) — and one
the host names:

| what happened | intent | outcome |
| --- | --- | --- |
| `session_closed` (any reason) | `closed` | `clean` |
| `session_closed` (any reason) | `terminated` | `killed` |
| `session_closed{host_shutdown,error,…}` | `running` | `crashed`, `stderrTail` = reason |
| transport gone | `running` | `crashed`, `stderrTail` = `transport_gone` |
| open refused | any | `spawn_error` carrying the code |
| `session_parked`, `session_closed{handoff_parked,idle_evicted}` | any | NOT an exit |

Parking wins over intent on purpose: a suspended session is reopenable, so calling it an exit would
end a child the manager is supposed to park (`rpc_detached`) and wake. A parked handle fires
`onParked`, flips `attached` to false, stops its heartbeat and produces NO outcome — and from then
on nothing the host says (a late `session_closed`, the daemon dying) can turn that child into a
crash. A teardown this client asks for is the one exception: `terminate()` ends a parked child as
`killed`, because cancel/TTL is the manager's decision, not the daemon's.

The seam is `handle-port.ts` (`HostSessionPort`), which `HostSessionClient` satisfies structurally.
Turn delivery and outcome tracking are therefore proven against an in-memory session, while park,
transport loss, close, terminate and detach are proven through the REAL engine client against the
unix-socket fake host — the same fixture `session-client.test.ts` uses.

## 2026-09-17 — One senpi RpcClient per daemon-hosted child

`runners/rpc-host/session-client.ts` is a child's whole view of the daemon: `HostSessionClient`
holds ONE engine `RpcClient` for ONE child. A connection is never shared between children, so a
sibling's records, its UI requests and its transport loss can never reach this child, and `detach()`
drops only this child's socket.

`open()` probes the daemon per child (never a cached ensure answer), then opens the session with
`kind: "worker"`, the child context, `retain_on_disconnect` and `auto_title`. The probe rides its
OWN short-lived connection to the same socket because the engine's `RpcClient` exposes no
raw-command seam: `get_protocol_info` cannot be sent on the session connection through the public
API. That is acceptable precisely because `instance_id` is informational — records key liveness on
the session path, never on the instance — and it keeps the identity per child instead of per
process. When the engine grows a connection-level protocol-info call, only `session-transport.ts`
changes.

Admission reuses the ensure path's vocabulary on purpose: the probe is checked against
`TASK_DAEMON_PROTOCOL_VERSION` and `TASK_DAEMON_REQUIRED_CAPABILITIES`, and a narrower daemon throws
the SAME `HostUnavailableError{ reason: "capability", fallbackAllowed: true }` the ensure path
throws, so one branch in the runner covers both. Anything else fails closed (`protocol`,
`fallbackAllowed: false`) — a refused client never starts a second host beside the daemon (I1).

`session-wire.ts` owns the boundary: every frame is parsed before anything acts on it, records
tagged for another routing handle are dropped, `session_parked` / `session_closed{reason}` release
the handle and fire typed callbacks, and an `open_session` refusal becomes `SessionHeldElsewhereError
{ owner, retryAfterMs }` (`session_path_in_use`) or `HostSessionOpenError{ code }`
(`invalid_launch_profile`, `open_failed`, …). The client NEVER retries a held path: the backoff and
the `deferred/host_draining` decision belong to the lifecycle, which is the only place that knows
whether the record should wait at all.

UI requests are answered through `runners/rpc/ui-auto-answer.ts` and the answer is written, never
awaited, so a headless child cannot block on a human; `buildAutoUiResponse` now takes the wire
minimum (`type`/`id`/`method`) because a frame parsed off a socket carries no compile-time variant.

The transport is a port (`createClient`, `probeProtocolInfo`) for ONE reason: the suites run the
REAL engine client against a unix-socket fake host (`__fixtures__/fake-host.ts`, which todo 33
grows), so open, routing, park, close, detach and transport loss are proven on the wire rather than
against a mock of the engine.

## 2026-09-17 — Attach-or-create the shared task daemon from the launch spec

`lazy/senpi-barrel.ts` gains the host-daemon accessors (`senpiEnsureHost`, `senpiProbeHost`,
`senpiStopHost`, `senpiHandoffHost`, `senpiDecideHostAction`, `senpiEngineBuildIdentity`,
`senpiRpcClient`) plus omo's own structural view of that surface. Each accessor duck-types the
loaded barrel exactly as `kernel-tools/contract.ts` duck-types the JS kernel capability — the
pinned engine can predate the release that exports them — and fails closed with
`SenpiHostSymbolMissingError` naming the symbol. Nothing is imported statically; the lazy boundary
and its guard are unchanged.

`runners/rpc-host/daemon.ts` is the attach-or-create client. `resolveTaskHostSocket(env, agentDir)`
is now the ONE resolver for the public socket (`OMO_RPC_SOCKET`, `SENPI_RPC_SOCKET`,
`PI_RPC_SOCKET`, `OMO_RPC_SOCKET_PATH`, then `<agentDir>/rpc/rpc.sock`); omo-senpi's thread surface
imports it instead of keeping a second copy. `ensureTaskDaemon({ agentDir, env, policy })` probes
the socket, asks the engine's `decideHostAction`, and runs `start` / `reuse` / `handoff` through
`ensureHost`; a `refuse` becomes a typed `HostUnavailableError` and never starts a second host.
`fallbackAllowed` is set only for the loud fallbacks to the per-child runner: `capability`,
`engine_mismatch` under policy `fallback`, `win32`, and `runtime` (a Node host cannot arm the
engine's child reaper, so a machine-wide daemon would accumulate zombies — todo 13's matrix). The
ensured result is cached for 5 s; a refusal is never cached.

`runners/rpc-host/launch-options.ts` derives the daemon's launch from the spec alone:
`hostArgs` = `--session-runtime <runtime>` plus one `--extension` per spec path resolved against the
spec's directory, `env` = the spec's env with the child, member and workpool identity names nulled
and `SENPI_RPC_SESSION_IDLE_EVICTION_MS` raised to at least the idle-exit window, plus the cold-start
policy and the `upgrade` marker. `__fixtures__/daemon-launch.ts` is the ONE expectation fixture both
this package's suite and `omo daemon run`'s suite import, so the two launch paths cannot drift.

## 2026-09-16 — Scope a child's kernel-tool grant with the engine's per-call invoke scope

`kernel-tools/contract.ts` gained the optional per-call execution scope the producer accepts
(`invoke(request, signal | { signal?, scope? })`), the `kernel_tool_host_denied` code, and
`supportsInvokeScope(capability)` — a runtime duck-type of `capabilities.invokeScope === true`, so
the package still compiles and behaves against an engine pin that predates senpi#1731. When the
marker is present, `resolveKernelToolGrant` no longer refuses a child whose allow/deny narrows the
parent: it attaches `childInvokeScope(...)` to the grant, `buildChildKernelTools` recomputes that
scope against the child's REAL installed surface, and every wrapper invoke carries
`{ scope: { tools: { allow, deny? } } }` beside the turn's signal. Without the marker the grant is
refused exactly as before and the wrapper posts the bare signal it always did.
`TaskKernelToolsDetail` reports `scoped: true` plus the allow/deny summary so the caller can see a
grant is child-permissioned, and a nested call the engine refuses arrives on the child's own tool
channel as a `kernel_tool_host_denied` envelope instead of failing the parent's cell. Curated
read-only agents, team members, process children and non-JavaScript parents are untouched.

## 2026-09-14 — Re-mirror the curated agent chains from model-core and guard the mirror

`agents/builtin/fallback-chains.ts` had drifted from the `model-core` table it claims to mirror: `plan-consultant`
still headed with `claude-sonnet-4-6` (no reasoning variant) although the source moved off that head on 2026-07-26,
and `explore` / `librarian` carried `qwen3.5-plus` where the source has `qwen3.7-plus` (#8259). The consultant chain is
now `claude-fable-5-1 (max)` -> `claude-opus-5 (max)` -> `kimi-k3 (max)`, with `claude-sdk-oauth` still heading the
Claude rungs (#8051), and the utility rungs match the source again. `AGENT_FALLBACK_CHAINS` is exported from the
`./agents-builtin` subpath so `omo-senpi` can hold a parity test that compares every curated chain with its model-core
source rung for rung (modulo the `claude-sdk-oauth` head); the pin test here keeps catching transcription drift, the
parity test catches source drift.

## 2026-09-13 — Preserve layout when sanitizing recorded reports

`stripTerminalControls` is exported with an opt-in `preserveWhitespace` option
for multiline recorded reports. Tabs, line endings and ordinary spacing survive
while terminal escape/control sequences are removed. Existing single-line
normalizers retain their default behavior.

## 2026-09-12 — Remove the retired curated agent-name alias

`agents/legacy-agent-names.ts` and its exports (`LEGACY_AGENT_NAME_ALIASES`, `canonicalAgentName`, `legacyAgentNameNotice`, `CanonicalAgentName`) are deleted: the one-release window opened at 5.0.0-beta.51 and the package has since shipped through 5.0.0-beta.56. Every input boundary takes the submitted agent name verbatim — `resolveAgent`, `interactionPolicyForAgent`, `mapOmoConfigAgents` (including `allowed_subagents`), `dag/graph.ts` route compilation, `team/member-validator.ts`, the task tool's `validateTaskTarget` / `resolveSpawnItems`, and the spawn policy / invocation gate. The in-memory `legacySubagentType` → `legacyAlias` → `legacy_subagent_type` plumbing (validation, execute, execute-single, result-details, start-presentation) is removed with it, so a start text carries no deprecation line and `TaskToolDetails` never gains the extra field. `legacyOmoConfigAgentKeys` is gone; its only consumer was the omo-senpi startup notice. `resolve-agent.ts`'s `legacyFallbackChain` read-alias is deleted as dead code — `AGENT_FALLBACK_CHAINS` has been keyed by the canonical ids since the rename.

## 2026-09-10 — Retire myth agent names from test fixtures and update package documentation

The builtin curated agents `metis` and `momus` are renamed to `plan-consultant` and `plan-reviewer` in
the codebase; the alias handles legacy task records. All non-alias test fixtures in `packages/senpi-task/src/`
are updated to use the canonical names, and the team member name `atlas` in control-tool tests becomes `builder`.
`packages/senpi-task/AGENTS.md` and `packages/senpi-task/AGENTS.md` are updated to reflect the new curated agent
identities. Legacy ids (`metis` and `momus`) are only used in tests that explicitly exercise the alias table
(todos 1, 3, 5) or in persisted task records demonstrating backward compatibility.

## 2026-09-10 — Keep the user question tools out of child sessions

RPC children now receive `--no-ask-user` immediately after `--no-extensions` so the detached process cannot register `request_user_input` / `ask_user_question`. Headless auto-answer treats `method: "question"` as cancelled (structural request type until the pinned senpi unions include it). Catalog argv is unchanged.

## 2026-09-10 — Team tool failures are tool errors and the family renders as team rows

`tools/control/tool-result.ts` gains `toolErrorResult` (and the `ToolExecutionResult` shape carrying senpi's inline `isError`). Every failure kind of the lead team family returns through it — `team_create` `invalid_arguments` / `spec_error` / `runtime_error`, `team_delete` `invalid_state`, `task_get` `not_found`, `task_update` `already_claimed` / `blocked_by` / `invalid_transition` / `cross_owner`, the team mailbox error kinds, and both shutdown error views — while success kinds are untouched. `task_send` propagates the flag when it wraps a failed team message. The result keeps its typed `details`, so the model still branches on `kind`. The row background, the RPC `tool_execution_end.isError` the desktop maps to `failed`, and the `toolResult.isError` the model sees are derived by the senpi engine, which honors the inline flag from senpi#1549 onward; until the `@code-yeongyu/senpi` pin moves to a release containing it (#8082) those surfaces still show the old success state and only the compact rows below are live.

New `tools/team/renderers.ts` gives the six lead tools their own `renderCall` / `renderResult` in the shared renderer-text grammar (`team create name:<n> members:<N>` / `spec:<name>`, `team delete run:<id> [force]`, `team task <op> ...`), lists every member with its own `statusThemeColor`, and renders every failure as one error-colored line carrying the kind, code, and a bounded reason excerpt — replacing senpi's bold-name + raw-JSON fallback. The factories are now generically typed so those renderers keep their argument and details types, `buildLeadTeamTools` publishes the family as a `LeadTeamTool` union, and `filterSharedParentTools` / `mergeChildCustomTools` take a generic tool element (they only read `name` and `exposure`).

`team/spawn-members.ts` describes a `plan_unresolved` member start with the same recoverable target lists the task tool offers, so a member that cannot be routed names the valid categories instead of only the planner message.
## 2026-09-10 — Survive a Windows EPERM on the task-record rename and never strand a terminal outcome

On Windows a task-record rename under `tasks/` can be refused with `EPERM` (a sharing violation from Defender,
an indexer, or another senpi process). When that hit the terminal transition the record stayed `running`,
`waitFor` never settled, and a mass-ulw / DAG run stopped dequeuing dependents (#8050). Two layers now hold:

- `store/record-write.ts` (extracted from `record-store.ts`) retries `renameSync` on `EPERM`/`EBUSY`/`EACCES`
  on win32 only - 8 attempts with a 5 ms synchronous backoff, matching `dag/store.ts` - and rethrows every
  other platform, errno, or the final attempt unchanged. The temp file carries a random segment and is removed
  in a `finally`. `createTaskRecordStore(config, { platform })` is the test seam for the win32 branch.
- `manager/manager-outcome.ts` no longer lets a throwing terminal `store.transition` skip settlement. It logs
  the failure once with `taskId`, `code`, `syscall`, and `path`, calls `forget(taskId)` so the residency slot
  is released, and settles the waiters with a synthesized `error` record naming the persistence failure.
  `#settleWaiters(taskId, terminal?)` accepts that record instead of re-reading the store, which is guaranteed
  stale in this scenario. The DAG node folds as failed and `retry` can re-run it.
## 2026-09-08 — Persist child_session_id on spawned task records

`#recordSpawnFacts` now writes the spawned child's own session id from the handle onto `st_*.json` as `child_session_id`, for both in-process and process children. Reattach rewrites keep or refresh the field from the live handle so resume paths cannot drop it. The parser already treated the field as optional; a legacy record without it still loads. External readers (omo-desktop) join a grandchild session's `parent_session_id` back to this field.

## 2026-09-08 — Persist team linkage on member task records

Team members spawned by `team_create` now persist `team_run_id`, `team_name`, `team_member_name`, and `team_role: "member"` on their `st_*.json` task records. The parser keeps all four fields optional so records written before this linkage remain compatible.

## 2026-09-05 — Make run_in_background=true the standard spawn in the task tool's prompt surfaces

`src/tools/task/description.ts` no longer tells the model to use `run_in_background=true` "only for parallel
independent work" with a default that "waits and returns the result". The guideline now reads "Spawn children
with run_in_background=true; pass false only for a short child whose result gates your very next call", the
description states the mechanics once (true returns the task id at once and the child's result arrives later
as a message; false blocks this turn until the child finishes), and `src/tools/task/params.ts` describes the
flag as "true (the standard spawn) ... false blocks this turn ... Omitted counts as false" instead of labelling
false as the default. The runtime default is unchanged (an omitted flag still runs in the foreground); only
the text the model reads changed. A live backtest against gpt-6-astra with senpi's async-first preset showed
the old wording still pulling one of three single-dependent delegations back to a blocking spawn.
`description.test.ts` and `params.test.ts` pin the new wording and the absence of the old.

## 2026-09-04 — Defer the lead tasklist tools to tool_search

The four lead tasklist tools (`task_create`, `task_get`, `task_list`, `task_update`) register with `exposure: "search"` (plus `searchText`/`searchKeywords`/`searchGroup: "team-tasklist"`/`allowLazyActivation`) instead of the resident tool list. They only matter once a team exists, so they cost no prompt tokens until a tasklist operation is searched for and promote through `tool_search` on demand. Descriptions now lead with the selecting situation. `src/tools/team/tasklist-exposure.test.ts` pins the exposure on all four.

## 2026-08-28 — Align the task engine with Senpi 2026.8.28

`packages/senpi-task/package.json` now carries the exact published
`@code-yeongyu/senpi` `2026.8.28` peer and development pins. The task engine
must remain synchronized with the Senpi adapter and native package so optional
peer resolution cannot select a stale engine release.

## 2026-08-27 — Align the task engine with Senpi 2026.8.27

`packages/senpi-task/package.json` now carries the exact published
`@code-yeongyu/senpi` `2026.8.27` peer and development pins. The task engine
must remain synchronized with the Senpi adapter and native package so optional
peer resolution cannot select a stale engine release.

## 2026-08-20 — Export the canonical notice-box visual contract

The package now exports one `buildNoticeBox` helper and `NoticeSpec`-shaped types for Senpi-coupled adapters. It reproduces Senpi's canonical `Box(1, 1, customMessageBg)` contract while the pinned host package does not export its own builder.

Keep transcript notices on this helper. Compact task/tool/status rows remain on their purpose-built renderers.

## 2026-08-18 — Route category selection guidance to the caller

The task tool description now shows the caller-only selection gates for quick and unspecified
categories before a child is spawned. Those gates no longer enter the child prompt, while each
category's worker-directed execution context remains unchanged.

Keep caller guidance on builtin category definitions and render it only from the task description.
`promptAppend` is reserved for instructions the spawned worker can act on.

## 2026-08-06 — Make batch contention coverage scheduler-independent

The batch-admission contention test now injects the typed `contended` lease result directly instead
of depending on 40–120 ms renewal timing. The real renewable-lease behavior remains covered in
`admission-lease.test.ts`; this test is responsible only for proving that a contended acquisition
defers the entire suspended batch without mutating records.

Keep this separation when refactoring admission tests. Reintroducing wall-clock lease expiry into
the batch policy test makes the Windows CI result depend on scheduler pauses rather than behavior.

## 2026-08-12 — Export the shared child progress projection

The package root now exports `createChildProgress` and `ToolProgressDetails` so the OmO Senpi RPC
bridge and the terminal status UI derive live tool, assistant-line, turn, and token progress from one
implementation.

Do not fork the progress grammar or token tracker in downstream adapters; child event interpretation
must remain shared with the task TUI.

## 2026-08-12 — Expose narrow runtime subpaths for packaged adapters

The package now exposes focused subpaths for builtin agents, category resolution, renderer text,
task renderers, and RPC spawn helpers. The OmO Senpi main bundle uses these subpaths so its lazy task
sidecar can own the full task engine without the root barrel pulling every runner into both
artifacts.

Keep the root export for task-component consumers, but use the narrow subpaths from non-task adapter
components. Reintroducing root runtime imports there defeats the split-bundle size guarantee.

## 2026-08-12 — Bound transcript source reads

Task output now reads at most 1 MB of transcript source data, preserving file head and tail content
and propagating source truncation into the returned transcript details. Multi-file child sessions
read only the first and last session files within that shared budget.

Keep the source-read budget ahead of parsing and rendering. A render-only character cap does not
protect the parent process from loading and materializing arbitrarily large child logs.

## 2026-08-12 — Never sweep a live sibling session's children in a multi-session host

`reconcileOnSessionStart` treated every resident record carrying THIS host pid but absent from the
calling session's registry as a crashed-process orphan. In a multi-session host (one shared senpi
process running one engine + one registry PER session over a shared store, e.g. the OmO desktop rpc
child) that description also fits a live sibling session's children, so a sibling `session_start`
reclaimed them and marked each `in-process` record `lost` with "in-process task from a previous
process cannot be reattached" while the child kept running; its real completion then landed as
`late_transition_ignored`. Observed in the desktop dev instance: six `explore` children
(`st_019ff430..435`) spawned at 04:17:43-45Z were destroyed at 04:19:04Z by another session's start.

The cross-session legacy loop now defers a same-process sibling (`deferred` / `foreign_live_owner`)
instead of reclaiming it; ownership stays with the session that actually holds the handle.

Keep this guard scoped to the cross-session loop. The global sweep (`parentSessionId === undefined`)
deliberately still loses a same-pid resident with no live handle: that is the single-session CLI
crash-recovery path, and an in-process child genuinely dies with its engine there. Records with no
`host_pid` or a dead foreign owner are not siblings and must stay sweepable.
