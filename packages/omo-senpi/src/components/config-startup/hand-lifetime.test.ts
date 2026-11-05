/// <reference types="bun-types" />

// config-startup on the hand side of a split session (brain/hand plan row O11b). Startup notices are delivered once on
// `session_start`, which only the loop side emits; a hand computes the same migration and config diagnostics for its
// own machine and must not lose them. The component is loaded through senpi's own loader, so the side filter under
// test is the host's.

import { describe, expect, it } from "bun:test"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import type { ComponentContext, SenpiExtensionAPI } from "../../extension/types"
import type { SenpiOmoConfigResult } from "../config-resolution"
import { createConfigStartupComponent, type SenpiStartupMigrationResult } from "./index"

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


function loadFor(register: (pi: SenpiExtensionAPI) => void, side: ExtensionSide | undefined): Promise<LoadedExtension> {
  const factory = async (pi: unknown): Promise<void> => register(pi as SenpiExtensionAPI)
  return loader.loadExtensionFromFactory(factory, process.cwd(), eventBus.createEventBus(), loader.createExtensionRuntime(), "<config-startup>", {
    sessionKind: "interactive",
    sessionContext: {},
    ...(side === undefined ? {} : { side }),
  })
}

function handlerCounts(loaded: LoadedExtension, events: readonly string[]): Record<string, number> {
  return Object.fromEntries(events.map((event) => [event, (loaded.handlers.get(event) ?? []).length]))
}

const migration: SenpiStartupMigrationResult = { journalResumed: false, migratedFrom: ["/home/alice/.config/opencode/oh-my-openagent.jsonc"], results: [] }
const config: SenpiOmoConfigResult = {
  config: {},
  diagnostics: [{ kind: "parse", message: "JSONC parse error", path: "/home/alice/.omo/omo.jsonc" }],
  layers: [],
  sources: [],
}
const NOTICES = [
  "info:OmO Native: migrated legacy configuration from /home/alice/.config/opencode/oh-my-openagent.jsonc",
  "warn:OmO Native: configuration diagnostics: JSONC parse error",
]

function context(logs: string[]): ComponentContext {
  return {
    config: { getFlag: () => undefined },
    logger: { error() {}, info: (message) => logs.push(`info:${message}`), warn: (message) => logs.push(`warn:${message}`) },
  }
}

function loadStartup(side: ExtensionSide | undefined, logs: string[], placement?: "fused" | "hand"): Promise<LoadedExtension> {
  return loadFor((pi) => {
    void createConfigStartupComponent({
      argv: [],
      loadConfig: () => config,
      resolveCwd: () => "/project",
      runMigration: () => migration,
      ...(placement === undefined ? {} : { placement: () => placement }),
    }).register(pi, context(logs))
  }, side)
}

describe("config-startup on the hand side of a split session", () => {
  it("#given the host loads the component for the hand #then the session_start notice handler is not registered there", async () => {
    // when
    const hand = await loadStartup("hand", [])

    // then
    expect(handlerCounts(hand, ["session_start"])).toEqual({ session_start: 0 })
  })

  it("#given a hand placement #when the component registers #then its startup notices are logged once and no notice handler waits for a loop event", async () => {
    // given
    const logs: string[] = []

    // when
    const hand = await loadStartup("hand", logs, "hand")

    // then
    expect(logs).toEqual(NOTICES)
    expect(handlerCounts(hand, ["session_start"])).toEqual({ session_start: 0 })
  })

  it("#given the brain or a fused session #then the notice handler is registered and nothing is logged at load", async () => {
    // given
    const logs: string[] = []

    // when
    const brain = await loadStartup("brain", logs)
    const fused = await loadStartup(undefined, logs)

    // then
    expect(handlerCounts(brain, ["session_start"])).toEqual({ session_start: 1 })
    expect(handlerCounts(fused, ["session_start"])).toEqual({ session_start: 1 })
    expect(logs).toEqual([])
  })
})
