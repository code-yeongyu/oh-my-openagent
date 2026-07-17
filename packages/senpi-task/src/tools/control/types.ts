import type { AgentToolResult } from "@code-yeongyu/senpi"

import type { TaskManager } from "../../manager"
import type { TaskStatus } from "../../state"
import type { SenpiShutdownErrorCode } from "../../team"
import type { TeamSendDetails } from "../team/messaging"

// The minimal read of the harness context the control tools need to name the calling session. The
// W1-V scope guard is fail-open without a caller id, so the tool layer resolves and passes it on
// every steering/list call. ExtensionContext satisfies this structurally.
export type SessionIdCarrier = {
  readonly sessionManager: { getSessionId(): string }
}

export type CallerSessionResolver = (ctx: SessionIdCarrier) => string | undefined

// The engine surface each tool drives. Tools NEVER touch the store directly (W1-V seam obligation 2):
// every mutation goes through these public manager APIs.
export type SendManager = Pick<TaskManager, "sendToTask" | "interruptTask" | "list">
export type CancelManager = Pick<TaskManager, "cancelTask" | "get">

export type SendResultDetails =
  | { readonly kind: "steered"; readonly task_id: string; readonly status: TaskStatus; readonly delivered: "steer" | "followUp" }
  | { readonly kind: "revived"; readonly task_id: string; readonly run_epoch: number }
  | { readonly kind: "queued"; readonly task_id: string; readonly queue_position: number }
  | { readonly kind: "not_continuable"; readonly task_id: string; readonly reason: string; readonly suggestion: string }
  | { readonly kind: "scope_denied"; readonly task_id: string; readonly owning_session_id: string; readonly reason: string }
  | { readonly kind: "not_found"; readonly reason: string; readonly known_tasks: readonly string[] }
  | { readonly kind: "invalid_arguments"; readonly reason: string }
  | { readonly kind: "interrupted"; readonly task_id: string; readonly previous_status: TaskStatus }
  | { readonly kind: "noop"; readonly task_id: string; readonly previous_status: TaskStatus; readonly reason: string }
  | { readonly kind: "team_message"; readonly team: TeamSendDetails }
  | { readonly kind: "shutdown_requested"; readonly team_run_id: string; readonly member: string }
  | { readonly kind: "shutdown_responded"; readonly team_run_id: string; readonly member: string; readonly approved: boolean }
  | {
      readonly kind: "shutdown_failed"
      readonly operation: "request" | "approve" | "reject"
      readonly team_run_id: string
      readonly member: string
      readonly code: SenpiShutdownErrorCode | "team_state_missing"
      readonly reason: string
    }

export type CancelResultDetails =
  | { readonly kind: "cancelled"; readonly task_id: string; readonly previous_status: TaskStatus; readonly status: TaskStatus }
  | { readonly kind: "noop"; readonly task_id: string; readonly status: TaskStatus; readonly reason: string }
  | { readonly kind: "not_found"; readonly reason: string }
  | { readonly kind: "invalid_arguments"; readonly reason: string }

export type SendToolResult = AgentToolResult<SendResultDetails>
export type CancelToolResult = AgentToolResult<CancelResultDetails>
