import type { JsonObject, JsonValue } from "./host-config"
import type { HostSessionContext } from "./host-session"

export type HostToolName = string

export type HostToolExecutionMode = "parallel" | "sequential"

export type HostToolContent =
  | { type: "text"; text: string }
  | { type: "image"; mediaType?: string; data?: string; url?: string }
  | { type: "json"; value: JsonValue }

export type HostToolResult<TDetails = unknown> = {
  content: readonly HostToolContent[]
  details?: TDetails
  isError?: boolean
}

export type HostToolUpdate<TDetails = unknown> = {
  partialResult?: HostToolResult<TDetails>
  message?: string
}

export type HostToolUpdateCallback<TDetails = unknown> = (update: HostToolUpdate<TDetails>) => void | Promise<void>

export type HostToolExecuteRequest<TParams extends JsonObject = JsonObject, TDetails = unknown> = {
  toolCallId: string
  name: HostToolName
  input: TParams
  signal?: AbortSignal
  onUpdate?: HostToolUpdateCallback<TDetails>
  session: HostSessionContext
}

export type HostToolExecute<TParams extends JsonObject = JsonObject, TDetails = unknown> = (
  request: HostToolExecuteRequest<TParams, TDetails>,
) => Promise<HostToolResult<TDetails>>

export type HostToolDefinition<TParams extends JsonObject = JsonObject, TDetails = unknown> = {
  name: HostToolName
  label: string
  description: string
  parameters: unknown
  hidden?: boolean
  defaultInactive?: boolean
  gatedBy?: readonly string[]
  mcpServerName?: string
  mcpToolName?: string
  executionMode?: HostToolExecutionMode
  execute: HostToolExecute<TParams, TDetails>
}

export type HostToolRegistry = {
  registerTool<TParams extends JsonObject = JsonObject, TDetails = unknown>(
    tool: HostToolDefinition<TParams, TDetails>,
  ): void
  getActiveTools(): readonly HostToolName[]
  getAllTools(): readonly HostToolName[]
  setActiveTools(toolNames: readonly HostToolName[]): Promise<void>
}
