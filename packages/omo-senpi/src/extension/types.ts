import type { ToolDefinition } from "@code-yeongyu/senpi"

import type { IdleInjectionCoordinator } from "./idle-injection-coordinator"

export interface SenpiExtensionAPI {
  on(event: string, handler: (payload: unknown, ctx?: unknown) => unknown | Promise<unknown>): void
  events?: {
    emit(name: string, payload: unknown): void
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
  sendMessage(message: Record<string, unknown>, options?: Record<string, unknown>): void
  sendUserMessage(content: string | readonly Record<string, unknown>[], options?: { deliverAs?: "steer" | "followUp" }): void
  registerMessageRenderer?(customType: string, renderer: unknown): void
  registerMcpServer?(name: string, config: Record<string, unknown>): void
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
  // Registration-time capture registry (todo 17): every full ToolDefinition registered by any omo
  // component, captured with its live execute closure. Absent in isolated component unit tests.
  getCapturedTools?(): readonly ToolDefinition[]
  // Single-queue idle-edge injection arbiter (todo 17). When present, ulw-loop continuation and task
  // completion wakes route through it so one idle edge yields exactly one injection.
  idleCoordinator?: IdleInjectionCoordinator
}

export interface OmoSenpiComponent {
  name: string
  register(pi: SenpiExtensionAPI, ctx: ComponentContext): void | Promise<void>
}
