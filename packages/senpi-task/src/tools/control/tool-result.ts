import type { AgentToolResult } from "@code-yeongyu/senpi"

import type { TaskStatus } from "../../state"

const TERMINAL_STATUSES: ReadonlySet<TaskStatus> = new Set<TaskStatus>([
  "completed",
  "error",
  "cancelled",
  "interrupted",
  "lost",
])

export function isTerminalStatus(status: TaskStatus): boolean {
  return TERMINAL_STATUSES.has(status)
}

const FINAL_RESPONSE_HEAD_MAX = 400

export function finalResponseHead(text: string | undefined): string | undefined {
  if (text === undefined) return undefined
  const trimmed = text.trim()
  if (trimmed.length === 0) return undefined
  if (trimmed.length <= FINAL_RESPONSE_HEAD_MAX) return trimmed
  return `${trimmed.slice(0, FINAL_RESPONSE_HEAD_MAX)}...`
}

// Senpi's agent loop reads an inline `isError` off the returned result (the same convention the
// memory tool uses); the pinned AgentToolResult type does not declare it yet, so it is intersected on.
export type ToolExecutionResult<TDetails> = AgentToolResult<TDetails> & { readonly isError?: boolean }

// Result convention (pi-task task-status/task-cancel): typed structured `details` for the model to
// branch on, plus a short human-readable `content` line. Never prose-only.
export function toolResult<TDetails>(text: string, details: TDetails): ToolExecutionResult<TDetails> {
  return { content: [{ type: "text", text }], details }
}

export function toolErrorResult<TDetails>(text: string, details: TDetails): ToolExecutionResult<TDetails> {
  return { ...toolResult(text, details), isError: true }
}
