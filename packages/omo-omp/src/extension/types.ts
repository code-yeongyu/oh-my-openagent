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
  execute: (toolCallId: string, params: unknown, signal?: unknown, onUpdate?: unknown, ctx?: unknown) => unknown
}

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
