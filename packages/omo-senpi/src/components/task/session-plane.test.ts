/// <reference types="bun-types" />

// The task component on a split session (brain/hand plan row O3). Task, team, workflow and workpool tools are session
// tools: they run where the loop runs, and so does everything that owns their children (reconcile, host prewarm, DAG
// attach, lead pollers, status UI). The host's own loader (senpi `loadExtensionFromFactory`) loads the extension once
// per side; these cases load the real task component through it, so the side filter under test is the host's.

import { afterEach, describe, expect, it } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import { composeOmoSenpiExtension } from "../../extension/compose"
import { createTaskComponent } from "./index"

type ExtensionSide = "brain" | "hand"

interface LoadedExtension {
  readonly handlers: Map<string, unknown[]>
  readonly tools: Map<string, { readonly definition: { readonly name: string; readonly runs?: ExtensionSide } }>
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

const tempRoots: string[] = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function tempProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "omo-senpi-task-split-"))
  tempRoots.push(dir)
  return dir
}

function taskExtension(cwd: string): (pi: unknown) => Promise<void> {
  return composeOmoSenpiExtension([createTaskComponent({ resolveCwd: () => cwd, loadJobWidgetHost: async () => ({}) })])
}

function load(factory: (pi: unknown) => Promise<void>, cwd: string, side: ExtensionSide | undefined): Promise<LoadedExtension> {
  return loader.loadExtensionFromFactory(factory, cwd, eventBus.createEventBus(), loader.createExtensionRuntime(), "<omo-senpi>", {
    sessionKind: "interactive",
    sessionContext: {},
    ...(side === undefined ? {} : { side }),
  })
}

function handlerCounts(loaded: LoadedExtension): Record<string, number> {
  return Object.fromEntries([...loaded.handlers.entries()].filter(([, handlers]) => handlers.length > 0).map(([event, handlers]) => [event, handlers.length]))
}

describe("task component on a split session", () => {
  it("#given the real task component #when the host loads it for the hand #then it registers no handler beyond composition's own", async () => {
    // given
    const cwd = tempProject()

    // when
    const composition = await load(composeOmoSenpiExtension([]), cwd, "hand")
    const hand = await load(taskExtension(cwd), cwd, "hand")

    // then
    expect(handlerCounts(hand)).toEqual(handlerCounts(composition))
  })

  it("#given the real task component #when the host loads it for the brain #then every handler is registered exactly as on a fused session", async () => {
    // given
    const cwd = tempProject()

    // when
    const fused = await load(taskExtension(cwd), cwd, undefined)
    const brain = await load(taskExtension(cwd), cwd, "brain")

    // then
    expect(Object.keys(handlerCounts(fused)).length).toBeGreaterThan(0)
    expect(handlerCounts(brain)).toEqual(handlerCounts(fused))
  })

  it("#given the real task component #when the host loads it for the hand #then every task tool it lists is declared loop-side", async () => {
    // given
    const cwd = tempProject()

    // when
    const hand = await load(taskExtension(cwd), cwd, "hand")

    // then
    const tools = [...hand.tools.values()].map(({ definition }) => definition)
    expect(tools.length).toBeGreaterThan(0)
    expect(tools.filter((tool) => tool.runs !== "brain").map((tool) => tool.name)).toEqual([])
  })
})
