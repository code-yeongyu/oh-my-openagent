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

export interface FakeRpcEvent {
  name: string
  data: unknown
}

type FakeExtensionEventHandler = (payload: unknown) => void
const extensionEventHandlers = new WeakMap<FakeExtensionAPI, Map<string, Set<FakeExtensionEventHandler>>>()

export function enableFakeExtensionEvents(pi: FakeExtensionAPI): void {
  const handlersByName = new Map<string, Set<FakeExtensionEventHandler>>()
  extensionEventHandlers.set(pi, handlersByName)
  pi.events = {
    emit: (name, data) => emitFakeExtensionEvent(pi, name, data),
    on: (name, handler) => {
      const handlers = handlersByName.get(name) ?? new Set<FakeExtensionEventHandler>()
      handlers.add(handler)
      handlersByName.set(name, handlers)
      return () => {
        handlers.delete(handler)
      }
    },
  }
}

export function emitFakeExtensionEvent(pi: FakeExtensionAPI, name: string, payload: unknown): void {
  for (const handler of extensionEventHandlers.get(pi)?.get(name) ?? []) handler(payload)
}

export function fakeExtensionEventHandlerCount(pi: FakeExtensionAPI, name: string): number {
  return extensionEventHandlers.get(pi)?.get(name)?.size ?? 0
}

/**
 * One finished host run: `agent_end`, then the `agent_settled` edge the host emits once no automatic
 * retry, compaction or queued continuation will run. The plan-continuation producers decide on that
 * second edge, so a test that dispatches only `agent_end` is asserting a run the host still owns.
 * Returns the `agent_end` results so handler-result assertions stay unchanged.
 */
export async function dispatchRunEnd(pi: FakeExtensionAPI, payload: unknown, ctx?: unknown): Promise<unknown[]> {
  const results = await pi.dispatch("agent_end", payload, ctx)
  await pi.dispatch("agent_settled", { type: "agent_settled" }, ctx)
  return results
}

export class FakeExtensionAPI implements SenpiExtensionAPI {
  // Mirrors the host's per-session cwd; left undefined to emulate hosts that predate it.
  cwd?: string
  readonly handlers: Array<{ event: string; handler: FakeEventHandler }> = []
  readonly tools: Record<string, unknown>[] = []
  readonly commands: FakeCommandRegistration[] = []
  readonly flags: FakeFlagRegistration[] = []
  readonly messages: FakeSendMessageCall[] = []
  readonly userMessages: FakeSendUserMessageCall[] = []
  readonly messageRenderers: FakeMessageRendererRegistration[] = []
  readonly mcpServers: Array<{ name: string; config: Record<string, unknown> }> = []
  readonly rpcEvents: FakeRpcEvent[] = []
  // Session-scoped model spies (senpi ExtensionAPI.setSessionModel / setSessionThinkingLevel).
  // No persisting model setter exists here on purpose: the senpi one writes the global default.
  // Optional so hand-built fakes typed as `Omit<FakeExtensionAPI, ...>` literals keep compiling.
  readonly sessionModels?: unknown[] = []
  readonly sessionThinkingLevels?: string[] = []
  readonly setSessionModel?: (model: unknown) => Promise<boolean> = async (model) => {
    this.sessionModels?.push(model)
    return true
  }
  readonly setSessionThinkingLevel?: (level: string) => void = (level) => {
    this.sessionThinkingLevels?.push(level)
  }
  events?: SenpiExtensionAPI["events"]
  rpc?: { emit(name: string, data: unknown): void }

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
