import { log } from "@oh-my-opencode/utils"

import type { HostSessionLiveness, HostSessionPort } from "./handle-port"

export interface HostHeartbeatInput {
  readonly taskId: string
  readonly intervalMs: number
  paused(): boolean
  port(): HostSessionPort
  onState(state: HostSessionLiveness): void
}

export function startHostHeartbeat(input: HostHeartbeatInput): () => void {
  const failed = (error: unknown): void => {
    log("senpi-task host session heartbeat get_state failed", { taskId: input.taskId, error: String(error) })
  }
  const heartbeat = setInterval(() => {
    if (input.paused()) return
    // A detached client throws before returning a promise; keep the state reaction's ordering.
    try {
      input.port().getState().then(input.onState).catch(failed)
    } catch (error) {
      failed(error)
    }
  }, input.intervalMs)
  heartbeat.unref?.()
  return () => clearInterval(heartbeat)
}
