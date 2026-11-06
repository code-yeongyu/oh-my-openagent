import { log } from "@oh-my-opencode/utils"

import type { TaskRecord } from "../state"
import type { TaskRecordStore } from "../store"
import type { LifecycleContext } from "./context"
import { isHostSessionRecord, type HostSessionEnd, type HostSessionRecord } from "./host-session"
import { closeHostSession, type HostSessionCloseOutcome } from "./host-session-close"

/**
 * THE one way the lifecycle decides whether a daemon-hosted child it holds no handle for has ended
 * (omo#11765). "Not listed on the recorded socket" is not an end: after a generation handoff the
 * successor serves that socket while the draining predecessor may still run the child. An end is
 * confirmed only by a close the host answered, or - with a generation view - by the three-part proof
 * that the generation the record names is gone: a serving listing without the path, no handover-parked
 * entry, and a second listing taken after that read (the successor's reopen watch opens a parked
 * session before it clears the entry).
 *
 * Single flight per task: every entrant (a cancel, its retry driver, a pending-cancel finish, a TTL
 * sweep, the destruction port) gets the in-flight pass. A pending close stays in the map until it
 * settles, so nothing opens the session a second time behind it; a confirmed end stays until the
 * destruction that consumes it clears it.
 */

// `owner` names the run and session a pass judged: a confirmed end proves nothing about a later run of the task.
type FlightEntry = { readonly promise: Promise<HostSessionEnd>; readonly owner: string; done: boolean }

const flights = new WeakMap<TaskRecordStore, Map<string, FlightEntry>>()

function flightsOf(context: LifecycleContext): Map<string, FlightEntry> {
  const existing = flights.get(context.store)
  if (existing !== undefined) return existing
  const created = new Map<string, FlightEntry>()
  flights.set(context.store, created)
  return created
}

export function endHostSessionChild(context: LifecycleContext, record: TaskRecord): Promise<HostSessionEnd> {
  if (!isHostSessionRecord(record)) return Promise.resolve({ kind: "not_ended", reason: "not_host_session" })
  const table = flightsOf(context)
  const owner = ownerOf(record)
  const existing = table.get(record.task_id)
  if (existing !== undefined && existing.owner === owner) return existing.promise
  if (existing !== undefined && !existing.done) return Promise.resolve({ kind: "not_ended", reason: "earlier_run_in_flight" })
  const entry: FlightEntry = { promise: runPass(context, record), owner, done: false }
  table.set(record.task_id, entry)
  const drop = (): void => {
    if (table.get(record.task_id) === entry) table.delete(record.task_id)
  }
  entry.promise.then((end) => {
    if (end.kind === "ended") {
      entry.done = true
      return
    }
    if (end.kind === "not_ended") return drop()
    void end.settled.then((closed) => {
      if (!closed) return drop()
      if (table.get(record.task_id) !== entry) return
      table.set(record.task_id, { promise: Promise.resolve({ kind: "ended", via: "close_session" }), owner, done: true })
    }, drop)
  }, drop)
  return entry.promise
}

export function inFlightHostSessionEnd(context: LifecycleContext, record: TaskRecord): Promise<HostSessionEnd> | undefined {
  if (!isHostSessionRecord(record)) return undefined
  const entry = flights.get(context.store)?.get(record.task_id)
  return entry?.owner === ownerOf(record) ? entry.promise : undefined
}

export function clearHostSessionEnd(context: LifecycleContext, taskId: string): void {
  const table = flights.get(context.store)
  if (table?.get(taskId)?.done === true) table.delete(taskId)
}

function ownerOf(record: HostSessionRecord): string {
  const { socket, instance_id, session_path, routing_id } = record.host_session
  return JSON.stringify([record.notification.run_epoch, socket, instance_id, session_path, routing_id])
}

async function runPass(context: LifecycleContext, record: HostSessionRecord): Promise<HostSessionEnd> {
  const deadline = context.now() + context.hostCloseTimeoutMs
  const remaining = (): number => deadline - context.now()
  const close = async (): Promise<HostSessionEnd> =>
    fromClose(await closeHostSession(context, record.task_id, record.host_session, record.spawn_spec?.cwd, remaining()))
  const first = await listing(context, record)
  if (first !== "gone") return first === "live" ? close() : { kind: "not_ended", reason: "host_unknown" }
  const view = context.hostGenerationView
  if (view === undefined) return { kind: "ended", via: "not_listed" }
  if (await view.parkedEntryPresent(record.host_session)) return close()
  if (await view.generationPresent(record.host_session)) return { kind: "not_ended", reason: "generation_cannot_cancel" }
  const second = await listing(context, record)
  if (second === "live") return close()
  if (second === "unknown") return { kind: "not_ended", reason: "host_unknown" }
  recordGenerationExited(context, record)
  return { kind: "ended", via: "generation_exited" }
}

async function listing(context: LifecycleContext, record: HostSessionRecord): Promise<"live" | "gone" | "unknown"> {
  context.hostSessionProbe.refresh(record.host_session.socket)
  return context.hostSessionProbe.sessionLiveness(record.host_session)
}

function fromClose(outcome: HostSessionCloseOutcome): HostSessionEnd {
  if (outcome.kind === "closed") return { kind: "ended", via: "close_session" }
  if (outcome.kind === "pending") return { kind: "pending", settled: outcome.settled }
  return { kind: "not_ended", reason: "close_refused" }
}

function recordGenerationExited(context: LifecycleContext, record: HostSessionRecord): void {
  try {
    context.store.appendEvent(record.task_id, {
      type: "host_session_closed",
      payload: {
        session_path: record.host_session.session_path,
        socket: record.host_session.socket,
        via: "generation_exited",
        instance_id: record.host_session.instance_id,
      },
    })
  } catch (error) {
    log("senpi-task could not record a proven host session end", { taskId: record.task_id, error: String(error) })
  }
}
