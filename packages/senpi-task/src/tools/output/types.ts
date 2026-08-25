import type { AgentToolResult } from "@code-yeongyu/senpi"

import type { TaskManager } from "../../manager"
import type { ResolvedModelRecord, ResidencyState, TaskRunStats, TaskStatus } from "../../state"
import type { CallerSessionResolver } from "../control"

export type OutputManager = Pick<TaskManager, "get" | "list">

export type TranscriptEntry =
  | { readonly kind: "assistant"; readonly text: string }
  | { readonly kind: "tool"; readonly tool: string; readonly is_error: boolean }
  | { readonly kind: "error"; readonly message: string }

export type TranscriptSource = "event-log" | "session-jsonl" | "none"

export type TranscriptReadResult = {
  readonly entries: readonly TranscriptEntry[]
  readonly source: TranscriptSource
  readonly truncated?: boolean
}

export type TranscriptReader = (input: { readonly taskId: string; readonly stateDir: string }) => TranscriptReadResult

export type LostBreadcrumbs = {
  readonly explanation: string
  readonly session_dir: string
  readonly pid?: number
}

export type SuspendedDetails = {
  readonly explanation: string
}

export type TaskSnapshot = {
  readonly task_id: string
  readonly name?: string
  readonly description?: string
  readonly task_summary?: string
  readonly status: TaskStatus
  readonly residency_state: ResidencyState
  readonly suspended?: SuspendedDetails
  readonly execution_mode: string
  readonly model: string
  readonly resolved_model?: ResolvedModelRecord
  readonly agent_type?: string
  readonly category?: string
  readonly parent_session_id: string
  readonly root_session_id: string
  readonly age_ms: number
  readonly pid?: number
  readonly child_session_id?: string
  readonly final_response?: string
  readonly error_message?: string
  readonly run_stats?: TaskRunStats
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

export type TaskOutputToolResult = AgentToolResult<TaskOutputDetails>
