## 2026-10-09 - Bound suspended-child cleanup and protect session startup (#9350)

Rollback preparation maps `failure_kind: "suspended_unresumable"` to R0's `session_unavailable`, keeping the `suspended_unresumable:<cause>` error text. The R0 contract fixture checks the failure kind and the other closed enum fields, including nested model, isolation, owner and run-stat fields. Preparation reports open strict closure obligations in its return value and warning log, naming the affected tasks and warning that the old daemon session may still be running.

Rollback is not blocked on background closure. Older binaries keep the ended record visible but do not keep retrying the strict close. A newer binary resumes those retries only if the obligation field survived: an older binary rewriting the record can drop the field. The rollback warning is printed on stderr as well as included in the JSON report.

An unconfirmed local stop now keeps its existing expiry claim and follows the deferred-revival backoff: 5, 15, 30, 60, 120, then 300 seconds between attempts, capped at 300 seconds. Recovery still checks every five seconds, but intervening ticks do not rewrite the record, append another claim event, or signal the child. A failed stop remains nonterminal until the existing stop path confirms it.

Strict daemon closure retries run in a session-scoped background pass, one pass per lifecycle, rather than blocking `session_start` and its subsequent TTL sweep. A timed-out close retains its in-process identity reservation until the transport settles; repeated startup/cleanup calls cannot accumulate hung requests for the same old session. TTL retains strict obligations until their matching confirmed close clears them. Because the pass is scoped to the owning session, a strict close is retried only when that session starts again or runs its cleanup: if the session is never reopened, its old daemon session is not closed by retry.

The lifecycle fixture now observes every terminal status and reconstructs the observed store, manager and notifier on restart. Tests cover parent shutdown during the budget, at the locked expiry claim, and after the claim (one buffered result); unconfirmed local-stop backoff; stale residency and closure identities; and startup with hung own/foreign obligations. Removing either parent guard, the residency-claim guard, or closure identity comparisons now fails the corresponding regression.

## 2026-10-09 - Suspended children recover while their parent is still live (#9350)

The lifecycle now observes the adapter's existing store-mutation channel. A manager `onParked` event, daemon-loss park, or reconcile deferral immediately attempts scoped revival through the existing admission lease, residency claim and `reviveClaimed`; there is no second respawn path. Observation runs after the synchronous park/forget operation.

Only `pending` and `running` children in `persisted_only` or `rpc_detached` qualify, and only while the registry identifies this engine as their live parent owner. All suspension reasons qualify, including legacy records without a reason. Terminal statuses (including `interrupted` and finished idle evictions), explicit pending user cancellations, and live foreign owners are excluded. Shutdown/disposal stops supervision; an absent parent's children keep their session-start recovery behavior.

`LIVE_PARENT_SUSPENSION_BUDGET_MS` is 300,000 ms, with recovery checks every 5,000 ms. Five minutes matches the sustained interval in the existing deferred-revival policy and exceeds both the 1/4/16-second daemon-loss ladder and the usual 20-second generation-drain budget. The deadline belongs to the suspension episode, not `updated_at`, so failed retries cannot extend it.

At expiry, an atomic epoch/claim check fences the unfinished run against revival. In-process and child-process children use the existing destruction and confirmed process-stop paths. A failed stop is not falsely reported as confirmed. Failure uses the existing `fail` transition (`status: "error"`), `failure_kind: "suspended_unresumable"`, and `error_message` beginning `suspended_unresumable:<cause>`. The terminal run releases its queue/lane and residency; normal notification bookkeeping delivers one parent result and manager waiters settle.

Daemon-only contract change: an unconfirmed close no longer leaves the live parent waiting forever. The record fails while retaining `fallback_closing_child` with `requires_confirmation: true`. Cleanup and session-start recovery retry this durable obligation regardless of TTL age. Silence, refusal and timeout do not clear it. A late confirmed close clears only the matching socket/session/instance/routing identity, never the task's status or notification epoch. A timed-out request keeps its identity reservation until it settles; a refused request can be retried. Transcripts and partial output remain available.

The unconfirmed-close result tells the parent that the old session may still be running on an unreachable host, closing is being retried, and re-dispatch has no at-most-once guarantee: work may run twice, so side effects must be checked before re-running. A confirmed local stop carries no such caveat. Error records already leave live widget rows while remaining in `/tasks` history.

`lifecycle/live-parent-recovery.test.ts` covers immediate recovery, both local execution modes, unreachable and timed-out daemon closure, retry/restart persistence, late closure, both revival/expiry orderings, pending children, absent parents, and finished idle eviction with injected clocks and lifecycle/manager fixtures.

## 2026-10-09 - Cancelling a running child that never answers its abort no longer hangs (#9791)

`steering/controls.ts` awaited `handle.abort()` before it destroyed a running child (`task_cancel`), and before it recorded an interrupt. An RPC abort waits for the child's answer with no timeout, so a child that never answered held `task_cancel` (or the interrupt) forever. #9785 had bounded the destruction port and the idle sweep, but not this step.

The abort now goes through the same `withinTeardownBudget` as the destruction steps (10 s, `lifecycle/teardown-budget.ts`). Past the budget the step is logged with the task id and pid, and the cancel moves on to destruction. Destruction terminates the child: SIGTERM, then SIGKILL after the escalation window, waiting for the exit. A rejected abort is still logged and skipped as before. `SteeringPort.abortDeadline` is the injectable budget; production uses the default.

`steering/cancel-running-abort-budget.test.ts` uses a running child whose abort never settles:
- `task_cancel` completes, destroys the child and records `cancelled` once the budget expires;
- an interrupt completes and records `interrupted`.

Both hang on the unbounded abort. The budget is test-driven, so nothing waits on a wall clock.

Test tidy-ups from the #9785 review:
- The sibling-session sweep test is named for what it checks: one session's engine leaves a sibling session's handle-less child alone.
- `ResidencyRegistry.ownsRecord` takes `Pick<TaskRecord, "parent_session_id">`, so the omo-senpi adapter test needs no `as never` casts.

## 2026-10-08 - A child that will not stop no longer holds every finished child resident (#9785)

The idle reclaimer (`lifecycle/residency.ts`) skips a tick while a sweep is running, and a sweep only ended when every resident's teardown had finished. Each teardown step awaited the child with no limit:
- `abort()`: an RPC command whose answer the protocol client waits for forever.
- `terminate()`.
- `dispose()`.

So one child that never answered `abort` stalled the sweep. Every later tick saw the sweep still running and skipped, and finished children piled up resident until the session ended. A report measured 19 such children at about 2.2 GB each. Sweeps also ran residents one after another, so even a bounded slow child delayed the rest.

- `lifecycle/teardown-budget.ts` (new): `withinTeardownBudget` gives one teardown step at most `TEARDOWN_STEP_BUDGET_MS` (10 s).
  - That is longer than an RPC child's own SIGTERM-to-SIGKILL escalation (5 s) plus its exit observation (2 s), so a terminate still making progress is never cut short.
  - A step past its budget is logged with the task id and pid, and teardown moves on. A rejection still propagates as before.
  - The budget is an injectable lifecycle dependency, `teardownStepDeadline`.
- Bounded steps:
  - `lifecycle/shutdown.ts` `suspendHandle`, the idle park path: abort, terminate and dispose.
  - `lifecycle/destroy.ts` `teardownHandle`, the destruction port used by cancel, eviction and TTL.
  - Not bounded yet: the abort that `steering/controls.ts` sends a *running* child before it destroys it. That is follow-up work.
  - An RPC child whose abort hangs is therefore still terminated, which escalates to SIGKILL, and is parked.
- A finished child with no live handle in this process still held its resident slot until a session restart reconciled it, which measured 17 h for errored children. A typical case is a child whose session the host refused to open ("The task host refused the child session (open_failed)").
  - The sweep and `task_cancel` now park such a record directly (`parkHandlelessResident`), when nothing can still be running for it:
    - the record belongs to this engine's own session;
    - no daemon session;
    - no live child pid.
  - One process can host an engine per session, so `host_pid` alone cannot tell this session's record from a live sibling's. The new `ResidencyRegistry.ownsRecord` answers that; the omo-senpi adapter compares the record's parent session with the engine's current session, and a registry without it parks nothing.
  - A child whose teardown threw in this process is excluded (`LifecycleContext.failedTeardowns`), because a failed dispose is not a successful park. A later teardown that succeeds clears the mark.
  - Live QA through a real `senpi` hit exactly this case.
- `reclaimIdleResidents` reclaims each resident on its own, concurrently. One slow child no longer delays the others, and because every step is bounded, the sweep always settles and the next tick runs. Errored children were already terminal here; they are now actually reached.
- `task_cancel` on a finished child that is still resident here now stops its child and parks the record, and reports `released`.
  - The record is parked (`persisted_only` / `rpc_detached`), so the result stays readable and `task_send` still revives it.
  - Before, the call answered "is error, not running. No change." and nothing released the child short of a session restart.
  - A second cancel is a no-op. A child resident in another process is left alone.
  - Only a finished result is released. A cancelled, lost or killed resident belongs to destruction, which may still be in flight, so cancel leaves it to that path.
  - An interrupted resident is never released: it is resumable, and a resume can hold its slot before its handle exists.
  - A cancel that skips abort (DAG cancellation) never releases, so DAG behaviour is unchanged.
  - Mechanism: `lifecycle/park-terminal-resident.ts`, `TaskLifecycle.parkTerminalResident`, and the optional `DestructionPort.parkTerminalResident`. The new `released` cancel outcome is handled in `tools/control`, the renderers and `eval-handles/steer-refs.ts`.
  - Team deletion still ends a released member for good (`team/runtime.ts`).

Tests:
- `lifecycle/idle-sweep-stuck-child.test.ts`:
  - A stuck RPC resident ahead of a healthy one no longer delays it. Fails on `dev`.
  - A stuck child is terminated and parked once its budgets expire, and the sweep settles. Fails on `dev`.
  - An errored in-process resident is parked.
  - A handle-less errored resident (session never opened) is parked by the sweep.
  - A sweep leaves a sibling session's handle-less child in the same process alone.

  The budgets are driven by the test, so nothing waits on a wall clock.
- `steering/cancel-terminal-resident.test.ts`:
  - Cancel releases an errored resident, and a repeat is a no-op. Both fail without the change.
  - A cancelled resident is not released or torn down a second time.
  - A skip-abort cancel leaves a resident alone.
  - A handle-less errored resident is released.
  - One whose child pid is still alive is left alone.
  - A sibling session's handle-less child is left alone.
  - An interrupted resident is not released.
  - A foreign resident is untouched.
- `team/runtime-delete.test.ts`: deleting a team whose finished member was released still destroys that member once.
- `idle-park.test.ts`: now asserts each child's own step order instead of a global one, since residents are no longer serialized.

## 2026-10-05 - A process-runner child gets its own fallback chain (#9582)

`runners/rpc-process.ts`: a task child started as its own `senpi --mode rpc` process (`task.process_runner: "child-process"`, and every child on win32) now receives the fallback chain resolved for its category. When the engine advertises `retry_fallback_command`, the runner sends `set_retry_fallback` with the same profile a daemon-hosted child gets on `open_session` (`runners/retry-fallback-profile.ts`, now shared with `rpc-host/open-session.ts`). It sends it before the resumed session is switched in and before the first prompt, because senpi refuses it once the session has a turn. The engine holds it in memory only, so the user's settings file is never written, and a usage limit after a tool call now switches models inside the running session instead of ending the child.

The chain never holds a start up. If the engine refuses `set_retry_fallback`, or does not answer it (or `get_protocol_info`) within 10 s, the runner names the task in a warning and sends the first prompt anyway; the child then falls back only when a turn fails before any tool call, the same as on an older engine. A child that died meanwhile still fails on that prompt with its exit recorded, and its warning says the child exited instead of blaming the engine.

`runners/rpc/handle.ts`: a process child's events now go through the same early-event buffer the host runner got in #9518 (`rpc-host/handle-listeners.ts`). The manager subscribes only after `start` returns, and a fast first turn (a tool call and an in-session fallback hop included) used to finish in that window, so `tool_execution` and `retry_fallback_applied` never reached the task record and it kept naming the spent model. `rpc-process-early-events.test.ts` (both cases fail on `dev`): an observer attached after the first turn still receives it in order, and two observers attached together each get it once, with later events arriving live. Subscribers still run after the handle has recorded each event, as on `dev` and on the host handle, so a live observer reads current state (`lastAssistantText()` at `message_end`); the third case pins that order.

An engine without the capability gets nothing new and the user is told once. A child without a chain sends nothing, so its command stream is unchanged.

`rpc-process-fallback-chain.test.ts` covers the chain sent before the prompt, the chain sent before `switch_session` on a resume, a chainless child unchanged, and an older engine warned once. Three of the four fail on `dev`. The fake RPC child (`rpc/__fixtures__/fake-child.mjs`) answers `get_protocol_info` with `FAKE_CAPABILITIES` and can log every command it receives (`FAKE_COMMAND_LOG`).

## 2026-10-08 - Explicit task model pins are honoured or fail typed, and the record names the child's model (#9722)

A `provider/model:level` pin was planned verbatim, the in-process registry
context dropped the unresolvable id silently, and the child rode the settings
default while the record kept claiming the pin. `senpi/explicit-pin.ts` parses
the pin once with senpi's `resolveCliModel` and `manager/parent-registry-context.ts`
`provide()` now asserts the spec model instead of filtering it, matching resume;
`runners/rpc/model-admission.ts` and `rpc-host/open-session.ts` strip the suffix
with the same grammar, so a valid pin admits and sends the base id plus the
level. After start, the in-process runner and the host opener compare the
child's effective model with the pin and fail typed on a substitution, the
in-process mismatch disposes its session, and an unreadable host state fails
closed. A pinned child starts with `initialModelProvenance: "cli"`, and a
`:<service-tier>` pin is a typed `invalid_target` instead of a silently dropped
tier. Legacy records whose ids still carry a `:level` suffix resolve by their
canonical base on respawn.

