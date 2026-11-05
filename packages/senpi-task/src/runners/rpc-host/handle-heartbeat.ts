import { log } from "@oh-my-opencode/utils"
import { HEARTBEAT_DEADLINE_MS } from "../rpc/heartbeat"
import { RpcRequestTimeout } from "../rpc/errors"

import type { HostSessionLiveness } from "./handle-port"
import type { HostLivenessStatus } from "../../state/host-liveness"
import { isHostSessionMissing } from "./session-wire"
export type { HostLivenessStatus } from "../../state/host-liveness"

export const HOST_UNRESPONSIVE_DEADLINE_MS = 120_000
const MAX_BACKOFF_MS = 30_000
const STOPPED = Symbol("host heartbeat stopped")

export interface HostHeartbeatInput {
  readonly taskId: string
  readonly intervalMs: number
  paused(): boolean
  probe(): Promise<HostSessionLiveness>
  onState(state: HostSessionLiveness): void
  onStatus(status: HostLivenessStatus): void
  close(): Promise<void>
  onGone(closed: boolean): void
}

/** Probe failure is uncertainty about ONE session, never evidence that its host or turn died. */
export function startHostHeartbeat(input: HostHeartbeatInput) {
  let status: HostLivenessStatus = { state: "running" }
  let stopped = false
  let failures = 0
  let probePending = false
  let probeMissed = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let deadline: ReturnType<typeof setTimeout> | undefined
  let closeTimer: ReturnType<typeof setTimeout> | undefined
  const listeners = new Set<(status: HostLivenessStatus) => void>()
  const active = () => !stopped && !input.paused()
  const publish = (next: HostLivenessStatus): void => {
    status = next
    input.onStatus(next)
    for (const listener of listeners) {
      try { listener(next) }
      catch (error) { log("senpi-task liveness observer failed", { taskId: input.taskId, error: String(error) }) }
    }
  }
  const stop = (): void => {
    stopped = true
    clearTimeout(timer)
    clearTimeout(deadline)
    clearTimeout(closeTimer)
    listeners.clear()
  }
  const gone = (closed: boolean): void => {
    if (!active()) return
    stop()
    input.onGone(closed)
  }
  const retryDelay = () => Math.min(MAX_BACKOFF_MS, input.intervalMs * 2 ** Math.min(failures, 5))
  const schedule = (ms: number): void => {
    clearTimeout(timer)
    if (!active()) return
    timer = setTimeout(tick, ms)
    timer.unref?.()
  }
  const failed = (error: unknown): void => {
    if (!active() || status.state === "terminal-pending") return
    if (isHostSessionMissing(error)) return gone(false)
    log("senpi-task host session heartbeat get_state failed", { taskId: input.taskId, error: String(error) })
    failures++
    if (failures === 3 && status.state === "running") {
      publish({ state: "unresponsive", since: Date.now() })
      deadline = setTimeout(() => {
        if (!active() || status.state !== "unresponsive") return
        publish({ state: "terminal-pending", since: status.since })
        clearTimeout(timer)
        close()
      }, HOST_UNRESPONSIVE_DEADLINE_MS)
      deadline.unref?.()
    }
    schedule(status.state === "running" ? HEARTBEAT_DEADLINE_MS : retryDelay())
  }
  const close = (): void => {
    if (!active()) return
    // The close port resolves only after authoritative host absence, never on an ACK or frame.
    // Old probes cannot undo this stop intent or authorize its completion.
    closeTimer = setTimeout(close, MAX_BACKOFF_MS)
    closeTimer.unref?.()
    void Promise.resolve().then(input.close).then(() => gone(true), error => {
      if (!active()) return
      log("senpi-task unresponsive session close pending", { taskId: input.taskId, error: String(error) })
    })
  }
  const tick = (): void => {
    if (!active() || status.state === "terminal-pending") return
    if (probePending) {
      probeMissed = true
      failed(new RpcRequestTimeout("get_state", HEARTBEAT_DEADLINE_MS))
      return
    }
    probePending = true
    probeMissed = false
    schedule(HEARTBEAT_DEADLINE_MS)
    // A stop that settles before this launch (a teardown continuation queued ahead of it) sends no probe (#11673).
    void Promise.resolve().then<HostSessionLiveness | typeof STOPPED>(() => (stopped ? STOPPED : input.probe())).then(state => {
      if (state === STOPPED || !active() || status.state === "terminal-pending") return
      failures = 0
      clearTimeout(deadline)
      if (status.state !== "running") publish({ state: "running" })
      input.onState(state)
      schedule(input.intervalMs)
    }, error => {
      if (isHostSessionMissing(error) || !probeMissed) failed(error)
    }).finally(() => { probePending = false })
  }
  schedule(input.intervalMs)
  return {
    stop,
    activity: () => {
      if (!active() || status.state === "terminal-pending") return
      failures = 0
      clearTimeout(deadline)
      if (status.state !== "running") {
        publish({ state: "running" })
        schedule(probePending ? HEARTBEAT_DEADLINE_MS : input.intervalMs)
      }
    },
    status: () => status,
    subscribe: (listener: (status: HostLivenessStatus) => void) => {
      listeners.add(listener)
      if (status.state !== "running") listener(status)
      return () => { listeners.delete(listener) }
    },
  }
}
