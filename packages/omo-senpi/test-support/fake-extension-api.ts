import type { SenpiExtensionAPI } from "../src/extension/types"

export type FakeEventHandler = (payload: unknown, ctx?: unknown) => unknown | Promise<unknown>

export interface FakeMessageRendererRegistration {
  customType: string
  renderer: unknown
}

export interface FakeFlagRegistration {
  name: string
  options: {
    description?: string
    type: "boolean" | "string"
    default?: boolean | string
  }
}

export interface FakeCommandRegistration {
  name: string
  options: Record<string, unknown>
}

export interface FakeSendMessageCall {
  message: Record<string, unknown>
  options?: Record<string, unknown>
}

export interface FakeSendUserMessageCall {
  content: string | readonly Record<string, unknown>[]
  options?: { deliverAs?: "steer" | "followUp" }
}

export class FakeExtensionAPI implements SenpiExtensionAPI {
  readonly handlers: Array<{ event: string; handler: FakeEventHandler }> = []
  readonly tools: Record<string, unknown>[] = []
  readonly commands: FakeCommandRegistration[] = []
  readonly flags: FakeFlagRegistration[] = []
  readonly messages: FakeSendMessageCall[] = []
  readonly userMessages: FakeSendUserMessageCall[] = []
  readonly messageRenderers: FakeMessageRendererRegistration[] = []
  readonly mcpServers: Array<{ name: string; config: Record<string, unknown> }> = []
  events?: SenpiExtensionAPI["events"]

  private readonly flagValues = new Map<string, boolean | string | undefined>()

  on(event: string, handler: FakeEventHandler): void {
    this.handlers.push({ event, handler })
  }

  registerTool(tool: Record<string, unknown>): void {
    this.tools.push(tool)
  }

  registerMessageRenderer(customType: string, renderer: unknown): void {
    this.messageRenderers.push({ customType, renderer })
  }

  registerCommand(name: string, options: Record<string, unknown>): void {
    this.commands.push({ name, options })
  }

  registerFlag(name: string, options: FakeFlagRegistration["options"]): void {
    this.flags.push({ name, options })
    if (!this.flagValues.has(name)) {
      this.flagValues.set(name, options.default)
    }
  }

  getFlag(name: string): boolean | string | undefined {
    return this.flagValues.get(name)
  }

  setFlag(name: string, value: boolean | string | undefined): void {
    this.flagValues.set(name, value)
  }

  sendMessage(message: Record<string, unknown>, options?: Record<string, unknown>): void {
    this.messages.push({ message, options })
  }

  sendUserMessage(content: string | readonly Record<string, unknown>[], options?: { deliverAs?: "steer" | "followUp" }): void {
    this.userMessages.push({ content, options })
  }

  registerMcpServer(name: string, config: Record<string, unknown>): void {
    this.mcpServers.push({ name, config })
  }

  async dispatch(event: string, payload: unknown, ctx?: unknown): Promise<unknown[]> {
    const results: unknown[] = []
    for (const registration of this.handlers) {
      if (registration.event !== event) {
        continue
      }
      results.push(await registration.handler(payload, ctx))
    }
    return results
  }
}