`manager/manager.ts` start-time and runtime fallback specs refresh `resolvedModel`
to the attempt's own rung, so the post-start check no longer rejects the
fallback child it asked for. The record's new `effective_model` is stamped from
the child itself (`effectiveModel` on the managed handle: the in-process
session's model, the host's `get_state` model), kept current from the child's
assistant-message observations (`manager/observed-model.ts`), and surfaced on
the `started` result and in `task_output`.

Tests: `runners/explicit-pin.integration.test.ts` drives the real manager plus
in-process child against a fake provider whose isolated settings default is a
different model (honoured pin with record truth, typed refusal naming the pin
and the default route, late same-provider registration, tier rejection).
Mutation-verified: removing either post-start check or either suffix split
fails its test.

## 2026-10-07 - Resumed children retry deferred revival and settle unowned failures (#9498)

`lifecycle/host-session-revive.ts` extends the existing per-child single-flight
retry to the resumed session's own `capacity`, `lock_contended`,
`model_unavailable`, `session_unavailable`, `rollback_failed` and
`foreign_live_owner` deferrals. `lifecycle/deferred-revival.ts` uses the existing
`hostRetry` backoffs and scoped admission lease, excluding other children from
that attempt's admission while still counting them toward capacity. Every retry
re-reads terminality, kill intent, handles and ownership; a new claim or epoch
stops a stale retry.

`lifecycle/reconcile.ts` carries the initial live-owner exclusion into scoped
admission's fresh store selector too: filtering only the observed candidate
array did not protect a suspended record still owned by a live foreign process.

After the bounded retries, unowned model/session/rollback/lock failures become
`lost` through `markRecordLostForReconciliation` and the lifecycle destruction
port. The error and events name the last deferral and retry count. The adapter's
completion bridge observes the `lost` mutation and delivers the parent's notification.
Capacity and live owners remain suspended because the other side must release
them; daemon-hosted children are never lost. Configuration-only deferrals such
as `reattach_disabled` are not scheduled.

`lifecycle/deferred-revival.test.ts` exercises revival on the first retry,
exhaustion with terminal `task_output` breadcrumbs, capacity with the
`task_send` refusal policy, and daemon preservation, using fixture clocks and
pre-subscribed event promises rather than sleeps.

## 2026-10-07 - An eval handle's send and cancel replies come only from the post-engine check, and a rolled-back epoch is never issued again (#9562)

A: `eval-handles/steer-refs.ts` now holds send and cancel, and no task record or `taskSnapshot` is in scope there. Every reply comes from `eval-handles/run-after-engine.ts`. `fenceBeforeEngine` fences the ref and returns a `PriorRun` whose record is private. Its `reread` re-reads the task after the engine returned and yields a `RunAfterEngine`, which builds the reply (`delivered`, `phase`, `stale`). `steer-refs.ts` imports no `taskSnapshot`, so every send and cancel reply there goes through the re-read run (review: this is a convention of the module, not a type guarantee, since `deps.tasks.get()` still returns a record). `control.ts` keeps only result and output. `afterEngine` is gone from the exports, `SEND_HOST_STATUS` moved to `run-after-engine.ts` and `WATCH_HOST_STATUS` to `watch.ts`.

B: `rollbackDetachedRevival` records the epoch of a run it undid as `burnt_epoch` (persisted; `store/record-parse.ts` reads it back). `state/run-fence.ts` adds `nextRunEpoch(record)`: one above every epoch the task ever issued. Every site that issues an epoch uses it:
- revive (`buildRevived`);
- model fallback;
- fallback handoff;
- reattach;
- a self-resumed turn;
- the concurrency lease keys;
- workpool worker admission and reconcile.

A handle minted for an undone run therefore stays stale and never names a later run. The watch's terminal revision (`epoch * 2 + 1`) cannot collide with a later run either. A rollback that undid only a claim, where no run started, burns nothing. Workpool crash recovery (`workpool/dispatcher.ts`) rebuilds a recovered turn's worker from the task's own `run_epoch` instead of `binding - 1`, so a turn bound above a burnt epoch is dispatched after a restart instead of refused (`workpool/delivery.test.ts`).

`lifecycle/revive-rollback-epochs.test.ts` covers:
- the next revive starting above the undone epoch;
- a send through the undone run's handle being refused before it reaches the newer run;
- the burnt epoch surviving a reload from disk;
- a claim-only rollback taking the very next epoch.

On the previous sources the first three fail and the fourth passes. The table row that answered a cancel `cancel_pending` with a newer run started is dropped: a pending cancel blocks revive and steer, so that state is unreachable. The rollback-watch test now also asserts `host_status`.

## 2026-10-06 - The GPT-6 Astra DAG directives are a spot-check, not a replay (omo#8168)

`completion/dag-verification-directive.ts`: `ASTRA_DAG_VERIFICATION_DIRECTIVE` tells the parent to read the node's VERIFY output against the scope its prompt set, in both directions, and to rerun a check only when that output is missing, failing, or contradicts the scope; `ASTRA_DAG_RUN_VERIFICATION_DIRECTIVE` defers the combined checks to the run's verification node. The #9642 texts asked the Astra parent to reconstruct every node's scope and inspect every artifact, which on a model whose prior is already to verify broadly reproduced the per-node rerun loop the directive was meant to end. `DAG_VERIFICATION_DIRECTIVE` (every other receiver) is unchanged.

## 2026-10-04 - Package-local test runs get the hermetic home (#9578)

`test-support/warm-lazy-runtime.ts`, the package's own `bun test` preload, now installs the repo's hermetic home and agent dir before warming the lazy barrels, so `bun test` from inside `packages/senpi-task` can no longer start a task host in the real agent dir.

## 2026-10-04 - A fake RPC child in a test can no longer signal a real process group (#9546)

`handle-terminated-by-runner.test.ts` built its fake child with a literal `pid: 5532`. `handle.terminate()` went through the real `terminateRpcChild`, which probes and signals that pid's process GROUP (`process.kill(-5532, ...)`) on whatever machine runs the suite. On a macOS CI runner a foreign group 5532 existed: the probe got `EPERM` (counted as "exists") and the `SIGTERM` threw, which failed the v5.1.16 release-state PR. On a developer machine owning such a group, the test would really have sent it `SIGTERM`.

`createRpcChildHandle` takes an optional `terminateChild` (default `terminateRpcChild`, so production is unchanged), and the test injects a recording fake. Its assertions now also check the call it recorded. A guard test stubs `process.kill` to throw and asserts that terminating a handle over a fake child never calls it. With the old handle, both fail; with the fix, they pass. The other rpc tests with a literal pid (`handle.test.ts`, `handle-steer-delivery`, `handle-user-abort`) never call `terminate()`.

## 2026-10-04 - A warm host's first-turn events reach the task record (#9512)

`runners/rpc-host/handle-listeners.ts`: the manager subscribes a child's observers (transcript log, run stats) only after `runner.start` returns. A warm host can finish a whole first turn in that window, including an in-session fallback hop (`retry_fallback_applied`). The handle used to deliver those events to an empty listener set, so the task record kept the dead primary model and no fallback attempt. Events emitted before the first subscription are now all kept, with no cap, because a partial history would bring the gap back. They are replayed to every observer attached in that same tick, then released.

`handle-listeners.test.ts` covers:
- the replay to two observers;
- no second replay to a later observer;
- live delivery afterwards;
- a long first turn whose fallback hop is the first of 5,002 events, all of which still arrive in order.

The tests fail without the buffer and with a 1,000-event cap.

Review follow-ups (same change):
- Until the buffer is released it is the single ordered log. An event that arrives meanwhile, including one an observer causes while its own replay is running, is appended. An observer still replaying reads it through its cursor; only observers that already finished replaying get it live. So each observer sees each event exactly once, in emission order.
- A listener that throws during replay is reported (`onListenerError`, logged by the handle) instead of escaping `subscribe`, which runs after the child is already live.
- `clearActive()` releases the buffer, so a child that ends before anyone subscribes keeps nothing.

