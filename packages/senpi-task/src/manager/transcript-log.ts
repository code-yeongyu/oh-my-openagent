import type { PersistedTaskEvent } from "../store"
import type { ManagedChildEvent, ManagedChildHandle } from "./child-handle"

// The transcript event types the runner subscription writes into OUR JSONL event log. The task_output
// event-log reader (tools/output/transcript/event-log.ts) lifts exactly these back out, so the two
// names are the contract between writer and reader.
export const TRANSCRIPT_ASSISTANT_EVENT = "assistant_message"
export const TRANSCRIPT_TOOL_EVENT = "tool_execution"
export const TRANSCRIPT_ERROR_EVENT = "child_error"

export type TranscriptLogStore = {
  readonly appendEvent: (taskId: string, event: PersistedTaskEvent) => string
}

// Persist the transcript-relevant slice of a child event: assistant prose from message_end, a tool
// marker from tool_execution_end, and a child_error breadcrumb when the assistant message carries a
// stopReason "error" diagnostic (otherwise a failed turn leaves NO trace and task_output reads an
// empty transcript). Every other event is ignored so the log stays a clean transcript.
export function logTranscriptEvent(store: TranscriptLogStore, taskId: string, event: ManagedChildEvent): void {
  const persisted = toPersistedEvent(event)
  if (persisted !== undefined) store.appendEvent(taskId, persisted)
}

// Subscribe a running child's events into the store transcript log. Returns the unsubscribe so the
// manager can detach on dispose. READ path only feeds OUR log; it never mutates child state.
export function subscribeTranscriptLog(handle: ManagedChildHandle, store: TranscriptLogStore, taskId: string): () => void {
  return handle.subscribe((event) => logTranscriptEvent(store, taskId, event))
}

function toPersistedEvent(event: ManagedChildEvent): PersistedTaskEvent | undefined {
  if (event.type === "message_end") {
    const failure = assistantFailure(event.message)
    if (failure !== undefined) return { type: TRANSCRIPT_ERROR_EVENT, payload: failure }
    const text = assistantText(event.message)
    return text === undefined ? undefined : { type: TRANSCRIPT_ASSISTANT_EVENT, payload: { text } }
  }
  if (event.type === "tool_execution_end" && typeof event.toolName === "string") {
    return { type: TRANSCRIPT_TOOL_EVENT, payload: { tool: event.toolName, is_error: event.isError === true } }
  }
  return undefined
}

function assistantFailure(message: unknown): { readonly message: string; readonly stop_reason: string } | undefined {
  if (!isRecord(message) || message.role !== "assistant") return undefined
  if (message.stopReason !== "error") return undefined
  const diagnostic = typeof message.errorMessage === "string" && message.errorMessage.length > 0
    ? message.errorMessage
    : "child turn failed without a diagnostic message"
  return { message: diagnostic, stop_reason: "error" }
}

function assistantText(message: unknown): string | undefined {
  if (!isRecord(message) || message.role !== "assistant" || !Array.isArray(message.content)) return undefined
  const text = message.content
    .filter((part: unknown): part is { readonly type: "text"; readonly text: string } => isTextPart(part))
    .map((part) => part.text)
    .join("")
  return text.length > 0 ? text : undefined
}

function isTextPart(part: unknown): part is { readonly type: "text"; readonly text: string } {
  return isRecord(part) && part.type === "text" && typeof part.text === "string"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
