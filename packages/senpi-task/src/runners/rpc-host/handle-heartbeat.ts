import { log } from "@oh-my-opencode/utils"
import { startHeartbeat } from "../rpc/heartbeat"

import type { HostSessionLiveness, HostSessionPort } from "./handle-port"

export interface HostHeartbeatInput {
  readonly taskId: string
  readonly intervalMs: number
  paused(): boolean
  port(): HostSessionPort
  onState(state: HostSessionLiveness): void
  onUnresponsive(): void
}

export function startHostHeartbeat(input: HostHeartbeatInput): () => void {
  const failed = (error: unknown): void => {
    log("senpi-task host session heartbeat get_state failed", { taskId: input.taskId, error: String(error) })
  }
  return startHeartbeat({
    intervalMs: input.intervalMs,
    paused: input.paused,
    probe: () => input.port().getState(),
    onState: input.onState,
    onFailure: failed,
    onUnresponsive: input.onUnresponsive,
  })
}