`rpc-process.ts` and `rpc-host/session-open.ts`: the one-time warnings now state the real limit. A process child, or a child on a host without `retry_fallback_profile`, still switches to its fallback models when a turn fails before any tool call (the manager's runtime fallback). What it loses is the switch after a tool call.

## 2026-10-04 - A daemon-hosted child gets its own fallback chain on open_session (#9512)

A child run on the shared task host never got its configured fallback models. `RpcRunnerSpec` had no field for them, the host session ran on the host's settings, and its in-session fallback refused to switch once the turn had made tool calls.

The rpc runner spec now carries `fallbackModels` as `provider/model[:thinking]` selectors, through `modelSelector`, shared with the in-process runner. They are set on a fresh start in `runner.ts` and on both respawn paths in `manager-respawn.ts`, which read the record. `open-session.ts` sends them as `open_session.retryFallback` (`{ modelFallback: true, fallbackChains: { <model>: [...] } }`). A host advertising `retry_fallback_profile` (senpi 2026.10.6, senpi#2672) holds that chain for that one session, in memory only.

**Who sees a change:** only children that have fallback models of their own. Today their chain is ignored; now they fall back through it. A child without fallback models sends no profile, so it keeps falling back through the user's settings exactly as before.

When a child's chain cannot reach it, the user is warned once, with no silent loss:
- **Older host:** a host without the capability gets no field, and `session-open.ts` warns once per runner, naming the host's engine version.
- **Process runner:** a per-child `senpi --mode rpc` process has no CLI, environment or classic-RPC way to receive an in-memory chain. `rpc-process.ts` warns once per runner that such children fall back only through the user's settings. omo-senpi passes its host warning hook to that runner too.

Tests:
- `rpc-host-retry-fallback.test.ts` drives the real `RpcHostRunner` against the fake host. It covers the chain on a capable host, no profile for a child without a chain, an older host (no field, one warning for two children), and a reopen carrying the same chain.
- `rpc-process-fallback-chain.test.ts` covers one warning for two process children with a chain, and none without one.
- `runner.test.ts` covers selector threading, and `host-session-park.test.ts` the respawn path.

Each source change goes red when reverted.

## 2026-10-03 - A kill is the one the runner issued; Windows external terminations are reported as crashes (#9471)

`runners/rpc/exit-mapping.ts` `classifyChildExit` decided a signal-less exit was a kill on Windows when the child's stderr held nothing but Bun's child-reaper advisory. A killed child's teardown also writes diagnostics there: the memory component's `memory shutdown drain step failed` (EPERM on a state rename) and `memory shutdown drain hit its budget`. Those made a real kill read as a crash (`killed=false`), and the Windows RPC e2e `kill_marks_error_killed_true` failed intermittently on unrelated PRs.

A kill now comes only from facts the runner owns: the handle's own `terminate()` (`terminationRequested`, passed as `terminatedByRunner`) or a POSIX signal. stderr is never read to decide it, and the Windows stderr heuristic (`hasOnlyWindowsStartupAdvisories`, `isWindowsExternalTermination`) is gone. **Behavior change:** on Windows, a child terminated from outside the runner (TerminateProcess, Task Manager, an OOM kill) exits with code 1 and no signal, exactly like a crash. It is now recorded as `status=error`, `killed=false`, with `RPC child exited unexpectedly (exit code N)` followed by the stderr tail. A process crash's message gains that lead line too, while a daemon session's exit keeps the host's reason as its whole message. A runner-issued signal-less kill reads `RPC child was terminated by its runner (exit code N, pid=…)`.

Tests: `exit-mapping.test.ts` covers a runner-terminated child with the memory EPERM and drain-budget stderr (killed), a child that writes "killed" on its own (crashed), an external Windows termination with and without the advisory (crashed), the spawn-error precedence, and the messages. `handle-terminated-by-runner.test.ts` drives the real handle: `terminate()` followed by a code-1 exit is killed, and the same exit without `terminate()` is crashed. The e2e keeps the external SIGKILL check on POSIX, where the signal is the evidence, and on Windows proves the honest outcome as `external_termination_reports_unexpected_exit`.

## 2026-10-03 - Task tool wording stops naming few-read investigations and small foreground children as delegation targets (#9499)

- `src/tools/task/description.ts`: the run_in_background guideline is "Spawn children with run_in_background=true." The deleted clause ("pass false only for a short child whose result gates your very next call") contradicted the GPT-6 preset's foreground rule and named a small child as a routine spawn; `run_in_background=false` stays documented in the tool description body.
- `src/category/openai-categories.ts`: the deep-low `Selection_Gate` now reads "Of the two deep lanes this is the default: the child settles its decisions from what it reads. When unsure, choose deep-low; a misrouted child returns `ESCALATE: deep-high` after one cheap attempt, and you re-spawn the same brief as deep-high with its findings." (the one-subsystem-plus-callers shape and "wide but mechanical work belongs here" are gone), and the deep-low description says "preferred over deep-high for 3D graphics, computer/browser use, CAPTCHA, multimodal, backend, logic, and algorithm work" without bold. Both strings are byte-identical to the omo-opencode twins.

## 2026-10-03 - A pending task_cancel waits when the host cannot list its sessions (#9450)

`finishPendingCancel` closes a child's host session before it marks a pending cancel finished (#9403). It decided whether there was a session to close with `sessionLive()`, and a `list_sessions` the daemon refused or did not answer read as an empty list (`runners/rpc-host/liveness.ts` returned `[]`). On a host that answers its probe but is too loaded to list, the cancel therefore finished, skipped the close, and left the session running until the TTL sweep. `liveSessionPaths` now reports a failed listing as an error, the probe (`lifecycle/host-session.ts`) keeps whether the listing succeeded and answers `sessionLiveness()` as `live`, `gone` or `unknown`, and `lifecycle/pending-cancel.ts` leaves the cancel pending on `unknown`, as it already does for an unconfirmed close. `sessionLive()` keeps its answer for reconcile, TTL and destroy.

## 2026-10-02 - OpenGateway defaults to unlimited provider concurrency

- `src/manager/concurrency.ts`: the native task allocator uses an unlimited OpenGateway provider default before the generic lane limit. Explicit model and provider limits still win, and the global admission limit still applies.
- `src/manager/concurrency-opengateway.test.ts`: exercises admissions beyond the generic limit, explicit caps and queued handoff, other providers' limits, global capacity, and lease cleanup.
- `docs/reference/omo-json.md`: documents the built-in default and override precedence. No user configuration changes are required.
## 2026-10-02 - A killed Windows child stays killed when Bun's reaper advisory fills its stderr tail (#9228)

- `runners/rpc/exit-mapping.ts`: on win32 a child ended by `TerminateProcess` exits with code 1 and no signal, and stderr that holds only Bun's `child reaper unavailable under Bun on win32 ...` advisory still counts as a kill. Bun prints that advisory once per terminated worker thread, and the handle classifies the last 4 KB of stderr (`client.stderrTail`), so with enough advisories the tail began mid-advisory, or the kill cut the last advisory mid-write; either fragment made the exit a crash, and the task ended `status=error killed=false` with the advisory as its error (the Windows RPC e2e `kill_marks_error_killed_true` check, timing-dependent). Those two fragments are now recognized: a cut first line that ends a full advisory line in the same tail, and a last line that is the start of the advisory. Any other text, whole or cut, still makes the exit a crash.
- Tests (`exit-mapping.test.ts`): 40 advisories through the 4 KB tail and an advisory cut mid-write both classify as killed (both fail before this change); a diagnostic among the advisories (cut by the tail, after them, or cut mid-write) still classifies as crashed, and POSIX is unchanged.

## 2026-10-01 - A child whose host connection drops resumes or fails within a bound; task_cancel really stops it (#9403)

Builds on #9406 (Dante-dan), which reports a recovery `continued` only after the host takes the continuation; this entry is the rest of #9403.

- `runners/rpc-host/transport-recovery.ts` + `handle-recovery.ts`: every lost-transport recovery runs under a bound (`TRANSPORT_RECOVERY_BOUND_MS`, 180 s, armed only by a closed connection, so a quiet healthy child is never failed). When the bound runs out first the child ends `error` with `transport lost: ...` (was: waiting forever on a reopen that never answered), its lane lease is released, and a connection a late reattach still produces ends the session on the host (abort + `close_session`) instead of being adopted, so the child's own processes end with it. The exhausted-retries exit carries the same readable reason instead of `transport_gone`.
- `task_cancel` on a child whose connection is down answers `cancel_pending` ("cancel requested, child unreachable", also on `task_output`) instead of a false `cancelled`. The stop is applied on the recovered connection before anything else (no continuation is sent); only then is the record `cancelled`, the child torn down and its lane released. Cancelling a child this process holds no handle for (parked, or let go) now closes its session on the host (`lifecycle/destroy.ts`), and a cancelled task releases every lease it holds at any epoch (`TaskConcurrency.releaseTask`).
- `task_send` to a parked child that was still `running` reopens its session and delivers the message as a follow-up. Before, the send reserved the run's next lane slot and the revival's reattach then refused that same slot, so every send answered `lane_capacity` even on an empty lane. A child that ended `transport lost` answers `not_continuable` naming the loss.
- Lane leases are held only in the parent's in-memory lane manager (`manager/concurrency.ts`); none are persisted, so a parent restart already starts with none. A dead child's lease is now released by its bounded failure or its cancel, without restarting the parent; a live child's lease is never touched.
- Tests (real unix sockets to the fake host, a hand-driven recovery clock, no sleeps): `rpc-host-transport-loss.test.ts` (socket close + rejoin, silent reopen -> `transport lost` + next child admitted, host restart with an unanswered continuation, the session process closed on the host, the quiet healthy child, the stopped host with a pending child), `rpc-host-cancel-stop.test.ts` (cancel while unreachable, cancel of a parked live session) and one `rpc-host-host-park.test.ts` case (send to a parked running child). The fake host can give each session a real long-running process (`sessionProcesses`) and re-allow a withheld reply.
- Review round (#9407): an accepted cancel is final on every path. A pending cancel is durable (`cancel_requested` on the record): a parent that shuts down, or a host shard that crashes, before the stop lands no longer gets the child back - every revival (`lifecycle/reconcile-reclamation.ts` `reviveClaimed`, via `lifecycle/pending-cancel.ts`) finishes the cancel instead, closing the session on its host. A cancel accepted while the child is reachable marks the handle stopping first, so crash recovery that reopens the session ends it there rather than resuming it (a live repro: a cancelled child's shard crashed and recovery ran it on for ~20 minutes). The deferred stop always settles: a recovery that exhausts its attempts or is refused stops the child locally, the cancel's record write is covered by a `finally`, and the outcome tracker waits on the stop and writes `cancelled` itself if that write failed (`manager/pending-stops.ts`). `interruptTask` and a repeat `task_cancel` defer to the pending cancel; `task_send` refuses a child whose cancel is pending; a parent shutdown no longer waits out the recovery bound on such a child's abort. `task_send` to a parked running child (`steering/revive-running.ts`) fences delivery on the reopened run before and after the follow-up, and a refused message hands the child back parked with its lanes free. A deadline-edge result is reported expired (`withinBound`, the reattach race). `abort: "skip"` releases every lease of a task with no live handle. `task_output` shows the pending-cancel note only while the record is running. Steering reads the loss reason from the shared `state/transport-loss.ts`. Tests: `rpc-host-cancel-pending.test.ts`, `rpc-host-cancel-crash.test.ts`, `rpc-host-revive-running.test.ts`, `rpc-host/transport-recovery.test.ts`, a `cancel_pending` renderer row.

## 2026-10-01 - Empty project scaffolding does not select legacy runtime storage
## 2026-10-01 - Empty project scaffolding does not select legacy runtime storage (#9395)

- `store/project-state-directory.ts` keeps the agent-directory store when old
  observers have created only empty project directories. Populated legacy stores,
  a store root that is a symlink or a file, symlink entries, unreadable subtrees
  and malformed artifact filenames retain their existing location so live state
  and diagnostics remain reachable.
- A legacy store seen holding records is marked with `.in-project`, so it stays
  selected after its records are expunged and one project's records never split
  across the project and the agent directory.
- The resolver tests cover empty scaffolding, symlinked records, root symlink and
  file stores, and adoption that survives expunge. The malformed-artifact case
  goes through the real record store, and `omo-senpi`'s engine test composes the
  task engine over empty scaffolding and checks nothing is written into it. The
  DAG fixture marks its legacy store rather than depending on empty directories
  selecting it.
- Preserves and extends drakeo338's state-lookup work from PR #9367. The separate
  desktop observer fix removes the directory writer; this lookup change alone is
  not evidence that first-turn project writes are fixed.

## 2026-10-01 - Relay typed child computer permission events through task ownership (omo-desktop-app#1437)

- Add a separate, validated child extension-event channel for `computer.permission_required`; keep `AgentSessionEvent` and its listeners unchanged. Invalid permission records are dropped.
- Preserve denials received before the manager subscribes, forward daemon events across transport replacement, and retire subscriptions with their owning handles. The manager supplies trusted task ownership rather than accepting session identities from the child record.

## 2026-10-01 - Builtin chain rungs name thinking levels their models accept (#9378)

- `category/fallback-chains.ts`: `quick` opencode-go `minimax-m3` / `minimax-m2.7` drop `variant: "max"` (the child now inherits the
  `quick` lane's `low`); `unspecified-low` `mimo-v2.6-pro`, `qwen3.8-max-preview` and `mimo-v2.5-pro` go from `max` to `high`, the level
  senpi already clamped them to. Every other rung in this file and in `agents/builtin/fallback-chains.ts` names a level its catalog model
  accepts. A new header bullet records the deliberate divergence from `model-core`, which keeps `max` for OpenCode.
- `runners/builtin-chain-thinking-level.test.ts` drives `resolveCategory` -> the child's thinking level and child-local
  `retry.fallbackChains` into a real senpi `AgentSession` over the real catalog, faking only the logged-in providers: the `quick` child runs
  `minimax-m3` at `low` (was a silent clamp to `high`); repeated loads of every category an opencode-go plus xiaomi machine serves leave
  `fallback.log` free of `validation_warning` (four on the pre-fix chains); a user `models[]` entry with an unsupported level still warns once
  and still runs at an accepted level. The fixture's `assistant`/`streamMessage` helpers are exported for that last case.
- Pins updated to the new variants: `fallback-chains`, `category-routing-policy`, `unspecified-low-chain`,
  `in-process-runtime-fallback`, `manager-runtime-fallback`.

## 2026-10-02 - A split or repeated Bun reaper advisory is still a Windows kill (#9228)

- `runners/rpc/exit-mapping.ts` `hasOnlyWindowsStartupAdvisories` now matches the sentence senpi's `startHostChildReaper` writes (`packages/coding-agent/src/modes/rpc/child-reaper.ts`, ending `until this host exits`) as source text: one or more copies, each either whole on one line or split across lines at any point with only its own remaining words after it. Before, every line had to start with the sentence's first 119 characters, so a copy whose tail (`host exits`) arrived on its own line made the kill a crash (dev run 36881640066, `kill_marks_error_killed_true`).
- Any other text still makes the exit a crash: a real error line before or after the advisory, the advisory's head followed by other words, or a lone piece of the sentence with no copy started before it. Combined with #9443's rules for the 4 KB tail the handle classifies: when stderr fills that tail, its first line may be any piece of a copy the tail cut, and that copy's remaining words must follow; the last copy may stop short anywhere when the kill cut it mid-write (no line end after it), and otherwise once it reaches `until this`, as #9347 accepted.
- The N-copy tests used a guessed `until this runtime exits` ending; they now use the source sentence. New cases: the dev CI excerpt with `host exits` on the next CRLF line, three split points repeated beside a whole copy (both crashed on the base, killed now), and six advisory-plus-other-text shapes that stay crashed. The tail and mid-write tests from #9443 use the source sentence too.

## 2026-10-01 - In-process task children honor the caller's settings (#9353)

- `runners/in-process/runtime-fallback-settings.ts` `createRuntimeFallbackSettings` now takes the caller's settings source (`cwd`, `agentDir`, `projectTrusted`) and gives the child a private in-memory copy of the caller's global and project settings, replacing only the fallback policy: `retry.modelFallback`, `retry.fallbackChains` and `retry.fallbackRevertPolicy` come from the child's own chain, and the child's `maxRetries`/`baseDelayMs` override wins over both caller scopes. Before, the child got an in-memory manager holding only that policy (#6478), so `retry.provider.streamStartTimeoutMs`, `retry.provider.timeoutMs`, `httpIdleTimeoutMs`, `compaction.*` and `thinkingBudgets` fell back to the engine defaults (a 300 s first-event guard and a 300 s request idle timeout). Children now also honor the caller's compaction and thinking settings, matching process children.
- The project layer reaches the child only when the parent session trusted the project: `ChildSpec.projectTrusted` comes from the parent's `ctx.isProjectTrusted()` through `InProcessSessionContext`; an unknown decision counts as untrusted. Child writes stay in the in-memory copy, so the caller's settings files are never written.
- `in-process-caller-settings.test.ts` drives a real child through `InProcessRunner`: a caller `streamStartTimeoutMs` of 150 ms cuts a silent provider at 150 ms (on the base the guard never fired within 10 s), the request carries the caller's `httpIdleTimeoutMs` (base: 300000), a caller fallback chain is never used by a child without its own chain, a child with its own chain falls back only to it, and the caller's settings file stays byte-identical.

## 2026-10-01 - Repeated Bun Windows advisories remain external termination output (#9228)

- `runners/rpc/exit-mapping.ts` accepts any positive number of known Bun child-reaper startup advisory lines in the Windows exit-code-1/no-signal case. A different stderr line still classifies the child as crashed.
- Focused cases pin N advisory-only lines to `killed: true` and advisory lines plus one real error to `crashed`.

## 2026-10-01 - Windows child parity regression (#9274, #6709)

- `builtin-tool-parity.integration.test.ts` reloads the in-process child loader beside the `DefaultResourceLoader` policy used by process children and compares their builtin registrations directly. This removes both Windows CLI cold starts while pinning equal platform-specific builtin counts, exact names, and `web_search`; shared parent and session-default tool policy remains covered by the existing surface tests.

## 2026-09-30 - In-process task children load senpi's builtin tools (#9274, #6709)

- `runners/in-process/child-loader.ts` now uses senpi's `DefaultResourceLoader` with every path-loaded extension and resource disabled, so in-process children receive the same builtin extension factories as process children without re-running the parent's omo-senpi or project extensions. The child binds the loaded extensions so model-aware variants settle before its first request, keeps process-mode's `--no-ask-user` flag, and preserves category/agent allow and deny policy. Shared task/workpool tools now follow process mode; lead-only workflow/team and question tools remain excluded.
- `builtin-tool-parity.integration.test.ts` drives both execution modes through a local OpenAI-compatible provider and compares the actual tool payloads. Before the fix the in-process child had 11 tools versus 27 in process mode and lacked `web_search`; after bundle regeneration both payloads are identical.

## 2026-10-01 - deep-high runs GPT-6 Astra at high (#9372)

- `category/fallback-chains.ts` `deep-high` and `category/openai-categories.ts` (builtin default
  `chatgpt-subscription/gpt-6-astra`): variant `high` (was `xhigh`). The chain stays one Astra rung on all four GPT lanes and the
  gate stays `gpt-6-astra`, so the two deep lanes still never substitute each other's model.
- Tests that pinned `xhigh` for deep-high (`fallback-chains`, `openai-categories`, `openai-lane`, `gating`, `resolve-category`)
  now expect `high`.
- `manager/credential-failure.ts` `terminalFailureMessage`: a task that ends on a spent usage limit no longer ends on the bare
  provider error. The text adds `<provider>/<model> reached its usage limit, so this task stopped.`, then
  `No other model in its fallback chain could take over.` when `runtimeFallbackCandidates` leaves nothing (a deep-high child
  whose every Astra lane is spent), then the recovery: retry after the reset or point the category elsewhere in omo.json. A
  live deep-high run against a ChatGPT-subscription Astra that answers `access_terminated_error` returns exactly that text to
  the parent. `credential-failure.test.ts` covers the exhausted chain, a limit with rungs left (no exhaustion claim) and an
  ordinary error (unchanged).

## 2026-09-30 - The foreground task wait is bounded at 900 s (#8759 cluster, senpi#2323)

- `tools/task/foreground-wait.ts` `waitForForegroundTask`: the wait before a foreground child is promoted to background
  is now `min(prompt-cache safe-wait budget, MAX_FOREGROUND_WAIT_SECONDS)`, with `MAX_FOREGROUND_WAIT_SECONDS = 900`.
  The cap applies to both budget sources (`ctx.getPromptCacheSafeWaitSeconds()` and `PI_PROMPT_CACHE_SAFE_WAIT_SECONDS`).
  The budget is already TTL - 30 s, so a 5 min TTL still waits 270 s and a 1 h TTL waits 900 s instead of 3570 s.
  Without the cap, senpi#2323 (1 h TTL on the Claude SDK lane) would block a parent turn for up to ~59.5 min.
- `promoted.budgetSeconds` reports the effective (capped) wait. No separate raw-budget field: its only consumers,
  `execute-single.ts` and `execute-batch.ts`, pass it to `backgroundConversionText`, which renders the seconds the parent
  actually waited, and 900 s is still inside the cache-safe window.
- No-op today: every current budget is 270 s.
- `foreground-wait-cap.test.ts`: getter 3570 and env 3570 schedule the deadline at 900_000 ms and promote with 900,
  getter 270 stays at 270_000 ms, and the task tool notice states 900 s. Removing the cap fails the three 3570 cases.

## 2026-09-30 - deep-low leads with GPT-6.1 Sol at medium (#9214)

- `category/fallback-chains.ts` `deep-low`: `gpt-6.1-sol` (medium) on `chatgpt-subscription|openai`, then `gpt-6.1-sol-fast`
  (medium) on the same lanes, then the unchanged `gpt-5.6-sol` (medium, all four GPT lanes) and `gpt-5.6-sol-fast` (medium)
  rungs. The comment above the chain says why: 6.1 Sol is served only on the two OpenAI lanes, so 5.6 Sol keeps Copilot,
  OpenCode Zen and a registry without 6.1 on the lane at the same effort.
- `category/openai-categories.ts`: the builtin default becomes `chatgpt-subscription/gpt-6.1-sol` medium and
  `DEEP_LOW_GATE_MODELS` becomes `gpt-6.1-sol`, `gpt-6.1-sol-fast`, `gpt-5.6-sol-fast`, `gpt-5.6-sol`, so a 5.6-Sol-only
  registry still opens the lane. The task tool's listing annotation reads `(requires gpt-6.1-sol or gpt-6.1-sol-fast or
  gpt-5.6-sol-fast or gpt-5.6-sol)`.
- Tests: `fallback-chains.test.ts`, `resolve-category.test.ts` and `openai-categories.test.ts` pin the new chain, default and
  gate; two new `openai-categories.test.ts` cases resolve `gpt-6.1-sol` over `gpt-5.6-sol` on the subscription lane and
  the 6.1 Fast tier over plain 5.6 Sol; `gated-categories.test.ts` pins the new annotation. `scripts/manual-category-qa.ts`
  expects the gate's attempted model `chatgpt-subscription/gpt-6.1-sol`.

## 2026-09-29 - A refused launch spec is a typed start failure that names the file and its fix (#9208)

- `runners/rpc-host/daemon.ts` `loadDaemonLaunchSpec`: a `DaemonLaunchSpecError("launch_spec_insecure")` from
  `readDaemonLaunchSpec` becomes `HostUnavailableError("launch_spec_insecure")` with `fallbackAllowed: false` and the
  spec path. `rejectInsecureMode` is unchanged. Before, the error was not a `HostUnavailableError`, so `RpcHostRunner`
  wrapped it as `host_unavailable` with no reason and every surface said only "The task host is unavailable."
- `launch_spec_insecure` joins `HOST_START_FAILURE_REASONS`; `RunnerFailure.launch_spec_path` carries the path omo
  resolved itself (never child output). `manager/start-failure.ts` `describeStartFailure` names it, home-relative, in
  the public message with `chmod 644 <path>`, so the task record's `failure_reason` / `error_message`, the task tool
  result and the `team_create` error (`member '<name>' failed to start: ...`) all show it. Rollback to R0 drops the new
  reason like every post-R0 reason.
- `TaskDaemonPorts.launchSpecPath` lets a test point the ensure at a spec file on disk.
- `runners/rpc-host-launch-spec.test.ts`: a 0664 spec fails typed with the path and never falls back, the same spec at
  0644 opens on the host, and the record plus the team error name the reason, the path and the fix.

## category: quick ends with glm-5.3-flash and mimo-v2.6-flash, so a Z.ai-only or Xiaomi-only machine has a quick model (#9202)

- `CATEGORY_FALLBACK_CHAINS.quick` appends `zai|zai-coding-cn/glm-5.3-flash (low)` and `xiaomi/mimo-v2.6-flash (low)`
  after `claude-haiku-4-5`. Trailing keeps every provider set that resolved quick before on the same model. `low` is
  the lowest effort both accept: `glm-5.3-flash` maps `off` to null and `mimo-v2.6-flash` cannot disable thinking.
- `quick-single-provider.test.ts` resolves quick on a `zai`, `zai-coding-cn` and `xiaomi` registry (red on dev: no
  rung, `model_unavailable`) and pins that haiku still wins when a Claude login is present. `coverage.test.ts` now
  lists quick as usable on a Z.ai-only machine; `dead-chain.test.ts` and `fallback-chains.test.ts` list the new rungs.

## store: task state moves out of the user's repository (#9201, DESKTOP-31)

- `store/project-state-directory.ts`: `resolveProjectStateDirectory(projectDir, name)` puts a project's runtime state at
  `<agent dir>/projects/<folder>-<sha256 of the path, 12 hex>/<name>`, the agent dir being the first of
  `OMO_`/`SENPI_`/`PI_CODING_AGENT_DIR`, else `<HOME>/.omo/agent`. The path hash keeps two same-named projects apart. A
  `<project>/.omo/<name>` an earlier release created keeps winning, so in-flight tasks and resumable DAG runs recorded there
  stay reachable. The module imports only node builtins so QA drivers load it directly.
- `store/state-dir.ts` `resolveStateDir` uses it; an explicit `task.state_dir` still wins. Before, the default was
  `<project>/.omo/senpi-task`, an untracked folder in every repository a session ran in.
- Tests that pinned the old default read the resolved directory instead; `claim-race.test.ts` passes its environment to the
  spawned children so they resolve under the hermetic test HOME.

## lifecycle: a reopened parent reclaims its live daemon child when the host that owned it died (#9183)

- `lifecycle/reconcile.ts` `hasForeignLiveOwner`: a resident host-session record whose daemon session is still live stayed
  foreign-owned forever once the process that ran its task manager died. With one engine host per parent session that owner
  is the parent's own host, so killing it left the finished child recorded `running`/`resident` and every surface kept
  showing a working subagent. The record's own parent session now reclaims it when `host_pid` names a dead foreign process;
  any other session, and a live owner, still defer (`foreign_live_owner`), and a dead session still falls through (#8659).
  `host-session-revival.test.ts` pins both sides: dead owner -> resumed on the recorded session path, live owner -> deferred.

## docs: the operator surface names `adopt`, not `attach`

`AGENTS.md`'s operator-surface line is `omo daemon run|adopt|status|stop|handoff|gc|rollback-prepare`; every command but `run` and `adopt` covers every endpoint. Docs only.

## unspecified-low opens on Claude Sonnet 5.5; deep-low opens on plain GPT-5.6 Sol

`CATEGORY_FALLBACK_CHAINS["unspecified-low"]` and the builtin category config now lead with
`anthropic-subscription|anthropic|anthropic-api|github-copilot|opencode/claude-sonnet-5-5 (medium)`; every earlier rung
follows in its previous order, so the chain is 8 rungs. `CATEGORY_FALLBACK_CHAINS["deep-low"]` swaps its two rungs: plain
`gpt-5.6-sol (medium)` on `chatgpt-subscription|openai|github-copilot|opencode` first, `gpt-5.6-sol-fast (medium)` on
`chatgpt-subscription|openai` second, and the builtin config is `chatgpt-subscription/gpt-5.6-sol`. `DEEP_LOW_GATE_MODELS`
is unchanged (either tier opens the lane). `unspecified-low-chain.test.ts` proves order against a registry that serves every
rung at once: sonnet-5-5 wins, then mimo-v2.6-pro once it is removed, then grok-4.7. omo#9144.

## category, agents: builtin chains resolve only on the providers they list (#9146)

- A machine whose only provider was a gateway (OpenRouter, opengateway, a Vercel gateway) ran builtin categories and agents
  on that gateway's copy of the rung model, so an OpenRouter key was billed for Opus 5.5, GPT-6 Astra and, where the gateway
  spells it `claude-fable-5-1`, Fable. `delegate-core` no longer matches a rung on an unlisted provider unless the caller
  passes `allowUnlistedProviders` (only the omo-senpi `model_profile` matcher does), and `category/builtins.ts` gates and
  chain viability count only models served by a provider the chain lists (`resolver.ts` dropped the gateway-id unwrap
  `modelIdsOf`). A gateway-only machine now sees every builtin as unavailable and hidden; an explicit
  `categories.<name>.model`/`models` or agent `model` naming the gateway still resolves on it, and a mixed registry picks
  the listed provider. `category/listed-providers-only.test.ts` pins it on OpenRouter- and opengateway-shaped registries.

## lifecycle: the revival selector names the children it leaves suspended `deferred`

- `lifecycle/revival-selection.ts` / `residency.ts`: `selectRevivalBatch` returns `{ selected, deferred }` (was `overflow`): the
  suspended children past the parent's residency cap that wait for the next revival. Rename only; no behavior change.
  The rpc-host-sharding plan's audit forbids cap/overflow vocabulary in production code because per-parent task hosts
  have no shard limit, and this name read like one.

## manager: the auto execution-mode gate admits the task store before its first ask

- `manager/execution-mode.ts`: `ExecutionModeGateHooks.admit` runs before the gate's first ask, which may ensure the
  session's task host. With `task.default_execution_mode: "auto"` both the task tool (`tools/task/execute-spec.ts`) and
  the manager ask the gate before the host runner's own store admission, so an agent dir whose store index could not
  be written still got a host started before the spawn failed `store_index_unavailable`. A false `admit` answers
  `process` without asking and settles nothing: the spawn reaches the host runner, whose admission fails it exactly as
  before (same code, same record), and the next spawn asks again. `execution-mode.test.ts` pins it (rpc-host-sharding
  todo 14 B1; the duty chose failing over an in-process fallback because an unwritable index usually means a broken
  agent dir, and an in-process child would lose the index that `task_output`, cancel and resume rely on).

## runners: warm a task host with its `warm` command; export the store-index registration

- `runners/rpc-host/host-warmup.ts`: `warmTaskHost({ socket, cwd })` sends `warm { cwd, kind: "worker", context }` with
  the same `child`-role, temp-`state_dir`, `host_warmup` context the warm-up session carried, and answers `warmed` /
  `already_warm`. An engine that does not know the command (a refusal outside `host_draining`, `warm_failed`,
  `invalid_session_kind`, `invalid_session_context`, `invalid_path` - an older router answers `missing_session_id`)
  or cannot warm (`state: "unsupported"`) gets the previous warm-up session (`warm_up_session`). A known refusal or no
  answer rejects with `HostWarmRefusedError`. The temp directory is removed on every path. `warmHostSession` is no
  longer exported.
- `runners/rpc-host/host-request.ts` (new): `askHost(socket, request, timeoutMs)`, the one-connection request
  `liveness.ts` used privately, now returning refusals too; `liveSessionPaths` keeps its answers.
- Barrel: `registerStoreIndex`, `StoreIndexUnavailableError`, `warmTaskHost`, `HostWarmRefusedError`, `TaskHostWarmth`.
- `__fixtures__/fake-host*.ts`: a `warm` answer option and a fixed `socketPath` option.

Tests: `host-warmup.test.ts`.

## runners: warm a fresh task host with one throwaway session; the auto gate can warm without deciding (rpc-host-sharding PR-A)

- `runners/rpc-host/host-warmup.ts` (new): `warmHostSession({ socket, cwd })` opens one `worker` session with the
  `child` role, a private temp `state_dir` and session file, and the `host_warmup` context key, closes it at once,
  and removes the temp directory on every path (a refused open included). It is never retained. A host's first session
  compiles the extensions and loads the task runtime; measured, the first child on a fresh host opened in ~0.95 s and
  the second in ~0.15 s, and after a child-role warm-up the first child opened in ~0.12-0.3 s.
- `session-role.ts`: `HOST_WARMUP_CONTEXT` and `isHostWarmupSession(pi)`.
- `manager/execution-mode.ts`: `ExecutionModeGate.warm()` - a speculative ask whose success is kept like
  `ensure()`'s and whose failure is dropped (`hooks.onWarmFailure`), so a pre-warm can never settle the session on
  in-process; an `ensure()` during a warm joins it. `createExecutionModeGate(resolve, hooks)` gains
  `onEnsureFailure` for the notice a failed `ensure()` owes.

Tests: `host-warmup.test.ts` (new), `execution-mode.test.ts`, `execute-auto-mode-gate.test.ts`.

## A store index or sidecar waiter outlasts a slow durable rewrite

`store/record-lock.ts`: `withTaskRecordLockAsync` takes an optional `holderWaitMs`, the time ONE live holder
may keep the lock before a waiter gives up (default unchanged: 1 s, sized for a record read-modify-write).
`runners/rpc-host/durable-json.ts` exports `DURABLE_JSON_LOCK_OPTIONS` (10 s), and `store-index.ts`
(register, prune) and `shard-sidecar.ts` (write, register store) pass it: their holders rewrite and fsync
the whole file, and a loaded host (a windows-latest runner here) keeps a live holder on the index lock
past 1 s, so a waiter behind it failed `store_index_unavailable`. A stalled holder still times the waiter
out; the task record, workpool and lease locks keep the 1 s budget.

Tests: `runners/rpc-host/store-index.test.ts` (a live holder that keeps the index lock for 1.5 s: the
registration behind it waits and lands; it timed out at 1 s before). The 32-process x 25-store
throughput case runs on POSIX only: the host runner the index serves is never used on win32 (plan U6),
and the runner's 800 serialized fsynced rewrites take over 60 s there.

## AGENTS: the host runner opens children on their parent session's own host

`AGENTS.md` describes `RpcHostRunner` as opening a child on its parent session's own host
(`<shardRoot>/p-<shardKey("p", rootSessionId)>.sock`, `rpc-host/shard-socket.ts`) instead of the one machine-wide
host: new children ask `shardResolver`, a child inside a host passes `tree_key`/`shard_key` to its own children,
revival opens only the recorded socket, and `OMO_RPC_SOCKET*` serve the operator commands and thread tools only.
The operator surface now lists `gc` and `rollback-prepare`. No code changes.

## A host that dies inside the ensure cache window is re-ensured, not trusted

`runners/rpc-host/daemon.ts`: `ensureTaskDaemon` caches a successful ensure per socket for
`TASK_DAEMON_CACHE_TTL_MS` (5 s), and nothing dropped the entry when its host died: a spawn in that
window reused the dead answer, skipped the re-ensure and failed `host_unreachable`, and a live child's
reattach did the same until the window ran out. `forgetTaskDaemon(socket, instanceId?)` drops the entry
(kept when it already vouches for a different generation; the entry now records the generation its
ensure learned). `runners/rpc-host/live-children.ts` calls it on every observed transport loss, before
the reattach re-ensures. `runners/rpc-host.ts`: when the OPEN on a freshly ensured (non-recorded,
non-attach-only) endpoint fails `host_unreachable` - no probe answer, or the transport went away during
`open_session` - the start forgets the entry, ensures and opens once more.

Tests: `runners/rpc-host-ensure-cache.test.ts` (new: a spawn right after the host died re-ensures and
runs; a live child's reattach after its host died re-ensures instead of ending `lost`),
`runners/rpc-host/daemon.test.ts` (a loss of the cached generation re-probes, a stale generation's loss
does not).

## The task daemon ensure releases the engine's attach hold (#9041)

`runners/rpc-host/daemon.ts`: senpi #2242 makes `ensureHost()` return an attach hold - the readiness
connection stays open and the host counts the ensuring process as attached - until `release()` is
called. `ensureTaskDaemon` releases it once, right after its own capability probe (in a `finally`, so
a failed probe still releases) and before it returns: its result is cached and shared by the
single-flight, and the transient daemon would otherwise never start its idle window while omo runs.
Every ensure path (spawn, revival, reattach, pre-warm, shard routing) goes through this one call.
`lazy/senpi-barrel.ts`: `EnsuredSenpiHost.release` is optional, so the current engine pin (no hold)
keeps working.

Tests: `runners/rpc-host/daemon.test.ts` ("ensureTaskDaemon attach hold": a started host is released
after its capability probe, a reused one once, a throwing probe still releases, concurrent and cached
ensures release the one engine ensure once, a hold-less pin still ensures).

## A session the host parks parks its task record

`manager/manager-outcome.ts`: every park of a daemon session now reaches the record, not only the ones
the child initiates. When the HOST parks a session - its idle sweep (`session_parked`, or
`session_closed{idle_evicted}`) or a generation handoff (`session_closed{handoff_parked}`) - the record
parks at `rpc_detached` with `suspension_reason` naming the cause, keeps its status (a host park is
never a failure, and a completed child keeps its result), drops `host_pid`, and the run is released
(`forget`: lease, live handle, run stats), so `task_output`, revival and reconcile see a parked child
instead of a resident one whose outcome never settles. The park watch is armed per task with each
tracked run and outlives the run's outcome, so a child that stays resident after its turn is covered;
`OutcomeTracker.release` (called from `manager.forget`) ends it.

`runners/rpc-host/session-client.ts` + `exit-mapping.ts` + `handle.ts`: `HostSessionParked.reason` is
required and carries the host's cause (`HostParkCause`: `idle_evicted` | `handoff_parked`) as well as
the child-side `HostParkReason`s; `classifySessionExit` returns `{ disposition: "parked", cause }`.
New suspension reasons `idle_evicted`, `handoff_parked` (`task_output` explains both). What a revived
or resumed child does is unchanged.

`manager/manager-reattach.ts`: reattaching a TERMINAL child (a `task_send` revival of a completed child)
now restamps its identity from the reattached handle (`childIdentityOf`: `runner_kind`, `host_session`,
`pid`), so a child a handoff parked and a newer generation reopened names that generation's
`instance_id` and routing id instead of the old one. The host-world test fixture no longer stamps
`host_session` itself on every start; the manager does, as in production.

Tests: `runners/rpc-host-host-park.test.ts` (new: a fake host parks an attached child by idle sweep,
by `idle_evicted` close and by handoff; a completed resident child parked by the idle sweep; revival
after the park), `manager/host-session-park.test.ts` (host causes park the record; `release` and
re-tracking leave one watch).

## A holder that once failed to read its own start identity tries again

`store/lock-owner.ts`: the process's own start identity (written into every lock it takes so others can
prove it dead) was read once, and a failed read was cached as `unavailable` for the process lifetime -
every later lock of that process could then only be reaped once its pid was gone. A success is still kept
for the lifetime; a failure is now retried after 1 s, doubling to at most one minute between reads.

Tests: `store/lock-owner.test.ts` (new: retry schedule and a kept success; the interval caps at one minute).

## A reaped task record lock that Windows briefly refuses to unlink is retried

`store/record-lock.ts`: the reaper's unlink of a dead holder's lock threw a Windows sharing violation
(`EPERM`/`EBUSY`, while a scanner or the dead holder's last handle closes) straight out of the
acquisition. It now retries three times 25 ms apart, as team-core's reclaim does (#9034), and if the
file is still refused it waits on it like a held lock, so the waiter times out on that one holder instead of
throwing.

CI: `store/record-lock.test.ts`, `store/record-lock-reap-window.test.ts` and
`runners/rpc-host/durable-json.test.ts` join the root serial quarantine
(`script/root-test-serial-quarantine.ts`, both shard-2 commands in `ci.yml`, `bunfig.win2.parallel.toml`), so
the start-identity proof (kernel32 on windows-latest) and the win32 no-directory-fsync branch run in one
uncontended process on every OS.

Tests: `store/record-lock.test.ts` (one refused unlink is retried and the lock is taken; a lock that stays
refused times the waiter out and is left in place).

## A busy store index lock no longer fails an admission

`runners/rpc-host/store-index.ts`: registering a store that the index already lists is a read under the
lock and nothing else - no rewrite, no fsync, the file keeps its inode and mtime. A new entry writes
`last_seen` equal to `first_seen` (the field stays for version 1 readers; nothing consumes it).

`store/record-lock.ts`: a waiter now gives up only when ONE holder keeps the lock for the whole wait
budget (1 s), instead of after 1 s in total. Holders that each finish promptly hand the lock on, and a
waiter queued behind any number of them keeps waiting, so heavy contention no longer surfaces as
`store_index_unavailable` (32 processes x 100 new stores: 12-15 of 32 processes failed per run before,
none after); a holder that stops making progress still times the waiter out, and is never reaped while
it is alive. This applies to every task record, workpool, lease, sidecar and index lock.

Tests: `runners/rpc-host/store-index.test.ts` (a registered store is not rewritten; 32 processes x 25 stores
all present), `store/record-lock.test.ts` (a waiter behind live holders handing over every 100 ms for 1.5 s
acquires).

## The store index and shard sidecars survive a crash right after they are written

`runners/rpc-host/durable-json.ts`: `writeTextDurably` fsynced the staged file and renamed it over the old
one, but never fsynced the parent directory, so a crash right after the rename could lose the new name -
an admission whose store index entry had already read back could come back without it. The directory is
now fsynced after the rename (skipped on win32, which cannot open a directory for fsync; a filesystem that
answers EINVAL/ENOTSUP for a directory fsync is accepted as is).

Tests: `runners/rpc-host/durable-json.test.ts` (new: file fsync, rename, then directory fsync).

## A task record lock is reaped only after its owner is proven dead

`store/record-lock.ts` + `store/lock-owner.ts` (new) + `lifecycle/pid-liveness.ts` (new): the lock body now
also carries the holder's process start identity and hostname (after the pid, time and token lines every
earlier build wrote and still reads). A lock is removed by anyone but its holder only when that holder is
PROVEN dead - its pid is gone, or a live pid's start identity contradicts the recorded one (the pid was
recycled) - read synchronously (`/proc` on Linux, libproc and kernel32 through `bun:ffi`, no process
spawn). Age no longer expires a lock: a live holder keeps it however old it is (an unknown liveness,
another host, a legacy lock without an identity on a live pid all keep it), and a dead holder's lock is
reaped at once instead of after five seconds. The only age rule left is for a lock with no parseable
owner (its writer died between create and write). Reapers serialize on `<lock>.recovery` and unlink the
primary only while it is still the very lock they judged dead, which closes the window where a fresh
holder published between the judgement and the rename, plus a contender between rename and link-back,
could give two holders; a recovery lock left by a dead reaper is reclaimed on the same proof and fenced
by its token. The async holder still refreshes the mtime so older builds, which expire locks by age,
leave a long-held lock alone.

Tests: `store/record-lock.test.ts` (dead holder reaped fresh or old; a live pid's old lock - current or
legacy format - is never reaped; a recycled pid is; another host's is not; an empty lock only once stale;
a dead reaper's recovery lock is recovered).

## One revival selector: `selectRevivalBatch`

`lifecycle/revival-selection.ts` (new, exported as `selectRevivalBatch` / `RevivalSelection`) is the ONE
definition of which suspended children a resumed session revives and in what order: parent match,
`persisted_only` / `rpc_detached`, `pending` / `running` / `interrupted`, not killed; non-terminal first,
then most recently updated, tie-break task id; `residency_max_children` minus current residents
("unlimited" / 0 unbounded). `admitSuspendedBatch` (`residency.ts`) and the scoped revival
(`reconcile-revival.ts`) now use it instead of their own copies, and omo's host pre-warm asks it which
hosts the reconcile will actually need. No behavior change in the lifecycle.

## Every task child opens on its parent session's own host; the shared-host route is gone

`runners/rpc-host.ts` + `rpc-host/child-endpoint.ts`: `RpcHostRunnerOptions.shardResolver`, `storeDir`,
`ownHostSocket` and `onNotice` are REQUIRED. A new child always opens on the socket the resolver names;
the branch that let a runner without a resolver ensure the machine-wide `rpc.sock` (or whatever
`OMO_RPC_SOCKET*` named) is deleted - a JavaScript caller that still omits the resolver fails
`shard_identity_missing` before anything is ensured. `ensureTaskDaemon` without a `socket` remains for
the operator commands only. Each open stamps `tree_key` / `shard_key` (the shard key; parsed back from a
recorded `p-*` socket on revival) into the child's session context, so the child's own children reuse
the host it lives on.

A resolution marked `inherited` (a child inside its tree's host) or naming the session's own endpoint is
ATTACH-ONLY: `attachOwnEndpoint` sends one `get_protocol_info` (`probeHost`, injectable) and accepts any
generation that speaks this build's protocol - H1, or H2 after a handoff moved the public path - then opens
there. A silent endpoint or a protocol mismatch is `own_host_unreachable`; no ensure, no start, no
handoff, no per-child fallback. `createHostEndpointPort` now requires `ownHostSocket` and `onNotice`.
New start-failure reasons: `own_host_unreachable`, `shard_identity_missing`.

`tools/task/execute-spec.ts`: `ensureAutoExecutionMode(deps, targets)` skips the `auto` check when every
target of the call already runs in-process without it (an agent configured in-process, e.g. `explore`),
so such a call never ensures the session's host (IS-9). The kernel-tool grant path shares the skip; an
unsettled `auto` still reads as in-process, so no grant widens. A call with any unsettled or `process`
target settles the check once, before any spec, as before.

Tests: `rpc-host-own-endpoint.test.ts` (new: inherited attach on H1/H2, silent and mismatched probes,
foreign `host_socket`, tree/shard keys on the wire, missing resolver), `tools/task/execute-auto-mode-gate.test.ts`
(new), runner fixtures carry the required routing.

## The task record lock never deletes a lock another process holds

`store/record-lock.ts`: a waiter that found the lock file gone (released between its failed create and its
stat) treated it as stale and deleted the path - by then often a lock another process had just taken, so
two writers ran the read-modify-write at once and one's update was lost (16 processes registering 25
stores each in the store index lost up to 17 entries). A missing lock now just retries the create. An
expired lock (mtime older than `LOCK_STALE_MS`) is renamed away and removed only when the renamed file is
still the lock that was judged expired (device, inode, mtime and body); a lock a fresh holder published in
between is linked back. Each acquisition writes a token, and release removes the lock only while it still
carries that token, so a holder whose lock expired never deletes its successor's. The lock guards every
task record, workpool, admission lease, store index and sidecar write.

Tests: `store/record-lock.test.ts` (new), `rpc-host/store-index.test.ts` (16 writer processes x 25
stores, `rpc-host/__fixtures__/register-stores.ts`).

## A daemon child opens, reattaches and revives only on the endpoint its record names

`runners/rpc-host/daemon.ts`: `ensureTaskDaemon` takes an explicit `socket` (the operator commands keep
`resolveTaskHostSocket` when it is absent) and an `owner`; the ensured-host cache is keyed per socket; a
`start` on a `p-*`/`i-*` shard writes its `.meta.json` sidecar (`shard-sidecar.ts`, stores a previous
generation recorded are kept). An engine refusal naming `protocol`, `capability` or `legacy_host` stays
that reason (`isHostIncompatible`) instead of collapsing to `ensure_failed`.

`runners/rpc-host/store-index.ts` (new): `<agentDir>/rpc/task-stores.json` lists every task store that
opened a child on a host of that agent dir. It is append-only, written under its own lock (staging file,
fsync, rename) and read back; registering it is an admission precondition, so a failure is a typed
`store_index_unavailable` before any ensure or open. The sidecar's `stores` copy is best-effort
(`host_notice:store_register_failed`, once).

`runners/rpc-host.ts` + `child-endpoint.ts` + `reattach-port.ts` (new): `RpcHostRunnerOptions` gains
`shardResolver` (asked at every start), `storeDir`, `ownHostSocket` and `onNotice` (once per token and
endpoint). A spec's `hostSocket` (the recorded endpoint) wins over the resolver and never falls back to the
per-child runner: a host refusal there, whether the ensure or the OPEN answers it (a missing capability
at open is the only check the own endpoint gets), parks the revival `host_incompatible` or fails it
closed with its own reason, instead of reopening the retained session in a child process. A lost transport re-ensures only the recorded socket: an incompatible answer parks the
child `host_incompatible` (never reopened elsewhere), and the session's own endpoint
(`readOwnHostSocket(pi)`, `isOwnEndpoint`) is re-opened but never ensured - silent, the child parks
`own_host_unreachable`. `isOwnEndpoint` canonicalises both sockets the way the host stamps `host_socket`
(senpi #2245: the directory through its deepest existing ancestor, the missing tail re-appended), so a
shard whose `rpc/shards/` does not exist yet still matches across `/tmp` vs `/private/tmp` spellings.
`manager/manager-outcome.ts` parks the record (`rpc_detached` + the reason) when
the child parks itself; a host-driven park is unchanged.

`lifecycle/host-endpoint-reach.ts` (new): revival (`reviveClaimed`, `reconcileHostSessionOrphan`,
`parkHostSessionOnDaemonLoss`) ensures a silent RECORDED socket through `LifecycleDeps.hostEndpoint`
(`createHostEndpointPort`), outside the admission lease, and never the session's own endpoint.
`manager/manager-respawn.ts` hands the runner `record.host_session.socket`, so a pre-migration child
keeps living on `rpc/rpc.sock`. New suspension reasons `host_incompatible`, `own_host_unreachable`,
`store_index_unavailable`; new start-failure reasons `legacy_host`, `host_incompatible`,
`store_index_unavailable`. The omo-senpi task component wires these in a later change.

Audit: `host_session.daemon_pid` has no reader outside the record parser round-trip
(`store/record-blocks-parse.ts`) and no writer; `reconcile-crashed-resident.ts` and `dag/recovery.ts` read
the PARENT `host_pid`. No single-daemon reader needed changing.

Tests: `rpc-host-endpoint.test.ts`, `lifecycle/host-session-endpoint.test.ts`,
`manager/host-session-park.test.ts`, `rpc-host/daemon-shard.test.ts`, `rpc-host/store-index.test.ts`,
`rpc-host/own-endpoint.test.ts`.

## 2026-09-29 - Runtime fallback tries another provider first after an account-wide usage limit (#8296)

A task child that died on a usage limit (a Claude session or weekly limit, a monthly quota, a Codex usage limit) was handed to the next rung in list order, so a chain like `claude-fable-5-1 -> claude-opus-5-5 -> kimi-k3` on one Claude account spent a child start on Opus, which fails the same way, before reaching Kimi. `manager/credential-failure.ts` adds `usageLimitScope`: a limit that names a model, a model family or premium models is `model`-scoped and keeps list order, so a Fable-only weekly cap continues on Opus; any other usage limit is `account`-scoped and moves the spent provider's rungs behind every other provider's, keeping them as the last resort instead of dropping them. `runtimeFallbackCandidates` reports the scope as `limit`, and the `task_model_fallback` event records it as `usage_limit`. Credential rejections keep dropping the provider's rungs as before. The runtime-fallback QA driver gains `limit-account` and `limit-model` scenarios on a two-provider chain.

## `builtinCategoryChainCandidates`: a category's builtin chain against the live registry (#9111)

`category/resolver.ts` exports `builtinCategoryChainCandidates(category, registry)`: the category's builtin fallback chain (retired names mapped to their replacement) with every rung resolved to its first available provider, in chain order. `model-chain.ts` `availableChainCandidates` is the shared rung resolution `chainRungCandidates` now uses for the rungs after the selection. `resolveCategory` is unchanged: a user-forced model still keeps its own chain for task routing; memory sidecars append these rungs themselves so a refused pin is not their only model.

## A reattach continuation that is not delivered fails the turn (#9093)

`runners/rpc-host/handle.ts` `onTransportGone`: the `recoverLostTransport` chain now ends in a `.catch`. Its last step re-prompts the in-flight turn on the adopted port (`continueTurn`), and nothing awaited that promise unless a delivery was in flight, so a rejected continuation (`Timeout waiting for response to prompt` from a host that answered past the RPC deadline) escaped as an unhandled rejection that Bun printed over the parent TUI, while the turn stayed pending. The rejection is logged; a transport-loss error is left to the next recovery, and any other failure settles the turn with `promptFailureOutcome`, the same outcome `runPrompt` gives an undelivered prompt. `runners/rpc-host-recovery.test.ts` covers it with a host whose post-restart client rejects the prompt.

## The task daemon ensure releases the engine's attach hold (#9041)

`runners/rpc-host/daemon.ts`: senpi #2242 makes `ensureHost()` return an attach hold - the readiness
connection stays open and the host counts the ensuring process as attached - until `release()` is
called. `ensureTaskDaemon` releases it once, right after its own capability probe (in a `finally`, so
a failed probe still releases) and before it returns: its result is cached and shared by the
single-flight, and the transient daemon would otherwise never start its idle window while omo runs.
Every ensure path (spawn, revival, reattach, pre-warm) goes through this one call.
`lazy/senpi-barrel.ts`: `EnsuredSenpiHost.release` is optional, so the current engine pin (no hold)
keeps working.

Tests: `runners/rpc-host/daemon.test.ts` ("ensureTaskDaemon attach hold": a started host is released
after its capability probe, a reused one once, a throwing probe still releases, concurrent and cached
ensures release the one engine ensure once, a hold-less pin still ensures).

## A daemon-hosted child set aside by a busy or draining host is picked up again (#9069)

Three gaps kept a live or finished process child at `running` + `rpc_detached` until the next parent session start (real cases: a generation handoff, and a config reload that stalled the host briefly):

- `runners/rpc-host/liveness.ts` `daemonReachable`: an unanswered protocol probe on a socket that still accepts a connection (`busy-host.ts` `socketAcceptsConnection`, the #9067 rule) now reads as reachable, so `lifecycle/host-session-revive.ts` `reconcileHostSessionOrphan` no longer parks a live child as `daemon_unavailable` (`runners/rpc-host/liveness.test.ts`, RED on the old probe).
- `lifecycle/host-session-revive.ts` `retryDeferredHostSessions`, wired into `createTaskLifecycle().reconcileOnSessionStart`: every host-session record a reconcile deferred as `host_unreachable` or `host_draining` gets one background retry through the existing single-flight `reviveParkedHostSession` against its RECORDED session, on `HostSessionRetryPolicy.deferredRetryBackoffMs` (5 s .. 5 min, about 30 min total); it stops once the record is revived, not running, killed, or no longer `rpc_detached` (`lifecycle/host-session-revival.test.ts`).
- `manager/interrupted-turn.ts` `sessionTailFinishedText` + `manager/manager-respawn.ts`: a reopened session whose transcript already ends with a normal final answer settles the new handle with that answer (`adoptFinishedTurn` on both process handles), so the ordinary outcome tracking completes the record instead of waiting for an `agent_end` that already happened (`manager/manager-respawn-host-session.test.ts`). The answer is adopted only when `get_state` shows the reopened session idle (`turn-settlement.ts` `sessionIsIdle`: not streaming or compacting, no queued steering or follow-up); a finished-looking tail with a queued follow-up is left to its own `agent_end` (`runners/rpc-host/handle-continuation.test.ts`). The busy-socket check in `liveness.ts` connects with a 500 ms bound and destroys the socket at once, so it cannot hold a draining host open.

`runners/rpc-host/handle-reattach.test.ts` and `runners/rpc-host-recovery.test.ts` ("host dies and comes back"): the continuation wait is now registered before `host.restart()`. The reattach re-prompts before `restart()` resolves on a fast machine, and `waitForCommand` only resolves for commands recorded after it, so both tests timed out on every local run while passing on CI by timing.

## A fallback start queued behind a full lane is reported as queued (#9069)

`manager/manager.ts` `#advanceStartFallback`: when a start-time `model_unavailable` walks the chain onto a model whose lane is full, the enqueued launch now records `start_queued { model, queued_at, queue_position }` on the record and a `task_start_queued` event, `#launch` returns the queue position, and `start` answers `status: "pending"` with `queue_position` instead of `running` with no child behind it. `#launchRuntimeFallback` clears `start_queued` when the slot is granted. `tools/output/snapshot.ts` surfaces `start_queued` in `task_output` while the record is running. `manager/start-failure-model-fallback.test.ts` covers it (RED on the old manager: `Expected: "pending" Received: "running"`).

## A task record follows the child session, not the first agent_end (#9069)

`src/runners/rpc/turn-settlement.ts` (new) is shared by both process runners (`runners/rpc/handle.ts`, `runners/rpc-host/handle.ts`): the outcome of a non-retrying `agent_end` is held until senpi's `agent_idle` (emitted only when no settle-time continuation started and no session work is pending), dropped when another run starts (`agent_start`), and a user abort still settles at once as cancelled. A child exit settles any held outcome. A TTSR interrupt followed by its corrective nudge therefore ends with the continuation's result instead of `error: This operation was aborted` (`runners/rpc-host/handle-continuation.test.ts`, RED on the old handle).

A run the child starts on its own after its turn settled (a monitor or background job woke it) resets the handle's turn and fires `onSelfResumed`; `manager/self-resumed-turn.ts` (new) reopens the settled record under the next `run_epoch` (the same `buildRevived` a `task_send` revival uses), marks `resumed_run_epoch`, re-arms outcome tracking, and `completion/notification.ts` labels that completion `task completion (resumed turn)` (`manager/manager-self-resumed-turn.test.ts`).

`runners/rpc-host/handle.ts` `park`: a session the host parks is idle on the host, so an outcome still held for `agent_idle` settles there. Test fixtures (`fake-host.ts`, `fake-child.mjs` and hand-emitted `agent_end` in handle tests) now follow `agent_end` with `agent_idle` as senpi does.

## A busy task host makes a child start wait, not fail (#9067)

`src/runners/rpc-host/busy-host.ts` (new) `waitOutBusyHost` wraps `RpcHostRunner.start` (`src/runners/rpc-host.ts`): the session path is chosen once per start, and an attempt that met a host whose loop is blocked is retried at that SAME path with backoff (1, 2, 4, 8, then 15 s) inside `admissionWaitMs`, with one `host_busy` runner note per episode. Three failures count as busy: the ensure refused `host_busy` (senpi's `HostEnsureRefusedError`, now classified by `ensure-failure.ts` and carried as `HostUnavailableReason`/`HOST_START_FAILURE_REASONS` `host_busy`), `HostSessionClient.open`'s protocol probe went unanswered while the socket still accepts a connection (`socketAcceptsConnection`; a refused socket stays `host_unreachable`), and an `open_session` the host never acknowledged (`open_timed_out`). After such a timeout the path answering `session_path_in_use` means the earlier open is still being built, so it is retried too; the host attaches an open for a path it already hosts, so a late first open is adopted, never duplicated. A fresh start whose path is held elsewhere, and a dead host, still fail at once. `src/runners/rpc-host-busy.test.ts` covers each case (RED on the old runner: 5 of 8 failed).

## A host lost during open_session reports host_unreachable (#9020)

`HostSessionClient.open` (`src/runners/rpc-host/session-client.ts`) now classifies an `open_session` rejection with senpi's exported `isTransportGoneError`: when the host went away with the open in flight it rejects with `HostUnavailableError("host_unreachable", fallbackAllowed: false)` instead of handing senpi's `RpcTransportGoneError` to `toOpenFailure`, which returned it untouched and let `openTaskHostSession` record a `session_unavailable` failure with no reason. Typed open refusals keep their codes. `src/runners/rpc-host/open-session-transport-loss.test.ts` drives the real engine client against the fake host with the open withheld and the host crashed, at the session client and at `openTaskHostSession` (RED: raw `rpc_transport_gone`).

## An exhausted runtime fallback chain is recorded in the task transcript (#8301)

`manager/manager.ts` `#tryRuntimeFallback`: when the live child fails with no candidate left and its record shows at least one hop (`fallback_attempts` longer than one), the manager appends `retry_fallback_exhausted` (`chain_key` = the requested model, `last_error` = the failure message) before the terminal transition. Senpi's own retry emits that event only while its chain key is still armed, so a final rung reached through a native hop failed with no exhaustion record. A handle whose child already emitted the event (`#nativeFallbackExhaustions`) is not recorded twice. `src/manager/manager-fallback.test.ts` covers the native-hop case (RED on the old manager). The live driver `packages/omo-senpi/scripts/qa/task-runtime-fallback-e2e.mjs` now runs every scenario on the in-process, child-process and host-session runners and checks the record names the runner it expected; the host-session runs use a sandbox copy of the plugin whose daemon launch spec lists the mock provider, and stop that daemon before the sandbox is removed.

## A TTL tombstone belongs to the sweep that wrote it until that sweep's close settles

`lifecycle/ttl.ts`, `store/expunge-owner.ts` (new): every tombstone now names the sweep attempt that
wrote it (`ExpungeOwner`, `<taskId>.json.expunging.owner`), and only that attempt restores or deletes it
(`completeExpunge`/`restoreExpunging` take the owner; `completeExpunge` now reports whether it deleted).
Crash recovery takes over (`takeOverExpunging`) only tombstones whose owning process is gone: a second
sweep used to mistake a live sweep's tombstone for a crashed one and restore it, a revival then claimed
the task, and the first sweep's late close and unconditional deletion killed the revived run and erased
its record. A record recovery restores is not swept again in the same sweep, and a throw while ending a
child restores the owned tombstone before propagating.

`lifecycle/host-session-close.ts` `closeHostSession` tells a refusal from a close still in flight when
`hostCloseTimeoutMs` passes. TTL keeps the tombstone (the record stays unrevivable) while that close is
in flight and deletes or restores the record once it settles: restoring at the timeout let a revival
start and the late close then end the revived run's session.

`manager/manager-reattach.ts`: a revived handle attaches only while the record still holds the
`residency_claim` and run epoch it was launched under, so an older revival that succeeds after a newer
same-epoch claim no longer attaches on the newer claim (which the newer revival's failure would then roll
back under a live handle). A record without a token (written before this change) keeps the old check.

`manager/manager.ts` `#failStrandedHandoff`: a failed handoff now clears only the handoff marker, and
`#keepUnclosedChild` moves `fallback_closing_child` into the record's own identity in one write.
Clearing both first left one committed state naming no session; a parent that died there left recovery
marking the task lost while the failed rung's session kept running.

Tests: `ttl-expunge-owner.test.ts`, `runtime-fallback-rejected-close.test.ts`, and an obsolete-success
case in `revival-claim-fence.test.ts`; each fails with its fix reverted. `runtime-fallback-live-close`
no longer leaves an unawaited `AbortSignal.timeout` wait behind in its acknowledged variant.

Follow-ups found while reviewing the above:

- `manager/manager-reattach.ts`: a reattach rejected because another owner holds the task (claim not
  held, claim superseded, task already attached) now only detaches a revived daemon-session handle. That
  handle is attached to the task's one daemon session, which the other owner may be using; discarding it
  sent `abort` + `close_session` and ended the other owner's run. A rejected process child, spawned for
  that attempt alone, is still ended.
- `store/expunge-owner.ts`: the owner file is written to a staging name and renamed into place under the
  record lock, and an owner file that does not parse counts as no owner, so a torn file can never block
  every later recovery (other read errors still surface).
- `lifecycle/expunge-attempts.ts` (new): an attempt owned by this process is live only while it has work
  in flight here (the sweep, or a pending close it left). A sweep that threw, or a late close whose
  completion failed, no longer strands its tombstone until the process exits: the next sweep takes it
  over. The late-close completion catches and logs its storage errors instead of leaving an unhandled
  rejection, and a confirmed close is not turned into a refusal by a failure to record its event.
- Crash recovery keeps `dev`'s rules from #8992: an unreadable tombstone still finishes phase 2, and only a
  daemon session is closed after a crash, never a process pid from an old tombstone.

Tests: `manager-reattach-rejected.test.ts`, plus torn-owner and failed-late-completion cases in
`ttl-expunge-owner.test.ts`; each fails with its fix reverted.

## A child that starts after its task was stopped, and a child whose cleanup rejects

`manager/manager.ts`: every launch now re-reads the record once `runner.start()` resolves and keeps the child only
while the task is still `running` on the same run epoch and owner (`#ownsLaunch`). This covers the primary launch,
the `model_unavailable` walk (`#advanceStartFallback`, whose epoch advance is now one fenced `mutate`) and the
runtime-fallback launch. A cancel, interrupt or another owner that landed during the start used to let the late child
subscribe and stay resident on the stopped task (an interrupted primary launch, a runtime-fallback launch), or let the
walk rewrite a cancelled record onto the next model. A stale child is discarded instead: this run's own cancel still
tears it down through the destruction port, any other stale child is discarded directly, and neither is attached to
the task (only a child whose cleanup rejects is kept, as below). `manager/manager-reattach.ts` likewise refuses a respawned child whose running task ended while it respawned.

A child whose cleanup rejects may still be alive, so it keeps a cleanup owner on the record its run ended (epoch-fenced;
a newer run's record is never touched, a `child_cleanup_failed` event is appended instead). A child reachable from
outside this process has its pid or daemon session written back and is ended by the destruction port's orphan path
(`reconcile_lost`, added to `steering/types.ts` `DestructionCause`). An in-process child has neither, so it becomes a
cleanup owner: its record stays `resident` (`mark_resident` when a cancel had already disposed it) and the lifecycle's
LRU eviction, idle reclaim, session shutdown and TTL see it through `getResidentHandle`/`residentTaskIds` and retry
its teardown. It is kept apart from the live children, so steering never reaches it (`task_send` answers
`not_continuable` instead of reviving it), and `manager.forget` keeps it: only a teardown that succeeds releases it
(`child-handle.ts` `releaseOnDispose`), so a retry that rejects again leaves the same owner for the next one.

`lifecycle/destroy.ts` `terminateOrphan`: a pid the orphan path has handled - signalled, or already dead - is now
cleared from the record (fenced on the same pid). It used to stay on the disposed record, so after the OS reused the
number the TTL sweep could signal an unrelated process. A `lost` record keeps its pid: TTL reads it as the pid-dead
proof, never signals it, and only retains the record while that pid is alive. Test: `lifecycle/orphan-pid-consumed.test.ts`.

`#tryRuntimeFallback`: the handoff write is also fenced on `status === "running"`. A cancel or interrupt that landed
between reading the failed rung's record and writing the handoff used to be rewritten into a handoff (epoch and model
advanced, marker set on the stopped record). The stop now stands: nothing is handed off, this run's lease is released
and waiters settle here, because the stop's own teardown may already have dropped the live entry the normal outcome
path would need.

`#tryRuntimeFallback`: a rejected `destroyResidentTask(..., "fallback_handoff")` (any rejection value, `undefined`
included) no longer escapes before cleanup or strands the task `running` behind this owner's pid fence. One fenced
write clears the handoff marker while this owner still holds that handoff; the task then fails ("Runtime fallback
could not close the failed model's child (...); <next> was not started.", event `task_fallback_teardown_failed`) only
from `running`, so a cancel that landed first stands, and the next rung is not started beside a child that may still
be alive. The failed child gets its cleanup owner (above) before its slot is released and waiters settle. Tests: `runtime-fallback-launch-races.test.ts`,
`launch-ownership-races.test.ts`.

## A child is ended only while its owner holds it exclusively, and only on a confirmed close

`lifecycle/ttl.ts`: an expired record's child (its daemon session, or its process) is now ended only
after the record is tombstoned, while no revival can see or claim it. A close the daemon does not
confirm puts the record back (`store.restoreExpunging`, new with `store.loadExpunging`) with its
residency unchanged, so it stays revivable and the next sweep retries; crash recovery applies the same
close-or-restore rule to tombstones a crashed sweep left behind. Closing before the tombstone let a
`task_send` revival claim the task between the liveness probe and the close, and TTL then closed the
session the revived run was using.

`lifecycle/host-session-close.ts` (new) `closeHostSessionConfirmed` is the one confirmed close:
refusals and a daemon that does not answer within `hostCloseTimeoutMs` (new lifecycle dep, 10s) count
as unconfirmed. TTL, orphan destruction and the closing-child obligation use it.
`lifecycle/destroy.ts`: a `fallback_handoff` teardown now also requires the failed rung's session to be
confirmed closed. The live handle's own teardown is best-effort and bounded, so it resolved even when the
daemon never acknowledged `close_session`, and the next model started beside the old session; the
handoff now fails the task instead and the old session stays on the record.

`lifecycle/residency.ts`: every residency claim writes a fresh `residency_claim` token.
`revive-rollback.ts` `holdsClaim` fences rollback, `markLost` and the new `disposeClaimed` on it:
reviving an interrupted or terminal task keeps its `run_epoch`, so the epoch alone let a failed revival
undo another revival's successful claim on the same epoch.

Tests: `revival-claim-fence.test.ts` (a failed scoped or `task_send` revival beside a same-epoch
winner), `runtime-fallback-live-close.test.ts` (real `RpcHostRunner` over the fake daemon, close
acknowledged or withheld), and a TTL-during-close case in `fallback-closing-obligation.test.ts`.
`#8932` (on dev) already made the production liveness probe list worker sessions.

## Each generation of a task owns only its own lease, handle and claim while an old rung closes

A reload can revive the task while runtime fallback is still closing its failed rung, so two runs of one
task coexist. `manager/manager.ts`: `#releaseSlot`'s per-task high-water mark skipped every lease below
the newest released epoch, so a revived run that finished first stranded the old rung's lease (and the
handoff's) for good; a lease that is still held is now always released. `#closingRungs` records the
closing rung's handle as well as its epoch, so steering hides and `#releaseSlotForTask` targets only
that handle: an interrupt of the revived run aborts it and releases its own lease, not the old rung's.
`forget()` releases a cancelled run's lease before it drops the live entry that names it. The next
rung is refused before it takes a slot if the task moved while the old rung closed.
`lifecycle/revive-rollback.ts`: a revival's rollback is fenced on the epoch it claimed, so a revival
that lost to a later one no longer detaches the winner's run. `lifecycle/ttl.ts`: an expired record's
own daemon session is closed before the record is tombstoned, and a close the daemon did not confirm
keeps the record for the next sweep instead of deleting its only pointer to a session that is still
open. Tests: `runtime-fallback-generation-races.test.ts` (the revived run completing, interrupted or
cancelled before the old close resolves or rejects, at concurrency two; two racing revivals), and a
retained-session TTL case in `fallback-closing-obligation.test.ts`.

## The closing rung's child is ended only on a confirmed close, by whoever owns the record next

`lifecycle/host-session-default.ts`: `defaultHostSessionCloser` discarded `closeHostSession`'s
`"unreachable"` answer (a refused attach or `close_session`), so every caller read a session that was
still open as closed. It now rejects unless the daemon confirmed the close. `lifecycle/fallback-closing-child.ts`
keeps `fallback_closing_child` on the record whenever the close is not confirmed (or the process
outlived SIGKILL), and `reviveClaimed` defers instead of launching beside it. The child is now an
obligation of every owner of the record, not only a revival: `destroy.ts` `terminateOrphan` ends it for
a cancelled, lost or non-revivable record, and the TTL sweep keeps an expired record until its child is
confirmed gone.

`reviveClaimed` re-reads its claim after the awaited cleanup, and `manager.respawn`'s `beforeLaunch`
refuses to launch when the task's status, owner, epoch or kill flag moved since the revival began: a
cancel that lands while a dead owner's handoff is being recovered no longer gets the next rung's prompt
sent. A rejected fallback close only drops the live entry that is still its own, so a reload that
revived the task meanwhile keeps its handle, and an in-process child whose record has moved on stays a
cleanup owner of this process. Tests: `fallback-closing-obligation.test.ts` (production closer and
probe over a real socket: refused close keeps the identity, a cancelled handoff is closed by the global
and the parent's reconcile, TTL retries), `runtime-fallback-revival-races.test.ts` (a reload during a
resolving and a rejecting close; a cancel during the recovery close in both scopes).

## A closing rung is never revived, a stale launch never runs or fails a newer run, and a crash mid-close leaves an owner

`manager/manager.ts`: while `#tryRuntimeFallback` closes the failed rung, steering's `liveHandle` no
longer returns that rung's handle, so an interrupt followed by `task_send`/`continueTask` in that window
cannot revive a child that is being torn down (it answered `continued` and the old close then deleted
the new run's live entry and stranded its lease). The fallback path only drops the live entry that is
still its own.

`manager/launch-fence.ts` (new): `ownsRun` checks status, epoch and owner, and `failOwnedRun` applies a
start failure in one locked write only while the launch's own run still holds the record.
`#launchRuntimeFallback` now checks ownership before starting anything (it checked `status` alone, so
another owner's epoch still got the obsolete next rung started), and both the primary and the fallback
start-rejection paths fail the task through `failOwnedRun`, so a stale rejection no longer writes
`error` onto a newer owner's run.

`lifecycle/fallback-handoff.ts`: the handoff moves the closing child's pid/daemon session into
`fallback_closing_child` instead of dropping it, and the fallback path clears it once the close
succeeds. `lifecycle/fallback-closing-child.ts` (new): `reviveClaimed` ends that child (session close
while the daemon answers, or SIGTERM/SIGKILL) before it launches the next rung, and defers if the child
may still be alive (see the section above for which answers count as confirmed). A parent that died between the handoff commit and the close used to leave the old
retained daemon session open beside the revived one.

Tests: `runtime-fallback-handoff-races.test.ts` (interrupt + continue during a resolving and a
rejecting close; another owner during the close; a stale next-rung start rejection; a rejecting close
interrupted or cancelled for a daemon and an in-process rung), `fallback-closing-child.test.ts`
(retained session closed, live process signalled, refused close defers), and
`runtime-fallback-crash-before-close.test.ts` (the crash on the real `RpcHostRunner` over the fake
daemon socket: one session left, the old one closed). `runtime-fallback-launch-races.test.ts` was split
into it plus `runtime-fallback-teardown-rejection.test.ts` and `runtime-fallback-cleanup-owner.test.ts`
(fixtures in `__fixtures__/fallback-launch-fakes.ts`) to stay under the 250-line ceiling.

## The failed rung's lease survives a stop during the handoff, and a lost handoff lets go of its run

The handoff record names the next epoch while the failed rung's child is still closing and still holds
its own lease. `cancelTask`/`interruptTask` released by the record's epoch, so they released the next
epoch (which no lease held yet), raised the release high-water mark, and the old lease was then never
returned: one lane slot lost for good. `#tryRuntimeFallback` now records the closing rung's epoch for
the length of the teardown and `#releaseSlotForTask` releases that one; the next rung's launch already
refuses a record that is no longer running and returns its own lease. A lost handoff fence
(another owner took the task at this epoch) used to return with the old subscription, live entry,
lease and handle still held; it now retires exactly those, releasing the handle with
`releaseSupersededHandle` (a detach for a daemon session), and never touches the winner's record or
session. Tests: `runtime-fallback-handoff-races.test.ts` (a lost fence, an interrupt and a cancel
during the slow close, at concurrency one).

## Runtime fallback forgets the closed rung's daemon session before the next one opens

`manager/manager.ts` `#tryRuntimeFallback` closes the failed rung's child and hands the task to the next
rung, but the record kept `runner_kind: "host-session"` and the CLOSED rung's `host_session` until the
next rung's spawn stamped its own. The next rung's child session runs the omo extension inside the
daemon, and its `session_start` reconciles the shared project records: since #8659 a resident
host-session record whose session is gone is an orphan, so that pass claimed the live parent's task,
reattached the closed session and moved `run_epoch`. The parent's real outcome was then dropped, the
task stayed `running`, and `omo -p` never exited (reproduced 2/2 live on a lapsed OpenCode Go key).

`lifecycle/fallback-handoff.ts` (new) names that span. `handOffToNextRung` builds the handed-off record:
the next model selected, the epoch advanced, the closed child's `pid`, `runner_kind` and `host_session`
dropped, and `fallback_handoff_epoch` set to the new epoch. `#tryRuntimeFallback` commits it in one
`store.mutate` fenced on the failing outcome's epoch and owner, BEFORE awaiting the failed rung's
teardown, so a reconciler that runs while the daemon is still closing that session already sees a
handoff behind its live owner's pid fence (the first push wrote it after the teardown, which left the
race open). `#recordSpawnFacts` and a reattach end the handoff; a start-fallback step inside it carries
the marker to its new epoch. #8659's session-liveness rule is unchanged for every recorded session.

`isFallbackHandoff` (marker equal to the run epoch, no pid, no daemon session) is the only pid-less
process record `lifecycle/reconcile.ts` revives when its owner died; every other pid-less record
(queued, or a workpool worker whose replay is refused by design) is lost as before, so no task parks
forever. `reviveClaimed` launches a handoff FRESH from its v1 spawn spec on the selected model: the
newest transcript is the failed rung's, and reopening it reported `resumed` while no turn ran. A
transient launch failure parks it `rpc_detached`. `manager/manager-reattach.ts` stamps a revived daemon
child's session (`recordSpawnedRunner`), as a fresh spawn does.

`manager/manager-respawn.ts` decided "the daemon re-joined a live session, do not nudge" from the
handle's own `attached` getter, which is true for every open handle, so a session reopened from its
JSONL never got its interrupted turn continued. Respawn now keys on the host's answer to the open,
`openDisposition` (#9003 on dev fixed the same defect; this branch adopts that field).

Tests: `runtime-fallback-host-session.test.ts` (the handed-off record carries no child identity and the
marker; a daemon-side reconcile during the failed rung's slow close defers as `foreign_live_owner`,
respawns nothing, and only the next rung's result lands), `fallback-handoff-reconcile.test.ts` (a
dead-owner handoff, swept by another session or by its resumed parent, opens a fresh session and
prompts it on the real daemon runner; a transient failure parks it; a stale marker and a dead workpool
worker end `lost`), `manager-respawn-host-session.test.ts` (a reopened session on the real daemon
runner is continued), `rpc-host.test.ts` (`openDisposition` for a retained and a reopened session),
and `manager-respawn-cleanup.test.ts` (a revived daemon child names its session).
`reconcileLegacyTerminal` moved to `lifecycle/reconcile-terminal.ts` unchanged.

## A host session reopened from its transcript continues its interrupted turn; post-reattach queries use the current port (#9003)

`manager/manager-respawn.ts` `respawnProcess` decided "re-joined a live session" from `isAttachedHostSession`, which read the handle's `attached` getter. That getter is connection liveness (`runners/rpc-host/handle.ts`), true after ANY successful open, so a daemon child whose session the host reopened from its JSONL (open_session answered `attached: false`) was treated as attached and never got `switchSession` + the one interrupted-turn continuation. The host's answer is now carried on the handle as `openDisposition: "attached" | "reopened"` (`HostSessionHandleOptions.openDisposition`, set by `RpcHostRunner.openChild` from `OpenedHostSession.attached` and updated when a reattach adopts a new port), and respawn keys on `openDisposition === "attached"`. The tail rule (`sessionTailNeedsContinuation`) still decides whether a reopened session needs the continuation, but `manager/interrupted-turn.ts` now reads the last CONVERSATION message instead of the literal last JSONL record: it walks back only over `custom:senpi.hooks.stop-state`, `custom:pi-rules.scan`, and `custom:senpi-memory.session-binding`. Live QA showed why: a killed host leaves the stop-state row after the interrupted tool result, and the reopening host appends the rules scan and memory binding before respawn reads the tail, so the old rule answered "answered" for every host reopen. A malformed record, `custom_message`, or unknown custom entry after the last message ends the walk with no continuation. Once the last message is known, the search back to the turn's opening user message walks past every non-message row (only a malformed record stops it, with no continuation), so a hook-written `custom_message` inside a continued turn can no longer hide the continuation prompt and trigger a second one. An unanswered user prompt followed only by those named bookkeeping rows now counts as interrupted and gets exactly one continuation across host reopen and in-process respawn. A turn that was already continued once is never continued again, even if it is interrupted again (by design). The continuation wording and the reattach backoff are unchanged.

`runners/rpc-host.ts` bound `getEntries`/`switchSession` to the client captured at open, so after a transport reattach both went to the dead port and threw `session_detached`. `HostSessionPort` now carries both queries, the handle serves them from its CURRENT port (waiting for an in-flight reattach), and the runner routes through the handle. RED->GREEN: `manager/manager-respawn-host-session.test.ts` (real runner over the fake host: `attached: false` + interrupted tail -> `reopened` and exactly one followUp prompt; `attached: true` -> `attached` and none; `attached: false` + completed tail -> none; interrupted tail followed by bookkeeping rows -> exactly one; answered tail followed by bookkeeping rows -> none; malformed final record -> none; a continued turn holding an unknown `custom_message` or `custom` row, re-interrupted and reopened by a restarted host -> one prompt in total; malformed record inside the turn -> none) and `runners/rpc-host-recovery.test.ts` (after a host restart both queries hit the new client, zero calls on the old one).

## A suspended child frees its lane slot (#8973)

`TaskManager.forget()` now releases the forgotten run's concurrency lease (`#releaseSlotForTask`). Suspension (session shutdown's `suspendHandle`, `parkHostSessionOnDaemonLoss`) forgets the handle first, and the outcome tracker's `ownedRecord` then refuses to settle a handle it no longer owns, so the lease of a suspended run was never released: every suspension leaked one lane slot until the parent's lane was full, new spawns queued behind it, and revival/`task_send` answered `lane_capacity`. The per-(task, epoch) release guard keeps a late settle of the stale handle from releasing a newer run's lease. `src/manager/suspended-lane-release.test.ts` covers both: a sibling starts in a one-slot lane after the suspension (RED: it queued), and a late settle of the suspended handle leaves the new holder's lease intact.

## Task residency is unlimited by default (#8999)

`packages/omo-config-core/src/schema/task.ts`: `residency_max_children` defaults to `"unlimited"` in both the schema and `resolveOmoTaskSettings` (was `8` in the schema and `min(16, max(8, parallelism * 2))` when resolved). An explicit number or `0` keeps its meaning. Tests that pinned the bounded default now pin `"unlimited"`; `packages/senpi-task/src/manager/residency-unlimited.test.ts` gains a default-path case in which nine children of one parent all start (RED on the old default: the ninth was `residency_denied`). `assets/omo.schema.json` and `docs/reference/omo-json.md` follow.

## Task start failures preserve their closed cause and daemon admission is single-flight (#8960)

Task records and every `task` / `task_output` result now carry the closed `failure_kind` and
`failure_reason` for start failures, while the user-facing sentence is authored by the parent and
never includes child stderr or an unknown host string. The real absent-socket client path reports
`host_unreachable`; Senpi's readiness-deadline envelope reports `ensure_timed_out`; closed session
refusals retain their code. Concurrent starts on one daemon socket share one in-flight ensure, a
failed flight is never cached, and memory-pressure notices live only while their admission episodes
are active. TTL expunge recovery closes an identifiable daemon session before deleting its child
directory, tolerates malformed tombstones per record, and never signals a pid from an old process
tombstone. Focused tests cover persistence and single/batch result projection, real-client
classification, overlapping admission notices, rejected-flight retry, revival fact reset, and
crash-recovery ordering.

## Task progress subscribers survive a host-session reattach (#8983)

`runners/rpc-host/handle.ts`: `subscribe` registered the listener on the port that was current at subscribe time, and a
reattach after a lost transport (#8563) swapped `client` and re-bound only the handle's own listener. Every observer that
subscribed at launch (the manager's progress and stats in `manager/manager.ts`, the transcript log in
`manager/transcript-log.ts`) therefore stayed on the dead port: the turn still completed on the new host, but live
progress, stats and the transcript went silent from the cut onward. The handle now owns its subscribers in a set and
`bindClient` fans each event out from the current port only, so subscribers keep receiving events across any number of
reattaches, a superseded port never delivers (no duplicates), an unsubscribe taken before a reattach still works, and the
set is cleared on exit and detach (a parked child keeps it, since parking is not an exit). Event order is unchanged: the
handle's own turn tracking still runs before subscribers. `runners/rpc/handle.ts` and `runners/in-process/child-handle.ts`
never swap their client or session and are unaffected. Tests: `handle-reattach.test.ts` (two replacements over in-memory
ports, and a real socket cut on the fake host; both assertions fail on dev with the subscriber receiving nothing).
Contributed by @deadcode-walker in #8978.

## Host-session liveness lists worker sessions on the wire (#8932)

`runners/rpc-host/liveness.ts` `liveSessionPaths` sends `list_sessions { include_workers: true }` over a one-shot connection to the daemon socket and reads the reply carrying its id, instead of calling the engine `RpcClient.listSessions()`: the pinned engine client sends a bare `list_sessions` and drops the option, and the daemon hides `kind: "worker"` rows by default, so every task child read as not live. Since #8875 `hasForeignLiveOwner` (`lifecycle/reconcile.ts`) decides host-session ownership by `daemonAlive && sessionLive`, so any other session start in the project (including a child session starting inside the daemon) claimed a live child, reattached it under a new `run_epoch`, and fenced the owner's outcome off: the owner's `waitFor` never settled and a DAG node stayed `running`. The daemon runner exists only on POSIX, where the socket path is the transport address. `lifecycle/host-session.ts` compares canonical session paths on both sides: the daemon lists a session by its realpath while the record keeps the path omo requested, so a project reached through a symlink (`/tmp` on macOS, a linked workspace) never matched even with worker rows listed (`host-session-probe.test.ts`). The unused optional `HostRpcClient.listSessions` and `HostSessionRow` are removed. `rpc-host.foreign-owner.integration.test.ts` drives the production probe against the fake daemon: a live worker child reads as live, and a second process's session start defers it as `foreign_live_owner` while the owner's `waitFor` settles `completed`. The host-world fixture gains `hostPid` and `productionProbe` parent options.

## Runtime fallback skips the rest of a provider whose credential is dead

`manager/credential-failure.ts` (new): `isCredentialFailure(message)` recognizes a provider answer no other model on
the same provider can fix (401, `invalid_grant`, `OAuth refresh failed`, `subscription is required`, invalid API
key; a 403 only when its text names the account, credential, key, organization or subscription AND does not scope
itself to a model - the word `model(s)` or the failed model id - so "Your organization must be verified to use
this model" or "The API key is valid, but access to restricted-model is forbidden" keep the sibling rungs and get
no re-authentication hint), and `runtimeFallbackCandidates(record, message)` drops every remaining `fallback_models`
rung on the failed provider for such a message. `manager/manager.ts` `#tryRuntimeFallback` walks that list
instead of `fallback_models[0]`, so a migrated OpenCode Go key whose subscription lapsed (403 on
`minimax-m3`) no longer relaunches on `minimax-m2.7`: the next provider runs, or the task ends in error when
none is left. `task_model_fallback` gains `skipped_models`. Any other failure keeps today's order. When the task ends on
a credential failure, `manager-outcome.ts` records `terminalFailureMessage`: the provider error plus how to
re-authenticate (`Provider authentication settings` on the desktop, `/login <provider>` in an interactive
session - the manager has no session surface of its own, so both paths are named), re-add the key, or pin
the category elsewhere. Scope: this is the manager's
turn-level walk, which process children (`rpc-host`, `rpc`) use. An in-process child hands its chain to the
engine as `retry.fallbackChains` (`runners/in-process/runtime-fallback-settings.ts`), and senpi's retry
controller still retries same-provider rungs there; that belongs to the engine. A dead key is only visible
at request time (a stored key resolves), so nothing here probes before the spawn. Tests:
`auth-failure-fallback.test.ts` (non-credential failure keeps the same provider and its text, a subscription 403
skips to zai, a rejected OAuth refresh with only same-provider rungs ends the task with the re-authentication hint),
`credential-failure.test.ts` (the classifier's positive and negative cases, a model-scoped 403 keeping the sibling).

## Task-category coverage for omo doctor and omo setup (#8858)

`category/coverage.ts` (new): `resolveCategoryCoverage(config, registry)` returns the usable categories (`resolveAvailableCategoryNames`) and, per unusable one, the chain providers with no model in the registry (the resolver's `missingChainProviders`, now exported with `parseAvailableModels`). Disabled categories are neither; a registry without a model list throws. Exported from `category/index.ts` and as `@oh-my-opencode/senpi-task/category-coverage`. omo#8857.

## unspecified-high GLM rung uses engine `zai` / `zai-coding-cn` (#8827)

`category/fallback-chains.ts`: the `glm-5.3` rung is `zai`, `zai-coding-cn`, `opencode-go` instead of OpenCode's `zai-coding-plan`. This file is the native category source (omo-senpi imports it); `packages/model-core/src/category-model-requirements.ts` stays the OpenCode table. omo#8824.

## plan-reviewer checks the affected user, their experience, the problem solved, and approach fitness; plan-consultant reports ideal-state gaps

`agents/builtin/plan-reviewer.ts`: the purpose becomes two questions - does the plan reach the ideal
state it states for its affected user, and can a developer execute it. New check 5 "Affected User and
Ideal-State Fidelity": the end user is named (forgetting the consuming program/agent, the operator, or
the calling programmer fails), each IS row says what changes for them and which problem is solved,
every IS row maps in `## Success criteria` to a todo and a QA scenario, and the approach can reach
those rows - regressing a stated row, solving a different problem, or leaving a GAP row open is a
blocker; a different approach that would also reach the rows is not. Removed: "APPROVAL BIAS ... 80%
clear is good enough", "Good enough is good enough", "Trust developers"; added "never reject on
taste" and "cite the row". Process step 6 and both verdict lists carry the check; the forced
one-sentence dispatch contract in `tools/task/plan-review-contract.ts` is unchanged.
`agents/builtin/plan-consultant.ts`: new `## Affected user and ideal-state gaps` output block, an
ALWAYS rule to hold the plan against its user, and the Build directive "MUST NOT: Add features not
explicitly requested" becomes "... the request or the affected user's ideal state does not require".
Model-run proxy: the new prompt rejects a plan with an unmapped IS row and a plan naming no user
(old prompt approved both) and approves a fully mapped plan. omo#8773.

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
