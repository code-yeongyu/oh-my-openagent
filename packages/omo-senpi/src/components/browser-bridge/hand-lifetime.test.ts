/// <reference types="bun-types" />

// browser-bridge on the hand side of a split session (brain/hand plan row O11g). Browser work runs on the hand (the
// skill's shell commands and MCP browser tools execute there), but the app's Stop and the user's next message reach the
// loop side. A hand scope is composed with a lifecycle source that delivers both, so the bridge reports what the user
// did for that session only.

import { describe, expect, it } from "bun:test"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import type { ComponentContext, SenpiExtensionAPI } from "../../extension/types"
import type { BrowserBridgeLifecycleSource } from "./hand-lifetime"
import { createBrowserBridgeComponent } from "./index"

type ExtensionSide = "brain" | "hand"

interface LoadedExtension {
  readonly handlers: Map<string, unknown[]>
}

interface SenpiLoader {
  loadExtensionFromFactory(
    factory: (pi: unknown) => Promise<void>,
    cwd: string,
    eventBus: unknown,
    runtime: unknown,
    extensionPath: string,
    session: { sessionKind: "interactive"; sessionContext: Record<string, string>; side?: ExtensionSide },
  ): Promise<LoadedExtension>
  createExtensionRuntime(): unknown
}

const senpiDistDir = dirname(fileURLToPath(import.meta.resolve("@code-yeongyu/senpi")))
const loader = (await import(pathToFileURL(join(senpiDistDir, "core", "extensions", "loader.js")).href)) as SenpiLoader
const eventBus = (await import(pathToFileURL(join(senpiDistDir, "core", "event-bus.js")).href)) as { createEventBus(): unknown }

const ctx: ComponentContext = { logger: { info() {}, warn() {}, error() {} }, config: { getFlag: () => undefined } }

function loadFor(register: (pi: SenpiExtensionAPI) => void, side: ExtensionSide | undefined): Promise<LoadedExtension> {
  const factory = async (pi: unknown): Promise<void> => register(pi as SenpiExtensionAPI)
  return loader.loadExtensionFromFactory(factory, process.cwd(), eventBus.createEventBus(), loader.createExtensionRuntime(), "<browser-bridge>", {
    sessionKind: "interactive",
    sessionContext: {},
    ...(side === undefined ? {} : { side }),
  })
}

function handlerCounts(loaded: LoadedExtension, events: readonly string[]): Record<string, number> {
  return Object.fromEntries(events.map((event) => [event, (loaded.handlers.get(event) ?? []).length]))
}

type BridgeTool = { execute(toolCallId: string, params: { op: string }): Promise<{ details: { stopped: boolean } }> }

class HandScope {
  private readonly stops: Array<() => void> = []
  private readonly messages: Array<() => void> = []
  tool: BridgeTool | undefined
  readonly lifecycle: BrowserBridgeLifecycleSource = {
    onStop: (listener) => void this.stops.push(listener),
    onUserMessage: (listener) => void this.messages.push(listener),
  }
  readonly pi = {
    on() {},
    registerTool: (tool: BridgeTool) => {
      this.tool = tool
    },
  } as unknown as SenpiExtensionAPI

  stop(): void {
    for (const listener of this.stops) listener()
  }

  userMessage(): void {
    for (const listener of this.messages) listener()
  }

  async stopped(): Promise<boolean> {
    const result = await this.tool?.execute("call", { op: "status" })
    return result?.details.stopped ?? false
  }
}

function handBridge(scopes: readonly HandScope[]): void {
  const component = createBrowserBridgeComponent({ lifecycle: (pi) => scopes.find((scope) => scope.pi === pi)?.lifecycle })
  for (const scope of scopes) component.register(scope.pi, ctx)
}

describe("browser-bridge on the hand side of a split session", () => {
  it("#given a hand scope #when the app stops browser use and the user then sends a message #then the bridge reports stopped, then not stopped", async () => {
    // given
    const scope = new HandScope()
    handBridge([scope])

    // when
    scope.stop()
    const afterStop = await scope.stopped()
    scope.userMessage()

    // then
    expect(afterStop).toBe(true)
    expect(await scope.stopped()).toBe(false)
  })

  it("#given two hand scopes #when one session's browser use is stopped #then the other session is not", async () => {
    // given
    const first = new HandScope()
    const second = new HandScope()
    handBridge([first, second])

    // when
    first.stop()

    // then
    expect(await first.stopped()).toBe(true)
    expect(await second.stopped()).toBe(false)
  })

  it("#given the host loads the bridge for the hand #then the user-message handler stays on the loop side", async () => {
    // when
    const register = (pi: SenpiExtensionAPI) => createBrowserBridgeComponent().register(pi, ctx)
    const hand = await loadFor(register, "hand")
    const brain = await loadFor(register, "brain")
    const fused = await loadFor(register, undefined)

    // then
    expect(handlerCounts(hand, ["input"])).toEqual({ input: 0 })
    expect(handlerCounts(brain, ["input"])).toEqual({ input: 1 })
    expect(handlerCounts(fused, ["input"])).toEqual({ input: 1 })
  })
})
