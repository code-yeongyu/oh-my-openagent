import type { AgentToolResult } from "@code-yeongyu/senpi"

import type { ToolProgressDetails } from "../../progress"
import type { TaskManager } from "../../manager"
import type { ResolvedModelRecord, TaskStatus } from "../../state"
import type { CallerSessionResolver, WaitBounds } from "../control"

export type OutputManager = Pick<TaskManager, "get" | "list" | "waitFor">

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
  readonly lost?: LostBreadcrumbs
}

type WaitingProgress = ToolProgressDetails["progress"] & { readonly maxWaitMs: number }

export type TaskOutputWaitingDetails = {
  readonly kind: "waiting"
  readonly progress: WaitingProgress
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
  | { readonly kind: "timed_out"; readonly task_id: string; readonly waited_ms: number }
  | TaskOutputWaitingDetails

export type TaskOutputDeps = {
  readonly manager: OutputManager
  readonly stateDir: string
  readonly waitConfig: WaitBounds
  readonly transcriptReader?: TranscriptReader
  readonly resolveCallerSessionId?: CallerSessionResolver
  readonly now?: () => number
}

export type TaskOutputToolResult = AgentToolResult<TaskOutputDetails>
