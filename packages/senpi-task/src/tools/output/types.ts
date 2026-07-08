import type { AgentToolResult } from "@code-yeongyu/senpi"

import type { TaskManager } from "../../manager"
import type { TaskStatus } from "../../state"
import type { CallerSessionResolver } from "../control"

// task_list only reads; task_output reads a single record plus its scope. Tools drive these public
// manager APIs, never the store (W1-V seam obligation 2).
export type ListManager = Pick<TaskManager, "list">
export type OutputManager = Pick<TaskManager, "get" | "list">

export type TaskListRow = {
  readonly task_id: string
  readonly name?: string
  readonly agent_type?: string
  readonly category?: string
  readonly status: TaskStatus
  readonly execution_mode: string
  readonly model: string
  readonly age_ms: number
  readonly pid?: number
  readonly queue_position?: number
  readonly unread_notification: boolean
}

export type TaskListDetails = {
  readonly scope: "parent-session" | "all"
  readonly include_terminal: boolean
  readonly tasks: readonly TaskListRow[]
}

export type TaskListDeps = {
  readonly manager: ListManager
  readonly resolveCallerSessionId?: CallerSessionResolver
  readonly now?: () => number
}

// One reconstructed line of a child's work: assistant prose or a tool invocation marker. Both the
// in-process event log and the rpc session file collapse into this shape for rendering.
export type TranscriptEntry =
  | { readonly kind: "assistant"; readonly text: string }
  | { readonly kind: "tool"; readonly tool: string; readonly is_error: boolean }

export type TranscriptSource = "event-log" | "session-jsonl" | "none"

export type TranscriptReadResult = {
  readonly entries: readonly TranscriptEntry[]
  readonly source: TranscriptSource
}

export type TranscriptReader = (input: { readonly taskId: string; readonly stateDir: string }) => TranscriptReadResult

export type LostBreadcrumbs = {
  readonly explanation: string
  readonly session_dir: string
  readonly pid?: number
}

export type TaskSnapshot = {
  readonly task_id: string
  readonly name?: string
  readonly status: TaskStatus
  readonly execution_mode: string
  readonly model: string
  readonly agent_type?: string
  readonly category?: string
  readonly parent_session_id: string
  readonly root_session_id: string
  readonly age_ms: number
  readonly pid?: number
  readonly child_session_id?: string
  readonly final_response?: string
  readonly error_message?: string
  readonly lost?: LostBreadcrumbs
}

export type TaskOutputDetails =
  | { readonly kind: "status"; readonly snapshot: TaskSnapshot }
  | {
      readonly kind: "transcript"
      readonly mode: "tail" | "full"
      readonly source: TranscriptSource
      readonly transcript: string
      readonly truncated: boolean
      readonly snapshot: TaskSnapshot
    }
  | { readonly kind: "not_found"; readonly reason: string; readonly known_tasks: readonly string[] }
  | { readonly kind: "invalid_arguments"; readonly reason: string }

export type TaskOutputDeps = {
  readonly manager: OutputManager
  readonly stateDir: string
  readonly transcriptReader?: TranscriptReader
  readonly resolveCallerSessionId?: CallerSessionResolver
  readonly now?: () => number
}

export type TaskListToolResult = AgentToolResult<TaskListDetails>
export type TaskOutputToolResult = AgentToolResult<TaskOutputDetails>
