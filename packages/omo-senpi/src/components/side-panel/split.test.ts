/// <reference types="bun-types" />

// Plan row O7 (side panel on a split session). The panel is drawn by the UI that runs with the loop: its mount,
// refreshes and teardown must exist only there. The hand of a split session registers none of them, and serves
// the same flag and command. A fused session registers exactly what it registers today.

import { describe, expect, test } from "bun:test"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import { resolveOmoSidePanelSettings } from "@oh-my-opencode/omo-config-core"

import { composeOmoSenpiExtension } from "../../extension/compose"
import { createSidePanelComponent } from "./index"

type ExtensionSide = "brain" | "hand"

interface LoadedExtension {
  readonly handlers: Map<string, unknown[]>
  readonly commands: Map<string, unknown>
  readonly flags: Map<string, unknown>
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

const PANEL_EVENTS = ["session_start", "turn_end", "agent_settled", "message_end", "tool_execution_start", "tool_execution_end", "input", "session_shutdown"] as const

function load(side: ExtensionSide | undefined, withPanel = true): Promise<LoadedExtension> {
  const panel = createSidePanelComponent({
    loadSettings: () => resolveOmoSidePanelSettings({ side_panel: { enabled: true } }),
    loadRuntime: async () => { throw new Error("the panel runtime is not loaded by registration") },
  })
  return loader.loadExtensionFromFactory(composeOmoSenpiExtension(withPanel ? [panel] : []) as (pi: unknown) => Promise<void>, process.cwd(), eventBus.createEventBus(), loader.createExtensionRuntime(), "<omo-senpi>", {
    sessionKind: "interactive",
    sessionContext: {},
    ...(side === undefined ? {} : { side }),
  })
}

function handlerCounts(loaded: LoadedExtension): Record<string, number> {
  return Object.fromEntries(PANEL_EVENTS.map((event) => [event, loaded.handlers.get(event)?.length ?? 0]))
}

describe("side panel on a split session (O7)", () => {
  test("#given the side panel on #when the host loads it for the hand #then it registers none of the panel's handlers beyond what composition itself registers", async () => {
    // given
    const compositionOnly = await load("hand", false)

    // when
    const hand = await load("hand")

    // then
    expect(handlerCounts(hand)).toEqual(handlerCounts(compositionOnly))
  })

  test("#given the side panel on #when the host loads it for the brain #then every panel handler is registered exactly as on a fused session", async () => {
    // when
    const fused = await load(undefined)
    const brain = await load("brain")

    // then
    expect(handlerCounts(fused).session_start).toBeGreaterThan(0)
    expect(handlerCounts(brain)).toEqual(handlerCounts(fused))
  })

  test("#given the side panel on #when the host loads it for the hand #then the hand keeps the same flag and command as a fused session", async () => {
    // when
    const fused = await load(undefined)
    const hand = await load("hand")

    // then
    expect([...fused.commands.keys()].length).toBeGreaterThan(0)
    expect({ commands: [...hand.commands.keys()].sort(), flags: [...hand.flags.keys()].sort() }).toEqual({ commands: [...fused.commands.keys()].sort(), flags: [...fused.flags.keys()].sort() })
  })
})
