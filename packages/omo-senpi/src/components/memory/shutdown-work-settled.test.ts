// The session_shutdown drain waits for every memory read still running in the identity repository: a git child left
// there holds the directory, and on Windows the next remove of it fails with EBUSY (#11135). One row per entry point
// that can start such a read while a shutdown runs. Each row parks the read at a gate, calls the settle the drain
// awaits for it, and opens the gate on the next macrotask: that settle must resolve only after the gated work.

import { afterEach, describe, expect, it } from "bun:test"
import { join } from "node:path"

import { GitMemoryRepo, InFlightReads, MemoryBlockCache, RecallCorpusCache, type ReservedRun } from "@oh-my-opencode/memory-core"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { fixture as dreamFixture } from "./dream-trigger.test-support"
import { trackMemoryHooks } from "./hook-work"
import { createMemoryComponent, resolveMemoryConfig } from "./index"
import { MemoryFakeExtensionAPI, componentContext, loadedMemoryConfig, memorySettings } from "./memory.test-support"
import { createPressureDreamAdmission } from "./pressure-dream-admission"
import { loadRecallStoreRuntime } from "./recall-store-runtime-loader"
import { createSessionBinder, readSessionSurface, releaseSession, type SessionState } from "./session-binding"
import {
  AGENT_ID,
  EMPTY_SWEEP,
  HeadGatedRepo,
  gate,
  gatedStep,
  idleSyncRunner,
  launchlessRuntime,
  removeTempRoots,
  seededRepoDir,
  sessionEventContext,
  tempRoot,
  type Gate,
} from "./shutdown-work.test-support"

const TEMPLATE = "raw prompt {CORE_MEMORY}"
const OPTIONS = { agentId: AGENT_ID }
const TIMEOUT = process.platform === "win32" ? 20_000 : 5_000

afterEach(removeTempRoots)

interface Started {
  readonly settle: () => Promise<void>
  readonly finished: Promise<unknown>
  readonly cleanup?: () => void
}

interface Row {
  readonly name: string
  start(held: Gate, work: InFlightReads): Promise<Started>
}

function cacheRow(name: string, start: (held: Gate) => Promise<{ cache: { settled(): Promise<void> }; finished: Promise<unknown> }>): Row {
  return {
    name,
    async start(held) {
      const { cache, finished } = await start(held)
      return { settle: () => cache.settled(), finished }
    },
  }
}

const cacheRows: readonly Row[] = [
  cacheRow("a block-cache remember() compute with no persisted store", async (held) => {
    const cache = new MemoryBlockCache()
    const { step } = gatedStep(held)
    const repo = new GitMemoryRepo({ dir: await seededRepoDir(), agentId: AGENT_ID })
    return { cache, finished: cache.remember(repo, "estimate", "revision", async () => ({ value: String(await step()), persist: true })) }
  }),
  cacheRow("a block-cache remember() still loading its persisted store", async (held) => {
    const cache = new MemoryBlockCache({
      storeBudgetMs: 60_000,
      store: async () => {
        await gatedStep(held).step()
        return loadRecallStoreRuntime()
      },
    })
    const repo = new GitMemoryRepo({ dir: await seededRepoDir(), agentId: AGENT_ID })
    return { cache, finished: cache.remember(repo, "estimate", "revision", async () => ({ value: "1", persist: true })) }
  }),
  cacheRow("a block-cache compile() still reading HEAD", async (held) => {
    const cache = new MemoryBlockCache()
    return { cache, finished: cache.compile(new HeadGatedRepo(await seededRepoDir(), held), TEMPLATE, OPTIONS) }
  }),
  cacheRow("block-cache track()ed work, such as the bind-time prebuild's HEAD read", async (held) => {
    const cache = new MemoryBlockCache()
    const repo = new HeadGatedRepo(await seededRepoDir(), held)
    return { cache, finished: cache.track(async () => cache.compile(repo, TEMPLATE, OPTIONS, await repo.head())) }
  }),
  cacheRow("a recall corpus load() still reading HEAD", async (held) => {
    const cache = new RecallCorpusCache({ head: async (repo) => (await gatedStep(held).step(), repo.head()) })
    return { cache, finished: cache.load(new GitMemoryRepo({ dir: await seededRepoDir(), agentId: AGENT_ID })) }
  }),
]

function registeredMemory(): { readonly events: readonly string[]; readonly tools: readonly string[] } {
  const pi = new MemoryFakeExtensionAPI()
  createMemoryComponent({
    env: { OMO_MEMORY_HOME: join("unused-memory-root", "memory") },
    loadConfig: () => loadedMemoryConfig(memorySettings()),
    resolveCwd: () => "unused-project",
    sweepTransientRuns: async () => EMPTY_SWEEP,
    syncRunner: idleSyncRunner,
    createRuntime: launchlessRuntime,
  }).register(pi, componentContext())
  return {
    events: [...new Set(pi.handlers.map((registration) => registration.event))].filter((event) => event !== "session_shutdown").sort(),
    tools: pi.tools.map((tool) => String(tool.name)).sort(),
  }
}

