import type { NotifyResult, ParentState } from "../completion"
import type { TaskRecord } from "../state"
import { CHAOS_MODEL, CHAOS_SESSION } from "./chaos-harness"
import type { ChaosHarness } from "./chaos-harness"
import { isTerminalStatus } from "./observing-store"
import type { RandomSource } from "./prng"

export function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => queueMicrotask(resolve))
}

export type ChaosState = {
  readonly harness: ChaosHarness
  readonly rng: RandomSource
  readonly taskIds: string[]
  readonly background: Map<string, boolean>
  readonly seamBreaches: string[]
  // `${taskId}:${epoch}` terminal edges already offered to the notifier, so each edge is observed by
  // one burst of duplicate observers at one parent state (faithful duplicate-injection model).
  readonly observedEdges: Set<string>
  readonly maxTasks: number
}

const NOTIFYING_TERMINALS = new Set(["completed", "error", "lost"])
const REVIVABLE = new Set(["completed", "error", "interrupted"])
const DELIVER_STATES: readonly ParentState[] = [{ kind: "idle" }, { kind: "streaming" }]
const BUFFER_STATES: readonly ParentState[] = [
  { kind: "compacting" },
  { kind: "session_switching" },
  { kind: "session_shutdown" },
]

function load(state: ChaosState, taskId: string): TaskRecord | null {
  return state.harness.store.load(taskId)
}

function runningWithHandle(state: ChaosState): string[] {
  return state.taskIds.filter((id) => load(state, id)?.status === "running" && state.harness.runner.handles.has(id))
}

function byStatus(state: ChaosState, predicate: (record: TaskRecord) => boolean): string[] {
  return state.taskIds.filter((id) => {
    const record = load(state, id)
    return record !== null && predicate(record)
  })
}

function nonTerminal(state: ChaosState): string[] {
  return byStatus(state, (record) => !isTerminalStatus(record.status))
}

function pick(state: ChaosState, ids: readonly string[]): string | undefined {
  return ids.length === 0 ? undefined : state.rng.pick(ids)
}

async function actStart(state: ChaosState): Promise<void> {
  if (state.taskIds.length >= state.maxTasks) return
  const background = state.rng.bool(0.7)
  const result = await state.harness.manager.start({
    prompt: "chaos turn",
    parent_session_id: CHAOS_SESSION,
    root_session_id: CHAOS_SESSION,
    depth: 1,
    category: "quick",
    model: CHAOS_MODEL,
    execution_mode: state.rng.bool() ? "in-process" : "process",
    run_in_background: background,
  })
  if (result.kind !== "started") return
  state.taskIds.push(result.task_id)
  state.background.set(result.task_id, background)
}

async function settleWith(state: ChaosState, outcome: "clean" | "signal"): Promise<void> {
  const id = pick(state, runningWithHandle(state))
  if (id === undefined) return
  const handle = state.harness.runner.handles.get(id)
  if (handle === undefined) return
  if (outcome === "clean") handle.settle({ status: "completed", finalResponse: "clean exit" })
  else handle.settle({ status: "error", failure: { kind: "child-prompt-failed", message: "terminated by signal SIGKILL" } })
  await flushMicrotasks()
}

async function actSteer(state: ChaosState): Promise<void> {
  const id = pick(state, byStatus(state, (record) => record.status === "running" && record.residency_state === "resident"))
  if (id === undefined) return
  await state.harness.manager.continueTask(id, "keep going", CHAOS_SESSION, "steer")
}

async function actInterrupt(state: ChaosState): Promise<void> {
  const id = pick(state, byStatus(state, (record) => record.status === "running"))
  if (id === undefined) return
  await state.harness.manager.interruptTask({ idOrName: id, callerSessionId: CHAOS_SESSION })
}

async function actCancel(state: ChaosState): Promise<void> {
  const id = pick(state, byStatus(state, (record) => record.status === "running"))
  if (id === undefined) return
  await state.harness.manager.cancelTask(id, state.rng.bool() ? "user aborted" : undefined, CHAOS_SESSION)
}

async function actCancelPending(state: ChaosState): Promise<void> {
  const id = pick(state, byStatus(state, (record) => record.status === "pending"))
  if (id === undefined) return
  await state.harness.manager.cancelTask(id, state.rng.bool() ? "cancelled while queued" : undefined, CHAOS_SESSION)
}

async function actAbortParentWait(state: ChaosState): Promise<void> {
  const id = pick(state, nonTerminal(state))
  if (id === undefined) return
  state.harness.waiters.register(id, state.rng.int(1, 6))
}

async function actRevive(state: ChaosState): Promise<void> {
  const id = pick(state, byStatus(state, (record) => REVIVABLE.has(record.status) && record.residency_state === "resident"))
  if (id === undefined) return
  await state.harness.manager.continueTask(id, "revive please", CHAOS_SESSION)
}

function expectedDelta(result: NotifyResult): number {
  return result.kind === "delivered" ? 1 : 0
}

function checkDelta(state: ChaosState, before: number, result: NotifyResult): void {
  const delta = state.harness.parentNotifier.calls.length - before
  if (delta !== expectedDelta(result)) {
    state.seamBreaches.push(`notify result ${result.kind} produced ${delta} enqueue(s), expected ${expectedDelta(result)}`)
  }
}

