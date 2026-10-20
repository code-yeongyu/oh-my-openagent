import { afterEach, describe, expect, test } from "bun:test"
import { realpathSync } from "node:fs"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { buildIdentityPaths, RecallCorpusCache } from "@oh-my-opencode/memory-core"
import { createMemoryIdentityContext } from "./context"
import type { MemoryIdentityRuntime } from "./identity-runtime"
import type { MemoryMaintenance } from "./memory-maintenance"
import { MemoryFakeExtensionAPI, componentContext, loadedMemoryConfig, memorySettings } from "./memory.test-support"
import { rmEfaultTolerant } from "./teardown.test-support"
import { createMemoryWiring } from "./wiring"

const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) await rmEfaultTolerant(root, { recursive: true, force: true })
})

type Warning = { readonly message: string; readonly data?: Record<string, unknown> }

// Work that never settles: the only way shutdown can account for it is to race it against the drain budget.
const never = (): Promise<never> => new Promise<never>(() => {})

async function bindAndShutDown(overrides: { maintenance?: MemoryMaintenance; runtime?: MemoryIdentityRuntime; corpusCache?: RecallCorpusCache; budgetMs?: number; whileShuttingDown?: (shutdown: { readonly returned: () => boolean }) => Promise<void> }) {
  const root = realpathSync.native(await mkdtemp(join(tmpdir(), "omo-memory-shutdown-settle-")))
  roots.push(root)
  const identityName = "shutdown-settle-agent"
  const identity = createMemoryIdentityContext({
    identity: identityName,
    identityPaths: buildIdentityPaths(root, identityName),
    binding: { identity: identityName, repoPathHash: "hash", boundAt: 1 },
  })
  const sessionId = "session-shutdown-settle"
  const warnings: Warning[] = []
  const logger = {
    debug: () => {},
    info: () => {},
    warn: (message: string, data?: Record<string, unknown>) => { warnings.push({ message, ...(data === undefined ? {} : { data }) }) },
    error: () => {},
  }
  const wiring = createMemoryWiring({
    sessions: new Map([[sessionId, { context: identity }]]),
    loadConfig: () => loadedMemoryConfig(memorySettings()),
    cwd: () => root,
    env: {},
    logger,
    ...(overrides.maintenance === undefined ? {} : { createMaintenance: () => overrides.maintenance! }),
    ...(overrides.runtime === undefined ? {} : { createRuntime: () => overrides.runtime! }),
    ...(overrides.corpusCache === undefined ? {} : { createCorpusCache: () => overrides.corpusCache! }),
  })
  const pi = new MemoryFakeExtensionAPI()
  wiring.registerStatic(pi, componentContext())
  const eventCtx = {
    sessionManager: { getSessionId: () => sessionId, getEntries: () => [] },
    ui: { setStatus: () => {}, notify: () => {} },
  }
  await wiring.afterBind(pi, sessionId, identity, eventCtx)
  // A settled user turn reconciles the identity runtime, which is where reflection launches start.
  await pi.dispatch("input", { source: "rpc", inputId: "settle-input", text: "Continue." }, eventCtx)
  await pi.dispatch("input_disposition", { inputId: "settle-input", disposition: "started" }, eventCtx)
  await pi.dispatch("agent_settled", {}, eventCtx)
  // A zero budget (the default) reports every raced step as over budget instead of awaiting it.
  let returned = false
  const shutdown = wiring.onSessionShutdown({ reason: "reload", sessionId, deadlineAt: Date.now() + (overrides.budgetMs ?? 0) })
    .then(() => { returned = true })
  await overrides.whileShuttingDown?.({ returned: () => returned })
  await shutdown
  return warnings
    .filter((warning) => warning.message === "memory shutdown drain hit its budget")
    .map((warning) => warning.data?.step)
}

describe("memory wiring shutdown settles maintenance running in the identity dir (#10154)", () => {
  test("#given a maintenance pass is still running #when the session shuts down #then shutdown races it against the drain budget", async () => {
    // given
    const maintenance: MemoryMaintenance = { schedule: () => {}, dispose: () => {}, settled: never }

    // when
    const overBudget = await bindAndShutDown({ maintenance })

    // then
    expect(overBudget).toContain("maintenance-settle")
  })

  test("#given a recall term-store save is still writing into .git #when the session shuts down #then shutdown races it against the drain budget", async () => {
    // given
    class SavingCorpusCache extends RecallCorpusCache {
      override settled(): Promise<void> {
        return never()
      }
    }

    // when
    const overBudget = await bindAndShutDown({ corpusCache: new SavingCorpusCache({ shared: true }) })

    // then
    expect(overBudget).toContain("recall-store-settle")
  })

  test("#given a reflection launch is still in flight #when the session shuts down #then shutdown races it after the drain", async () => {
    // given
    const runtime = {
      reconcile: async () => {},
      store: { tryReserve: async () => ({ status: "skipped" }) },
      launch: () => {},
      settled: never,
    } as unknown as MemoryIdentityRuntime

    // when
    const overBudget = await bindAndShutDown({ runtime })

    // then
    expect(overBudget).toContain("reflection-launch-settle")
  })

  test("#given a reflection launch still in flight and budget to spare #when the session shuts down #then shutdown returns only after the launch settles", async () => {
    // given: settled() is shutdown's last await, so once it is called only synchronous resets remain
    let releaseLaunch!: () => void
    const launchSettled = new Promise<void>((resolve) => { releaseLaunch = resolve })
    let settledCalled!: () => void
    const settledInvoked = new Promise<void>((resolve) => { settledCalled = resolve })
    const runtime = {
      reconcile: async () => {},
      store: { tryReserve: async () => ({ status: "skipped" }) },
      launch: () => {},
      settled: () => {
        settledCalled()
        return launchSettled
      },
    } as unknown as MemoryIdentityRuntime
    let returnedBeforeRelease: boolean | undefined

    // when
    const overBudget = await bindAndShutDown({
      runtime,
      budgetMs: 60_000,
      whileShuttingDown: async (shutdown) => {
        await settledInvoked
        // One macrotask turn drains every microtask: a shutdown that does not await the launch has returned by now.
        await new Promise<void>((resolve) => setImmediate(resolve))
        returnedBeforeRelease = shutdown.returned()
        releaseLaunch()
      },
    })

    // then
    expect(returnedBeforeRelease).toBe(false)
    expect(overBudget).toEqual([])
  })
})
