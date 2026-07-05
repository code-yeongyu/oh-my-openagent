export interface SenpiExtensionAPI {
  on(event: string, handler: (payload: unknown, ctx?: unknown) => unknown | Promise<unknown>): void
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
}

export interface OmoSenpiComponent {
  name: string
  register(pi: SenpiExtensionAPI, ctx: ComponentContext): void | Promise<void>
}