function unobservedNotifying(state: ChaosState): string[] {
  return byStatus(state, (record) => {
    if (!NOTIFYING_TERMINALS.has(record.status) || !(state.background.get(record.task_id) ?? false)) return false
    return !state.observedEdges.has(`${record.task_id}:${record.notification.run_epoch}`)
  })
}

function alreadyNotified(state: ChaosState): string[] {
  return byStatus(state, (record) => {
    if (!NOTIFYING_TERMINALS.has(record.status)) return false
    return record.notification.notified_epoch >= record.notification.run_epoch
  })
}

// One notification per terminal transition: the store commits each (task, epoch) terminal exactly
// once, and that single commit is the notifier's trigger (plan todo 11). Concurrent duplicate
// idle-edge injections are the todo-17 IdleInjectionCoordinator's job, out of the W1 notifier scope.
function notifyEdge(state: ChaosState, id: string, parentState: ParentState): void {
  const record = load(state, id)
  if (record === null) return
  state.observedEdges.add(`${id}:${record.notification.run_epoch}`)
  const before = state.harness.parentNotifier.calls.length
  const result = state.harness.notifier.notifyTerminal({ record, parentState, runInBackground: true })
  checkDelta(state, before, result)
}

async function actNotify(state: ChaosState): Promise<void> {
  const id = pick(state, unobservedNotifying(state))
  if (id === undefined) return
  const parentState = state.rng.bool(0.6) ? state.rng.pick(DELIVER_STATES) : state.rng.pick(BUFFER_STATES)
  notifyEdge(state, id, parentState)
}

// Resume / replay re-observes an ALREADY-notified terminal (persisted notified_epoch >= run_epoch).
// The epoch guard must skip it: a replayed edge never re-notifies the parent.
async function actReplayNotify(state: ChaosState): Promise<void> {
  const id = pick(state, alreadyNotified(state))
  if (id === undefined) return
  const record = load(state, id)
  if (record === null) return
  const before = state.harness.parentNotifier.calls.length
  const result = state.harness.notifier.notifyTerminal({ record, parentState: { kind: "idle" }, runInBackground: true })
  checkDelta(state, before, result)
  if (result.kind !== "skipped") {
    state.seamBreaches.push(`replay of already-notified ${id} epoch ${record.notification.run_epoch} was ${result.kind}, expected skipped`)
  }
}

async function actFlush(state: ChaosState): Promise<void> {
  const before = state.harness.parentNotifier.calls.length
  const result = state.harness.notifier.flushBuffered({ sessionId: CHAOS_SESSION, replaced: state.rng.bool(0.3) })
  const delta = state.harness.parentNotifier.calls.length - before
  const expected = result.kind === "flushed" ? 1 : 0
  if (delta !== expected) state.seamBreaches.push(`flush result ${result.kind} produced ${delta} enqueue(s), expected ${expected}`)
}

async function actEvict(state: ChaosState): Promise<void> {
  await state.harness.lifecycle.admitResident(CHAOS_SESSION)
}

async function actReconcile(state: ChaosState): Promise<void> {
  await state.harness.lifecycle.reconcileOnSessionStart(CHAOS_SESSION)
  state.harness.notifier.reconcileFailedNotifications({ sessionId: CHAOS_SESSION, parentState: { kind: "idle" } })
}

async function actShutdown(state: ChaosState): Promise<void> {
  await state.harness.lifecycle.teardownOnSessionShutdown()
}

async function actNotifierFailThenRetry(state: ChaosState): Promise<void> {
  const pendingRetries = state.harness.retryScheduler.pendingCount
  if (pendingRetries > 0 && state.rng.bool(0.7)) {
    state.harness.retryScheduler.run(state.rng.int(0, pendingRetries - 1))
    return
  }
  const id = pick(state, unobservedNotifying(state))
  if (id === undefined) {
    if (pendingRetries > 0) state.harness.retryScheduler.run(state.rng.int(0, pendingRetries - 1))
    return
  }
  state.harness.parentNotifier.failNext(state.rng.int(2, 5))
  notifyEdge(state, id, { kind: "idle" })
}

type Action = { readonly run: (state: ChaosState) => Promise<void>; readonly weight: number }

const ACTIONS: readonly Action[] = [
  { run: actStart, weight: 8 },
  { run: (s) => settleWith(s, "clean"), weight: 7 },
  { run: (s) => settleWith(s, "signal"), weight: 4 },
  { run: actSteer, weight: 3 },
  { run: actInterrupt, weight: 3 },
  { run: actCancel, weight: 3 },
  { run: actCancelPending, weight: 4 },
  { run: actAbortParentWait, weight: 4 },
  { run: actRevive, weight: 3 },
  { run: actNotify, weight: 6 },
  { run: actReplayNotify, weight: 3 },
  { run: actFlush, weight: 4 },
  { run: actEvict, weight: 3 },
  { run: actReconcile, weight: 2 },
  { run: actShutdown, weight: 1 },
  { run: actNotifierFailThenRetry, weight: 4 },
]

export async function applyRandomAction(state: ChaosState): Promise<void> {
  state.harness.waiters.advance()
  const action = state.rng.weighted(ACTIONS.map((entry) => ({ value: entry.run, weight: entry.weight })))
  await action(state)
  if (state.rng.bool(0.5)) await flushMicrotasks()
}

export { isTerminalStatus }
