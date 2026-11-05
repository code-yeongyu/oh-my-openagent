/// <reference types="bun-types" />

// native-badge on the hand side of a split session (brain/hand plan row O11c). The badge is a footer status the
// loop side paints on `session_start` and `agent_settled`; a hand (tools, no agent loop, no UI) never emits either.
// These cases load the component through senpi's own loader (`loadExtensionFromFactory`), so the side filter under
// test is the host's, not a fake.

import { describe, expect, it } from "bun:test"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import type { ComponentContext, SenpiExtensionAPI } from "../../extension/types"
import { createNativeBadgeComponent } from "./index"

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
const BADGE_EVENTS = ["session_start", "agent_settled"] as const

function loadBadge(side: ExtensionSide | undefined): Promise<LoadedExtension> {
  const factory = async (pi: unknown): Promise<void> => {
    createNativeBadgeComponent({ env: {} }).register(pi as SenpiExtensionAPI, ctx)
  }
  return loader.loadExtensionFromFactory(factory, process.cwd(), eventBus.createEventBus(), loader.createExtensionRuntime(), "<native-badge>", {
    sessionKind: "interactive",
    sessionContext: {},
    ...(side === undefined ? {} : { side }),
  })
}

function badgeHandlerCounts(loaded: LoadedExtension): Record<string, number> {
  return Object.fromEntries(BADGE_EVENTS.map((event) => [event, (loaded.handlers.get(event) ?? []).length]))
}

describe("native-badge on the hand side of a split session", () => {
  it("#given the host loads the badge for the hand #then neither footer handler is registered there", async () => {
    // when
    const hand = await loadBadge("hand")

    // then
    expect(badgeHandlerCounts(hand)).toEqual({ session_start: 0, agent_settled: 0 })
  })

  it("#given the host loads the badge for the brain #then both footer handlers stay on the loop side", async () => {
    // when
    const brain = await loadBadge("brain")

    // then
    expect(badgeHandlerCounts(brain)).toEqual({ session_start: 1, agent_settled: 1 })
  })

  it("#given a fused session #then both footer handlers are registered exactly as today", async () => {
    // when
    const fused = await loadBadge(undefined)

    // then
    expect(badgeHandlerCounts(fused)).toEqual({ session_start: 1, agent_settled: 1 })
  })
})
