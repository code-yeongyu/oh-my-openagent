/// <reference types="bun-types" />

// desktop-toolkit on the hand side of a split session (brain/hand plan row O11f). The app grants a toolkit over the
// session host's RPC, and the grant is a loopback endpoint on the app's own machine, so discovery and the toolkit tools
// belong to the agent-loop side; a hand (tools, no agent loop) gets none of the discovery events and could not reach
// that endpoint from another machine. Loaded through senpi's own loader, so the side filter under test is the host's.

import { afterEach, describe, expect, it } from "bun:test"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import type { ComponentContext, SenpiExtensionAPI } from "../../extension/types"
import { createDesktopToolkitComponent, DESKTOP_TOOLKIT_TOOL_NAME } from "./index"
import { createDesktopToolkitRuntime } from "./runtime"
import { cleanup, mcp, setup } from "./thread-tools-test-support"

type ExtensionSide = "brain" | "hand"

interface LoadedExtension {
  readonly handlers: Map<string, unknown[]>
  readonly tools: Map<string, { readonly definition: Record<string, unknown> }>
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

function loadFor(register: (pi: SenpiExtensionAPI) => void, side: ExtensionSide | undefined, sessionContext: Record<string, string> = {}): Promise<LoadedExtension> {
  const factory = async (pi: unknown): Promise<void> => register(pi as SenpiExtensionAPI)
  return loader.loadExtensionFromFactory(factory, process.cwd(), eventBus.createEventBus(), loader.createExtensionRuntime(), "<desktop-toolkit>", {
    sessionKind: "interactive",
    sessionContext,
    ...(side === undefined ? {} : { side }),
  })
}

function handlerCounts(loaded: LoadedExtension, events: readonly string[]): Record<string, number> {
  return Object.fromEntries(events.map((event) => [event, (loaded.handlers.get(event) ?? []).length]))
}

const DISCOVERY_EVENTS = ["session_start", "before_agent_start", "session_shutdown"] as const
const OFFERED = { omo_toolkits: "thread" }

function loadRuntime(side: ExtensionSide | undefined): Promise<LoadedExtension> {
  return loadFor((pi) => createDesktopToolkitRuntime({ timeoutMs: 1 }).register(pi, ctx), side, OFFERED)
}

function toolkitSides(loaded: LoadedExtension): Record<string, unknown> {
  return Object.fromEntries([...loaded.tools.entries()].map(([name, { definition }]) => [name, definition.runs]))
}

describe("desktop-toolkit on the hand side of a split session", () => {
  afterEach(cleanup)

  it("#given a session offered a toolkit #when the host loads the runtime for the hand #then no discovery handler is registered there, so it never asks for a grant", async () => {
    // when
    const hand = await loadRuntime("hand")

    // then
    expect(handlerCounts(hand, DISCOVERY_EVENTS)).toEqual({ session_start: 0, before_agent_start: 0, session_shutdown: 0 })
  })

  it("#given a session offered a toolkit #when the host loads the runtime for the brain or fused #then discovery stays on the loop side", async () => {
    // when
    const brain = await loadRuntime("brain")
    const fused = await loadRuntime(undefined)

    // then
    expect(handlerCounts(brain, DISCOVERY_EVENTS)).toEqual({ session_start: 1, before_agent_start: 1, session_shutdown: 1 })
    expect(handlerCounts(fused, DISCOVERY_EVENTS)).toEqual({ session_start: 1, before_agent_start: 1, session_shutdown: 1 })
  })

  it("#given either toolkit entry #then the acquisition tool is declared for the loop side", async () => {
    // when
    const offered = await loadRuntime(undefined)
    const unoffered = await loadFor((pi) => {
      void createDesktopToolkitComponent().register(pi, ctx)
    }, undefined)

    // then
    expect(toolkitSides(offered)[DESKTOP_TOOLKIT_TOOL_NAME]).toBe("brain")
    expect(toolkitSides(unoffered)[DESKTOP_TOOLKIT_TOOL_NAME]).toBe("brain")
  })

  it("#given the app grants the thread toolkit #when discovery registers its tools #then each desktop tool is declared for the loop side", async () => {
    // given
    const stub = await mcp({ sse: false })
    const host = await setup({ reply: () => ({ grant: stub.grant }) })

    // when
    await host.start()

    // then
    expect(host.tools().map((tool) => [tool.name, tool.runs])).toEqual([["desktop_thread_organize", "brain"]])
  })
})
