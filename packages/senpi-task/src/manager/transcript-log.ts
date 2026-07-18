import type { PersistedTaskEvent } from "../store"
import type { ManagedChildEvent, ManagedChildHandle } from "./child-handle"

// The transcript event types the runner subscription writes into OUR JSONL event log. The task_output
// event-log reader (tools/output/transcript/event-log.ts) lifts exactly these back out, so the two
// names are the contract between writer and reader.
export const TRANSCRIPT_ASSISTANT_EVENT = "assistant_message"
export const TRANSCRIPT_TOOL_EVENT = "tool_execution"

export type TranscriptLogStore = {
  readonly appendEvent: (taskId: string, event: PersistedTaskEvent) => string
}

// Persist the transcript-relevant slice of a child event: assistant prose from message_end and a
// tool marker from tool_execution_end. Every other event (user/tool-result messages, lifecycle,
// tool_execution_start) is ignored so the log stays a clean assistant/tool transcript.
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
    const text = assistantText(event.message)
    return text === undefined ? undefined : { type: TRANSCRIPT_ASSISTANT_EVENT, payload: { text } }
  }
  if (event.type === "tool_execution_end" && typeof event.toolName === "string") {
    return { type: TRANSCRIPT_TOOL_EVENT, payload: { tool: event.toolName, is_error: event.isError === true } }
  }
  return undefined
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