const registered = registeredMemory()

const hookRows: readonly Row[] = registered.events.map((event) => ({
  name: `a memory ${event} hook`,
  async start(held, work) {
    const api = new FakeExtensionAPI()
    trackMemoryHooks(api, work).on(event, gatedStep(held).step)
    return { settle: () => work.settled(), finished: api.dispatch(event, {}, undefined) }
  },
}))

const toolRows: readonly Row[] = registered.tools.map((name) => ({
  name: `a ${name} tool call, which the host aborts only after the shutdown drain on quit`,
  async start(held, work) {
    const api = new FakeExtensionAPI()
    trackMemoryHooks(api, work).registerTool({ name, execute: gatedStep(held).step })
    const execute = api.tools.at(-1)?.execute
    if (typeof execute !== "function") throw new Error(`the ${name} tool registered no execute`)
    return { settle: () => work.settled(), finished: Promise.resolve(Reflect.apply(execute, undefined, [])) }
  },
}))

const detachedRows: readonly Row[] = [
  {
    name: "the bind-time reconcile a session bind floats past the bind",
    async start(held, work) {
      const root = await tempRoot("omo-shutdown-work-bind-")
      const { step, finished } = gatedStep(held)
      const sessions = new Map<string, SessionState>()
      const eventCtx = sessionEventContext("session-bind")
      createSessionBinder({
        pi: new MemoryFakeExtensionAPI(),
        ctx: componentContext(),
        env: { OMO_MEMORY_HOME: join(root, "memory") },
        now: Date.now,
        cwd: join(root, "project"),
        loadConfig: () => loadedMemoryConfig(memorySettings()),
        sessions,
        wiring: { afterBind: step },
        syncRunner: idleSyncRunner,
        work,
        isEnabled: () => true,
        resolveConfig: resolveMemoryConfig,
      })(readSessionSurface(eventCtx), eventCtx, { existing: undefined, verifyRepository: false })
      return { settle: () => work.settled(), finished, cleanup: () => releaseSession(sessions.get("session-bind")) }
    },
  },
  {
    name: "a pressure dream request, which runs detached from its caller",
    async start(held, work) {
      const { step, finished } = gatedStep(held)
      createPressureDreamAdmission({ request: step, work }).deferOrRequest("session-pressure", true)
      return { settle: () => work.settled(), finished }
    },
  },
  {
    name: "an idle dream fire from the idle timer",
    async start(held, work) {
      const run: ReservedRun = { runId: "run-idle", request: { trigger: "dream", origin: "idle", conversationIds: [], snapshots: [] } }
      const f = await dreamFixture({
        work,
        reservationStore: { tryReserve: async () => (await gatedStep(held).step(), { status: "active", run }) },
      })
      await f.pi.dispatch("agent_settled", { type: "agent_settled" }, f.eventCtx)
      f.scheduler.latest().fire()
      return { settle: () => work.settled(), finished: f.wiring.whenIdle() }
    },
  },
]

describe("memory shutdown waits for in-flight reads", () => {
  for (const row of [...cacheRows, ...hookRows, ...toolRows, ...detachedRows]) {
    it(`#given ${row.name} #when the settle the shutdown drain awaits runs #then it resolves only after that work`, async () => {
      // given
      const held = gate()
      const started = await row.start(held, new InFlightReads())
      try {
        await held.entered
        const order: string[] = []
        const finished = started.finished.then(() => order.push("work-finished"))

        // when
        const settled = started.settle().then(() => order.push("settled"))
        setImmediate(() => {
          order.push("released")
          held.open()
        })
        await Promise.all([finished, settled])

        // then
        expect(order).toEqual(["released", "work-finished", "settled"])
      } finally {
        held.open()
        started.cleanup?.()
      }
    }, TIMEOUT)
  }

  it("#given a session_shutdown hook still running #when the tracked work settles #then it does not wait on that hook, so the drain never waits on itself", async () => {
    // given
    const work = new InFlightReads()
    const held = gate()
    const api = new FakeExtensionAPI()
    trackMemoryHooks(api, work).on("session_shutdown", gatedStep(held).step)
    const order: string[] = []
    const dispatched = api.dispatch("session_shutdown", {}, undefined).then(() => order.push("shutdown-hook-finished"))
    await held.entered

    // when
    await work.settled()
    order.push("settled")

    // then
    held.open()
    await dispatched
    expect(order).toEqual(["settled", "shutdown-hook-finished"])
  }, TIMEOUT)
})
