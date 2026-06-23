import type { ParsedToolCall } from "./parser/invoke-extractor"

export type StateContentEvent = { type: "content"; text: string }
export type StateToolStartedEvent = {
  type: "tool_call_started"
  index: number
  id: string
  name: string
}
export type StateToolArgDeltaEvent = {
  type: "tool_call_argument_delta"
  index: number
  argumentsDelta: string
}
export type StateToolCompleteEvent = {
  type: "tool_call_complete"
  index: number
  call: ParsedToolCall
}
export type StateEvent =
  | StateContentEvent
  | StateToolStartedEvent
  | StateToolArgDeltaEvent
  | StateToolCompleteEvent

export type InvokeState = {
  index: number
  id: string
  name: string
  startedEmitted: boolean
  argsCollected: Record<string, unknown>
}

export type StreamingState = {
  mode: "outside" | "inside_wrapper" | "inside_invoke"
  buffer: string
  nextIndex: number
  current: InvokeState | null
}
