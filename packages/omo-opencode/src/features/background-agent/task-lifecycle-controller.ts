import { finalizeAttempt } from "./attempt-lifecycle"
import type { BackgroundTask, BackgroundTaskStatus } from "./types"

type TerminalTaskStatus = Extract<BackgroundTaskStatus, "completed" | "error" | "cancelled" | "interrupt">

export type SessionCompletionPart = {
  readonly type?: string
  readonly text?: string
  readonly content?: string | readonly unknown[]
  readonly state?: {
    readonly status?: string
  }
}

export type SessionCompletionMessage = {
  readonly info?: {
    readonly role?: string
    readonly finish?: string
    readonly time?: {
      readonly created?: number
      readonly completed?: number
    }
  }
  readonly parts?: readonly SessionCompletionPart[]
}

type LifecycleTransitionResult =
  | { readonly kind: "changed" }
  | { readonly kind: "unchanged"; readonly reason: "already-terminal" | "invalid-transition" }

type InvalidTransitionEvent = {
  readonly taskId: string
  readonly from: BackgroundTaskStatus
  readonly to: TerminalTaskStatus
}

type TaskLifecycleControllerOptions = {
  readonly now?: () => Date
  readonly releaseConcurrency: (key: string) => void
  readonly cleanupTerminalTask: (task: BackgroundTask) => void
  readonly recordHistory: (task: BackgroundTask) => void
  readonly logInvalidTransition?: (event: InvalidTransitionEvent) => void
}

type TerminalizeInput = {
  readonly task: BackgroundTask
  readonly status: TerminalTaskStatus
  readonly error?: string
}

type TodoCompletionPolicyInput = {
  readonly hasIncompleteTodos: boolean
  readonly messages: readonly SessionCompletionMessage[]
  readonly nowMs?: number
  readonly freshActivityWindowMs?: number
}

type TodoCompletionPolicyResult =
  | { readonly kind: "allow" }
  | { readonly kind: "block"; readonly reason: "fresh-tool-activity" | "in-progress-assistant-turn" | "no-final-output" }

const TERMINAL_TASK_STATUSES: ReadonlySet<BackgroundTaskStatus> = new Set([
  "completed",
  "error",
  "cancelled",
  "interrupt",
])

const ACTIVE_TOOL_PART_TYPES: ReadonlySet<string> = new Set(["tool", "tool-call", "tool_use"])
const ACTIVE_PART_STATUSES: ReadonlySet<string> = new Set(["pending", "running"])
const TERMINAL_ASSISTANT_FINISHES: ReadonlySet<string> = new Set(["stop", "end_turn", "completed", "complete"])
const IN_PROGRESS_ASSISTANT_FINISHES: ReadonlySet<string> = new Set(["tool-calls", "unknown"])
const DEFAULT_FRESH_ACTIVITY_WINDOW_MS = 5_000

function isTerminalStatus(status: BackgroundTaskStatus): boolean {
  return TERMINAL_TASK_STATUSES.has(status)
}

function canTransitionToTerminal(from: BackgroundTaskStatus, to: TerminalTaskStatus): boolean {
  if (from === "running") return true
  if (from === "pending") return to === "error" || to === "cancelled"
  return false
}

function messageCreatedAt(message: SessionCompletionMessage): number | undefined {
  const createdAt = message.info?.time?.created
  return typeof createdAt === "number" && Number.isFinite(createdAt) ? createdAt : undefined
}

function isFreshMessage(message: SessionCompletionMessage, nowMs: number, freshActivityWindowMs: number): boolean {
  const createdAt = messageCreatedAt(message)
  if (createdAt === undefined) return true
  return nowMs - createdAt <= freshActivityWindowMs
}

function partHasTextContent(part: SessionCompletionPart): boolean {
  if (part.type !== "text") return false
  return typeof part.text === "string" && part.text.trim().length > 0
}

