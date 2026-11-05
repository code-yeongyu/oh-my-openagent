/// <reference types="bun-types" />

// x-search on the hand side of a split session (brain/hand plan row O11i). `x_search` executes where the session's
// tools run, so a hand must register it exactly as a fused session does; its conditional skill feeds the loop side's
// skills index through `resources_discover` and belongs there. Loaded through senpi's own loader, so the side filter
// under test is the host's.

import { afterAll, describe, expect, it } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import type { ComponentContext, SenpiExtensionAPI } from "../../extension/types"
import { createXSearchComponent, X_SEARCH_TOOL_NAME } from "./index"

type ExtensionSide = "brain" | "hand"

interface LoadedExtension {
  readonly handlers: Map<string, unknown[]>
  readonly tools: Map<string, { readonly definition: { readonly name: string; readonly description?: unknown; readonly parameters: unknown } }>
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
  return loader.loadExtensionFromFactory(factory, process.cwd(), eventBus.createEventBus(), loader.createExtensionRuntime(), "<x-search>", {
    sessionKind: "interactive",
    sessionContext: {},
    ...(side === undefined ? {} : { side }),
  })
}

function handlerCounts(loaded: LoadedExtension, events: readonly string[]): Record<string, number> {
  return Object.fromEntries(events.map((event) => [event, (loaded.handlers.get(event) ?? []).length]))
}

const agentDir = mkdtempSync(join(tmpdir(), "omo-x-search-hand-"))
const skillPath = fileURLToPath(new URL("./skill/SKILL.md", import.meta.url))

afterAll(() => rmSync(agentDir, { recursive: true, force: true }))

function loadXSearch(side: ExtensionSide | undefined): Promise<LoadedExtension> {
  return loadFor((pi) => createXSearchComponent({ agentDir, env: { XAI_API_KEY: "test-key" }, resolveSkillPath: () => skillPath }).register(pi, ctx), side)
}

function xSearchDefinition(loaded: LoadedExtension): { name: string; description: unknown; parameters: unknown } | undefined {
  const definition = loaded.tools.get(X_SEARCH_TOOL_NAME)?.definition
  return definition === undefined ? undefined : { name: definition.name, description: definition.description, parameters: definition.parameters }
}

describe("x-search on the hand side of a split session", () => {
  it("#given an xAI credential #when the host loads the component for the hand #then x_search is registered exactly as on a fused session", async () => {
    // when
    const fused = await loadXSearch(undefined)
    const hand = await loadXSearch("hand")

    // then
    expect(xSearchDefinition(fused)).toBeDefined()
    expect(xSearchDefinition(hand)).toEqual(xSearchDefinition(fused))
  })

  it("#given an xAI credential #when the host loads the component for the hand #then the skill contribution is not registered there", async () => {
    // when
    const hand = await loadXSearch("hand")

    // then
    expect(handlerCounts(hand, ["resources_discover"])).toEqual({ resources_discover: 0 })
  })

  it("#given an xAI credential #when the host loads the component for the brain or fused #then the skill contribution stays on the loop side", async () => {
    // when
    const brain = await loadXSearch("brain")
    const fused = await loadXSearch(undefined)

    // then
    expect(handlerCounts(brain, ["resources_discover"])).toEqual({ resources_discover: 1 })
    expect(handlerCounts(fused, ["resources_discover"])).toEqual({ resources_discover: 1 })
  })
})
