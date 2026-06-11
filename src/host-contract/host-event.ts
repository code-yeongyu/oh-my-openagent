import type { JsonValue } from "./host-config"
import type { HostMessageContent, HostSessionContext, HostSessionMessage } from "./host-session"
import type { HostToolContent } from "./host-tool"

export type HostEventName =
  | "session_start"
  | "session_shutdown"
  | "session_before_compact"
  | "session_compact"
  | "session_compacting"
  | "tool_call"
  | "tool_result"
  | "context"
  | "before_agent_start"
  | "before_provider_request"
  | "after_provider_response"
  | "turn_start"
  | "turn_end"
  | "agent_start"
  | "agent_end"
  | "input"

export type HostEventBase<TName extends HostEventName = HostEventName> = {
  type: TName
  session: HostSessionContext
}

export type HostSpecializedEventName =
  | "tool_call"
  | "tool_result"
  | "context"
  | "before_agent_start"
  | "before_provider_request"
  | "after_provider_response"

export type HostSimpleEventName = Exclude<HostEventName, HostSpecializedEventName>

export type HostSimpleEvent = HostEventBase<HostSimpleEventName> & {
  metadata?: Record<string, JsonValue>
}

export type HostToolCallEvent = HostEventBase<"tool_call"> & {
  toolCallId: string
  toolName: string
  input: Record<string, JsonValue>
}

export type HostToolResultEvent = HostEventBase<"tool_result"> & {
  toolCallId: string
  toolName: string
  input: Record<string, JsonValue>
  content: readonly HostToolContent[]
  details?: unknown
  isError: boolean
}

export type HostContextEvent = HostEventBase<"context"> & {
  messages: readonly HostSessionMessage[]
}

export type HostBeforeAgentStartEvent = HostEventBase<"before_agent_start"> & {
  prompt: string
  systemPrompt: string | readonly string[]
  images?: readonly HostMessageContent[]
}

export type HostProviderRequestEvent = HostEventBase<"before_provider_request"> & {
  payload: unknown
}

export type HostProviderResponseEvent = HostEventBase<"after_provider_response"> & {
  status?: number
  headers?: Readonly<Record<string, string>>
}

export type HostEvent =
  | HostSimpleEvent
  | HostToolCallEvent
  | HostToolResultEvent
  | HostContextEvent
  | HostBeforeAgentStartEvent
  | HostProviderRequestEvent
  | HostProviderResponseEvent

export type HostEventResult =
  | void
  | {
      block?: boolean
      reason?: string
      messages?: readonly HostSessionMessage[]
      systemPrompt?: string | readonly string[]
      payload?: unknown
      content?: readonly HostToolContent[]
      details?: unknown
      isError?: boolean
      metadata?: Record<string, JsonValue>
    }

export type HostEventHandler<TEvent extends HostEvent = HostEvent> = (
  event: TEvent,
) => Promise<HostEventResult> | HostEventResult

export type HostEventRegistry = {
  on<TEvent extends HostEvent>(eventName: TEvent["type"], handler: HostEventHandler<TEvent>): void
}