function partHasActiveToolState(part: SessionCompletionPart): boolean {
  const status = part.state?.status
  if (!status || !ACTIVE_PART_STATUSES.has(status)) return false
  return part.type !== undefined && ACTIVE_TOOL_PART_TYPES.has(part.type)
}

function messageHasFinalText(message: SessionCompletionMessage): boolean {
  return message.parts?.some(partHasTextContent) ?? false
}

function findLatestAssistantMessage(messages: readonly SessionCompletionMessage[]): SessionCompletionMessage | undefined {
  let latest: { readonly index: number; readonly createdAt: number; readonly message: SessionCompletionMessage } | undefined
  for (const [index, message] of messages.entries()) {
    if (message.info?.role !== "assistant") continue
    const createdAt = messageCreatedAt(message) ?? index
    if (!latest || createdAt >= latest.createdAt) {
      latest = { index, createdAt, message }
    }
  }
  return latest?.message
}

function hasFreshToolActivity(messages: readonly SessionCompletionMessage[], nowMs: number, freshActivityWindowMs: number): boolean {
  return messages.some((message) => {
    if (!isFreshMessage(message, nowMs, freshActivityWindowMs)) return false
    return message.parts?.some(partHasActiveToolState) ?? false
  })
}

function assistantTurnIsInProgress(message: SessionCompletionMessage, nowMs: number, freshActivityWindowMs: number): boolean {
  if (message.parts?.some(partHasActiveToolState)) return true

  const finish = message.info?.finish
  if (!finish) return isFreshMessage(message, nowMs, freshActivityWindowMs)
  if (IN_PROGRESS_ASSISTANT_FINISHES.has(finish)) return true
  return !TERMINAL_ASSISTANT_FINISHES.has(finish)
}

export function evaluateTodoCompletionPolicy(input: TodoCompletionPolicyInput): TodoCompletionPolicyResult {
  if (!input.hasIncompleteTodos) {
    return { kind: "allow" }
  }

  const nowMs = input.nowMs ?? Date.now()
  const freshActivityWindowMs = input.freshActivityWindowMs ?? DEFAULT_FRESH_ACTIVITY_WINDOW_MS
  if (hasFreshToolActivity(input.messages, nowMs, freshActivityWindowMs)) {
    return { kind: "block", reason: "fresh-tool-activity" }
  }

  const latestAssistant = findLatestAssistantMessage(input.messages)
  if (!latestAssistant) {
    return { kind: "block", reason: "no-final-output" }
  }

  if (assistantTurnIsInProgress(latestAssistant, nowMs, freshActivityWindowMs)) {
    return { kind: "block", reason: "in-progress-assistant-turn" }
  }

  if (!messageHasFinalText(latestAssistant)) {
    return { kind: "block", reason: "no-final-output" }
  }

  return { kind: "allow" }
}

export function createTaskLifecycleController(options: TaskLifecycleControllerOptions): {
  readonly terminalize: (input: TerminalizeInput) => LifecycleTransitionResult
} {
  const now = options.now ?? (() => new Date())

  return {
    terminalize: (input) => {
      const { task, status, error } = input
      if (isTerminalStatus(task.status)) {
        options.logInvalidTransition?.({ taskId: task.id, from: task.status, to: status })
        return { kind: "unchanged", reason: "already-terminal" }
      }

      if (!canTransitionToTerminal(task.status, status)) {
        options.logInvalidTransition?.({ taskId: task.id, from: task.status, to: status })
        return { kind: "unchanged", reason: "invalid-transition" }
      }

      if (task.currentAttemptID) {
        finalizeAttempt(task, task.currentAttemptID, status, error)
      } else {
        task.status = status
        task.completedAt = now()
        task.error = error
      }

      if (task.concurrencyKey) {
        options.releaseConcurrency(task.concurrencyKey)
        task.concurrencyKey = undefined
      }

      options.recordHistory(task)
      options.cleanupTerminalTask(task)

      return { kind: "changed" }
    },
  }
}
