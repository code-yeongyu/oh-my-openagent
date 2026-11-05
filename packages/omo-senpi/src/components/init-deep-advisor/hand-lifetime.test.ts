/// <reference types="bun-types" />

// init-deep-advisor on the hand side of a split session (brain/hand plan row O11e). The advisor runs once on the loop
// side's `session_start` (reason startup) and asks through that side's UI; a hand (tools, no agent loop, no UI) never
// emits the event, and must never spawn the advisor's git checks. Loaded through senpi's own loader, so the side
// filter under test is the host's.

import { describe, expect, it } from "bun:test"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import type { ComponentContext, SenpiExtensionAPI } from "../../extension/types"
import { createInitDeepAdvisorComponent } from "./index"

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
  return loader.loadExtensionFromFactory(factory, process.cwd(), eventBus.createEventBus(), loader.createExtensionRuntime(), "<init-deep-advisor>", {
    sessionKind: "interactive",
    sessionContext: {},
    ...(side === undefined ? {} : { side }),
  })
}

function handlerCounts(loaded: LoadedExtension, events: readonly string[]): Record<string, number> {
  return Object.fromEntries(events.map((event) => [event, (loaded.handlers.get(event) ?? []).length]))
}

function loadAdvisor(side: ExtensionSide | undefined): Promise<LoadedExtension> {
  return loadFor((pi) => createInitDeepAdvisorComponent({ runAfterPreflight: async () => undefined }).register(pi, ctx), side)
}

describe("init-deep-advisor on the hand side of a split session", () => {
  it("#given the host loads the advisor for the hand #then its startup handler is not registered there", async () => {
    // when
    const hand = await loadAdvisor("hand")

    // then
    expect(handlerCounts(hand, ["session_start"])).toEqual({ session_start: 0 })
  })

  it("#given the host loads the advisor for the brain or fused #then its startup handler stays on the loop side", async () => {
    // when
    const brain = await loadAdvisor("brain")
    const fused = await loadAdvisor(undefined)

    // then
    expect(handlerCounts(brain, ["session_start"])).toEqual({ session_start: 1 })
    expect(handlerCounts(fused, ["session_start"])).toEqual({ session_start: 1 })
  })
})
