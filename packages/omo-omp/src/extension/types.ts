import type { IdleInjectionCoordinator } from "./idle-injection-coordinator"

/**
 * The neutral ToolDefinition shape shared by the adapter. The OMP ExtensionAPI
 * accepts record-shaped tool definitions (name/description/parameters/execute),
 * and the senpi-task factories already produce that record shape; this local
 * type keeps the adapter free of harness type imports while preserving the
 * executable closure for the capture registry.
 */
export interface OmoToolDefinition extends Record<string, unknown> {
  name: string
  label?: string
  description: string
  parameters?: unknown
  // Optional one-line snippet for the Available tools section in the default system prompt (senpi
  // ToolDefinition parity, used by the memory tools to keep themselves discoverable).
  promptSnippet?: string
  // Optional guideline bullets appended to the default system prompt Guidelines section (senpi
  // ToolDefinition parity, used by the memory tools).
  promptGuidelines?: string[]
  // Per-tool execution mode override; the memory tools force "sequential" (senpi ToolDefinition
  // parity) so concurrent memory writes cannot race the writer lock.
  executionMode?: "sequential" | "parallel"
  execute: (toolCallId: string, params: unknown, signal?: unknown, onUpdate?: unknown, ctx?: unknown) => unknown
}

/**
 * Tool-result shape shared by the adapter (senpi AgentToolResult parity). The memory tools build
 * text content plus a structured details record; `isError` is intentionally NOT declared here and is
 * intersected on at the memory tool site, mirroring the senpi convention where the base type omits it.
 */
export interface OmoAgentToolResult<T = unknown> {
  // TextContent parity: the memory tools always produce text content with a required `text` field.
  content: readonly { type: string; text: string }[]
  details: T
}

/**
 * Result of a `tool_call` event handler (senpi ToolCallEventResult parity). The memory guard returns
 * `{ block: true, reason }` to veto cross-identity file access.
 */
export interface OmoToolCallEventResult {
  block?: boolean
  reason?: string
}

/**
 * Result of a `before_agent_start` event handler (senpi BeforeAgentStartEventResult parity). The
 * memory prompt handler only ever composes `systemPrompt`; the message member is kept structurally
 * loose for the OMP shim.
 */
export interface OmoBeforeAgentStartEventResult {
  message?: { customType?: string; content?: unknown; display?: unknown; details?: unknown }
  systemPrompt?: string
}

/**
 * Entry renderer shape (senpi EntryRenderer parity). The memory reflection worker renders completion
 * entries via a shared senpi-task linesComponent; entry/options/theme are kept loose so the renderer
 * stays harness-agnostic.
 */
export type OmoEntryRenderer<T = unknown> = (
  entry: { readonly data?: T },
  options?: unknown,
  theme?: unknown,
) => unknown

/**
 * The OMP ExtensionAPI surface used by the adapter. Loosely typed on purpose —
 * the same contract as the senpi adapter: the harness hands the extension its
 * live API object at load time; every member is guarded before use.
 */
export interface OmpExtensionAPI {
  on(event: string, handler: (payload: unknown, ctx?: unknown) => unknown | Promise<unknown>): void
  events?: {
    emit(name: string, data: unknown): void
    on(name: string, handler: (payload: unknown) => void): () => void
  }
  registerTool(tool: Record<string, unknown>): void
  registerCommand(name: string, options: Record<string, unknown>): void
  registerFlag(
    name: string,
    options: {
      description?: string
      type: "boolean" | "string"
      default?: boolean | string
    },
  ): void
  getFlag(name: string): boolean | string | undefined
  sendMessage(message: Record<string, unknown>, options?: Record<string, unknown>): void | Promise<void>
  sendUserMessage(content: string | readonly Record<string, unknown>[], options?: { deliverAs?: "steer" | "followUp" }): void
  registerRemovedToolHint?(name: string, hint: string): void
  registerMessageRenderer?(customType: string, renderer: unknown): void
  // Declares a standalone stdio MCP server for this extension (senpi ExtensionAPI parity). The
  // memory component uses it to surface the memory tools through tool_search when the user opts into
  // search exposure; hosts without it fall back to direct registration.
  registerMcpServer?(name: string, config: Record<string, unknown>): void
  registerAssistantThinkingRenderer?(renderer: unknown): void
  getActiveTools?(): string[]
  getAllTools?(): unknown[]
  setActiveTools?(names: string[]): Promise<void> | void
}

export interface ComponentLogger {
  info(message: string, details?: unknown): void
  warn(message: string, details?: unknown): void
  error(message: string, details?: unknown): void
}

export interface ComponentContext {
  logger: ComponentLogger
  config: {
    getFlag(name: string): boolean | string | undefined
  }
  // Registration-time capture registry: every full ToolDefinition registered by any omo
  // component, captured with its live execute closure. Absent in isolated component unit tests.
  getCapturedTools?(): readonly OmoToolDefinition[]
  // Single-queue idle-edge injection arbiter. When present, ulw-loop continuation and task
  // completion wakes route through it so one idle edge yields exactly one injection.
  idleCoordinator?: IdleInjectionCoordinator
}

export interface OmoOmpComponent {
  name: string
  register(pi: OmpExtensionAPI, ctx: ComponentContext): void | Promise<void>
}
