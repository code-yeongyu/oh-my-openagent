/// <reference types="bun-types" />

// feedback on the hand side of a split session (brain/hand plan row O11d). Reports attach the session they describe,
// which the component learns from `session_start` / `session_shutdown`; only the loop side emits them, and that is
// where the session and its UI live. The commands stay in the catalog on both sides. Loaded through senpi's own
// loader, so the side filter under test is the host's.

import { describe, expect, it } from "bun:test"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import type { ComponentContext, SenpiExtensionAPI } from "../../extension/types"
import { createFeedbackComponent } from "./index"

type ExtensionSide = "brain" | "hand"

interface LoadedExtension {
  readonly handlers: Map<string, unknown[]>
  readonly commands: Map<string, unknown>
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
  return loader.loadExtensionFromFactory(factory, process.cwd(), eventBus.createEventBus(), loader.createExtensionRuntime(), "<feedback>", {
    sessionKind: "interactive",
    sessionContext: {},
    ...(side === undefined ? {} : { side }),
  })
}

function handlerCounts(loaded: LoadedExtension, events: readonly string[]): Record<string, number> {
  return Object.fromEntries(events.map((event) => [event, (loaded.handlers.get(event) ?? []).length]))
}

const SESSION_EVENTS = ["session_start", "session_shutdown"] as const

function loadFeedback(side: ExtensionSide | undefined): Promise<LoadedExtension> {
  return loadFor((pi) => createFeedbackComponent({ env: {}, omoVersion: "0.0.0-test", senpiVersion: "0.0.0-test" }).register(pi, ctx), side)
}

describe("feedback on the hand side of a split session", () => {
  it("#given the host loads feedback for the hand #then no session-tracking handler is registered there", async () => {
    // when
    const hand = await loadFeedback("hand")

    // then
    expect(handlerCounts(hand, SESSION_EVENTS)).toEqual({ session_start: 0, session_shutdown: 0 })
  })

  it("#given the host loads feedback for the brain or fused #then session tracking stays on the loop side", async () => {
    // when
    const brain = await loadFeedback("brain")
    const fused = await loadFeedback(undefined)

    // then
    expect(handlerCounts(brain, SESSION_EVENTS)).toEqual({ session_start: 1, session_shutdown: 1 })
    expect(handlerCounts(fused, SESSION_EVENTS)).toEqual({ session_start: 1, session_shutdown: 1 })
  })

  it("#given the host loads feedback for the hand #then /feedback and /bug stay in its catalog", async () => {
    // when
    const hand = await loadFeedback("hand")

    // then
    expect([...hand.commands.keys()].sort()).toEqual(["bug", "feedback"])
  })
})
