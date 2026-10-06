import { log } from "@oh-my-opencode/utils"

import type { HostSessionIdentity } from "../state"
import type { LifecycleContext } from "./context"

/**
 * How a close this process asked for ended. `pending`: the daemon had not answered within
 * `hostCloseTimeoutMs`, so the request may still close the session later - `settled` resolves with
 * the final answer once it does. A caller that lets the task be revived meanwhile would let that late
 * close hit the revived run's session.
 */
export type HostSessionCloseOutcome =
  | { readonly kind: "closed" }
  | { readonly kind: "refused" }
  | { readonly kind: "pending"; readonly settled: Promise<boolean> }

/**
 * End a daemon session this process holds no handle for. Only `closed` is confirmation: a refused
 * attach or close_session and a close still in flight are not, and the caller must keep whatever
 * points at the session (a record, a cleanup obligation) and start nothing in its place.
 */
export async function closeHostSession(
  context: LifecycleContext,
  taskId: string,
  hostSession: HostSessionIdentity,
  cwd: string | undefined,
): Promise<HostSessionCloseOutcome> {
  const close = context.hostSessionClose
  if (close === undefined) return { kind: "refused" }
  const settled = close({ hostSession, ...(cwd === undefined ? {} : { cwd }) }).then(
    () => {
      // The daemon confirmed the close; failing to record that must not turn it into a refusal.
      try {
        context.store.appendEvent(taskId, {
          type: "host_session_closed",
          payload: { session_path: hostSession.session_path, socket: hostSession.socket },
        })
      } catch (error) {
        log("senpi-task could not record a confirmed host session close", { taskId, error: String(error) })
      }
      return true
    },
    (error: unknown) => {
      log("senpi-task host session close not confirmed", { taskId, error: String(error) })
      return false
    },
  )
  let timer: ReturnType<typeof setTimeout> | undefined
  const timedOut = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), context.hostCloseTimeoutMs)
    timer.unref?.()
  })
  const first = await Promise.race([settled, timedOut])
  clearTimeout(timer)
  if (first === "timeout") {
    log("senpi-task host session close not confirmed in time", { taskId, sessionPath: hostSession.session_path })
    return { kind: "pending", settled }
  }
  return first ? { kind: "closed" } : { kind: "refused" }
}

export async function closeHostSessionConfirmed(
  context: LifecycleContext,
  taskId: string,
  hostSession: HostSessionIdentity,
  cwd: string | undefined,
): Promise<boolean> {
  return (await closeHostSession(context, taskId, hostSession, cwd)).kind === "closed"
}
