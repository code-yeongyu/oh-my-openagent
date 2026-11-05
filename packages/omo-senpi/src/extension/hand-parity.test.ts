/// <reference types="bun-types" />

// omo-senpi on the hand side of a split session (brain/hand plan row O14). The host's own extension loader
// (senpi `loadExtensionFromFactory`) loads the same extension once per side: a fused session names no side,
// the hand's generation names `side: "hand"` and drops every handler declared `runs: "brain"`. These cases run
// omo's real composition through that real loader, so the side filter under test is the host's, not a fake.

import { afterEach, describe, expect, it, spyOn } from "bun:test"
import * as childProcess from "node:child_process"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import { composeOmoSenpiExtension } from "./compose"
import extension, { omoSenpiComponents } from "./index"
import type { OmoSenpiComponent } from "./types"

type ExtensionSide = "brain" | "hand"

interface LoadedExtension {
  readonly handlers: Map<string, unknown[]>
  readonly tools: Map<string, { readonly definition: { readonly name: string; readonly parameters: unknown } }>
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

function loadFor(factory: (pi: unknown) => Promise<void>, side: ExtensionSide | undefined): Promise<LoadedExtension> {
  return loader.loadExtensionFromFactory(factory, process.cwd(), eventBus.createEventBus(), loader.createExtensionRuntime(), "<omo-senpi>", {
    sessionKind: "interactive",
    sessionContext: {},
    ...(side === undefined ? {} : { side }),
  })
}

// One component that defers startup work, so composition builds its first-paint gate and nothing else does.
const deferringComponent: OmoSenpiComponent = {
  name: "hand-parity-probe",
  register(_pi, ctx) {
    ctx.deferStartupWork?.("hand-parity-probe", () => undefined)
  },
}

const handExtension = composeOmoSenpiExtension(omoSenpiComponents, { placement: () => "hand" })

function catalog(loaded: LoadedExtension): { tools: Array<{ name: string; parameters: unknown }>; commands: string[]; flags: string[] } {
  return {
    tools: [...loaded.tools.values()].map(({ definition }) => ({ name: definition.name, parameters: definition.parameters })).sort((a, b) => a.name.localeCompare(b.name)),
    commands: [...loaded.commands.keys()].sort(),
    flags: [...loaded.flags.keys()].sort(),
  }
}

describe("omo-senpi composition on the hand side of a split session", () => {
  it("#given the real extension #when the host loads it for the hand #then it registers the same tools, schemas, commands and flags as a fused session", async () => {
    // when
    const fused = await loadFor(extension, undefined)
    const hand = await loadFor(handExtension, "hand")

    // then
    expect(catalog(fused).tools.length).toBeGreaterThan(0)
    expect(catalog(hand)).toEqual(catalog(fused))
  })

  it("#given composition with deferred startup work #when the host loads it for the hand #then no first-paint edge handler is registered there", async () => {
    // when
    const hand = await loadFor(composeOmoSenpiExtension([deferringComponent]), "hand")

    // then
    expect(hand.handlers.get("input") ?? []).toHaveLength(0)
    expect(hand.handlers.get("before_agent_start") ?? []).toHaveLength(0)
  })

  it("#given composition with deferred startup work #when the host loads it fused #then the first-paint edges are registered exactly as today", async () => {
    // when
    const fused = await loadFor(composeOmoSenpiExtension([deferringComponent]), undefined)

    // then
    expect(fused.handlers.get("input") ?? []).toHaveLength(1)
    expect(fused.handlers.get("before_agent_start") ?? []).toHaveLength(1)
  })

  it("#given a hand placement #when composition defers startup work #then the work runs on the next tick with no paint edge", async () => {
    // given
    let ran = 0
    const probe: OmoSenpiComponent = { name: "hand-placement-probe", register: (_pi, ctx) => ctx.deferStartupWork?.("probe", () => { ran += 1 }) }

    // when
    await loadFor(composeOmoSenpiExtension([probe], { placement: () => "hand" }), "hand")
    await new Promise((resolve) => setTimeout(resolve, 1))

    // then
    expect(ran).toBe(1)
  })

  it("#given composition with deferred startup work #when the host loads it for the brain #then the first-paint edges stay on the loop side", async () => {
    // when
    const brain = await loadFor(composeOmoSenpiExtension([deferringComponent]), "brain")

    // then
    expect(brain.handlers.get("input") ?? []).toHaveLength(1)
    expect(brain.handlers.get("before_agent_start") ?? []).toHaveLength(1)
  })
})

describe("omo-senpi composition on the hand side under the win32 profile", () => {
  const realPlatform = Object.getOwnPropertyDescriptor(process, "platform")

  afterEach(() => {
    if (realPlatform !== undefined) Object.defineProperty(process, "platform", realPlatform)
  })

  it("#given simulated win32 #when the host loads the real extension for the hand #then every child process it starts passes windowsHide", async () => {
    // given
    Object.defineProperty(process, "platform", { value: "win32", configurable: true })
    const calls: Array<{ readonly api: string; readonly options: unknown }> = []
    const spies = (["spawn", "execFile", "exec", "fork", "spawnSync", "execFileSync", "execSync"] as const).map((api) =>
      spyOn(childProcess, api).mockImplementation(((...args: unknown[]) => {
        calls.push({ api, options: args.find((arg) => typeof arg === "object" && arg !== null && !Array.isArray(arg)) })
        throw new Error(`hand-parity: ${api} intercepted`)
      }) as never),
    )

    try {
      // when
      await loadFor(handExtension, "hand")
      await new Promise((resolve) => setTimeout(resolve, 1))
    } finally {
      for (const spy of spies) spy.mockRestore()
    }

    // then
    expect(calls.filter((call) => (call.options as { windowsHide?: unknown } | undefined)?.windowsHide !== true)).toEqual([])
  })
})
