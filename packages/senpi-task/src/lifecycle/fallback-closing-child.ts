import { log } from "@oh-my-opencode/utils"
import type { HostSessionIdentity, TaskRecord } from "../state"
import { delay, type LifecycleContext } from "./context"
import { forgetClosedChild } from "./fallback-handoff"
import { closeHostSession, closeHostSessionConfirmed } from "./host-session-close"

const closingAttempts = new Map<string, Promise<boolean>>()

/**
 * A runtime-fallback handoff names the failed rung's child in `fallback_closing_child` until its close
 * is confirmed. Whoever ends up owning the record - a revival, a reconciler disposing a stopped task,
 * a TTL sweep - must end that child too, or it is left running with nothing pointing at it. Returns
 * true only once the child is confirmed gone (closed, already absent, or its process dead); on false
 * the identity stays on the record so the next pass retries, and a revival must not launch beside it.
 */
export async function endClosingFallbackChild(context: LifecycleContext, record: TaskRecord): Promise<boolean> {
  const closing = record.fallback_closing_child
  if (closing === undefined) return true
  if (closing.requires_confirmation === true && closing.host_session !== undefined) {
    const { socket, session_path, instance_id, routing_id } = closing.host_session
    const key = JSON.stringify([context.store.stateDir, record.task_id, socket, session_path, instance_id, routing_id])
    const active = closingAttempts.get(key)
    if (active !== undefined) return false
    // The deadline releases the caller, not the request. Keep one attempt per identity until its
    // transport settles, including across lifecycle replacement in this process.
    const forget = () => context.store.mutate(record.task_id, (fresh) => forgetClosedChild(fresh, closing))
    let awaitingLateClose = false
    const attempt = closeHostSession(context, record.task_id, closing.host_session, record.spawn_spec?.cwd)
      .then((outcome) => {
        if (outcome.kind === "closed") {
          forget()
          return true
        }
        if (outcome.kind === "pending") {
          awaitingLateClose = true
          void outcome.settled
            .then((ended) => {
              if (ended) forget()
            })
            .catch((error: unknown) =>
              log("senpi-task late suspension close bookkeeping failed", {
                taskId: record.task_id,
                error: String(error),
              }),
            )
            .finally(() => {
              closingAttempts.delete(key)
            })
        }
        return false
      })
      .finally(() => {
        if (!awaitingLateClose) closingAttempts.delete(key)
      })
    closingAttempts.set(key, attempt)
    return attempt
  }
  const ended = closing.host_session === undefined
    ? await signalClosingProcess(context, record.task_id, closing.pid)
    : await closeClosingSession(context, record, closing.host_session)
  if (!ended) return false
  context.store.mutate(record.task_id, (fresh) => forgetClosedChild(fresh, closing))
  return true
}

async function signalClosingProcess(context: LifecycleContext, taskId: string, pid: number | undefined): Promise<boolean> {
  if (pid === undefined || !context.signaller.isAlive(pid)) return true
  context.signaller.signal(pid, "SIGTERM")
  context.store.appendEvent(taskId, { type: "reconcile_terminated", payload: { pid, signal: "SIGTERM" } })
  await delay(context.orphanKillDelayMs)
  if (context.signaller.isAlive(pid)) {
    context.signaller.signal(pid, "SIGKILL")
    context.store.appendEvent(taskId, { type: "reconcile_terminated", payload: { pid, signal: "SIGKILL" } })
  }
  return !context.signaller.isAlive(pid)
}

async function closeClosingSession(context: LifecycleContext, record: TaskRecord, hostSession: HostSessionIdentity): Promise<boolean> {
  // An unreachable daemon took its sessions with it. A reachable one is asked to close even when it no
  // longer lists the path: closing an absent session is harmless, a skipped close is never retried.
  if (!(await context.hostSessionProbe.daemonAlive(hostSession))) return true
  return closeHostSessionConfirmed(context, record.task_id, hostSession, record.spawn_spec?.cwd)
}
