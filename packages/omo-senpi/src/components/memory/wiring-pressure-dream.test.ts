import { afterEach, describe, expect, test } from "bun:test"
import { realpathSync } from "node:fs"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { buildIdentityPaths, GitMemoryRepo } from "@oh-my-opencode/memory-core"
import type { MemoryIdentityRuntime } from "./identity-runtime"
import { createMemoryIdentityContext } from "./context"
import { MemoryFakeExtensionAPI, componentContext, loadedMemoryConfig, memorySettings } from "./memory.test-support"
import { rmEfaultTolerant } from "./teardown.test-support"
import { createMemoryWiring } from "./wiring"

const roots: string[] = []
const TEMP_ROOT_RELEASE_TIMEOUT_MS = 30_000
const TEMP_ROOT_RELEASE_POLL_MS = 50

async function removeWhenReleased(root: string): Promise<void> {
  const deadline = Date.now() + TEMP_ROOT_RELEASE_TIMEOUT_MS
  for (;;) {
    try {
      await rmEfaultTolerant(root, { recursive: true, force: true })
      return
    } catch (error) {
      // rmEfaultTolerant wraps an exhausted retry as `teardown-failure:`; the errno sits on its cause.
      const code = (error as NodeJS.ErrnoException).code ?? ((error as Error).cause as NodeJS.ErrnoException | undefined)?.code
      if ((code !== "EBUSY" && code !== "EPERM" && code !== "ENOTEMPTY" && code !== "EFAULT") || Date.now() >= deadline) throw error
      await new Promise((resolve) => setTimeout(resolve, TEMP_ROOT_RELEASE_POLL_MS))
    }
  }
}

afterEach(async () => {
  for (const root of roots.splice(0)) await removeWhenReleased(root)
})

describe("memory pressure dream wiring", () => {
  test("#given committed system memory above pressure #when the first accepted turn settles #then one pressure dream launches after input and never before it", async () => {
    const root = realpathSync.native(await mkdtemp(join(tmpdir(), "omo-memory-pressure-dream-wiring-")))
    roots.push(root)
    const identityName = "pressure-dream-agent"
    const paths = buildIdentityPaths(root, identityName)
    const repo = new GitMemoryRepo({ dir: paths.repo, agentId: identityName })
    await repo.init({ seedFiles: [{ relativePath: "system/persona.md", content: "P".repeat(320) }] })
    const identity = createMemoryIdentityContext({
      identity: identityName,
      identityPaths: paths,
      binding: { identity: identityName, repoPathHash: "hash", boundAt: 1 },
    })
    const sessionId = "session-pressure-dream"
    const reservationAttempts: unknown[] = []
    const shutdownWarnings: Array<{ message: string; step: unknown }> = []
    let advisoryObserved!: () => void
    let reservationObserved!: () => void
    const advisory = new Promise<void>((resolve) => { advisoryObserved = resolve })
    const reservation = new Promise<void>((resolve) => { reservationObserved = resolve })
    const runtime = {
      reconcile: async () => {},
      store: {
        tryReserve: async (request: unknown) => {
          reservationAttempts.push(request)
          reservationObserved()
          return {
            status: "pending",
            run: { runId: "run-pressure", request },
          }
        },
      },
      launch: () => {},
      settled: async () => {},
    } as unknown as MemoryIdentityRuntime
    const wiring = createMemoryWiring({
      sessions: new Map([[sessionId, { context: identity }]]),
      loadConfig: () => loadedMemoryConfig(memorySettings({ compile_warn_tokens: 50 })),
      cwd: () => root,
      env: {},
      createRuntime: () => runtime,
      logger: {
        debug: () => {},
        info: () => {},
        warn: (message: string, data?: Record<string, unknown>) => { shutdownWarnings.push({ message, step: data?.step }) },
        error: () => {},
      },
    })
    const pi = new MemoryFakeExtensionAPI()
    wiring.registerStatic(pi, componentContext())
    const eventCtx = {
      sessionManager: { getSessionId: () => sessionId, getEntries: () => [] },
      ui: { setStatus: () => {}, notify: () => { advisoryObserved() } },
    }
    let advisoryTimeout: ReturnType<typeof setTimeout> | undefined
    const boundedAdvisory = Promise.race([
      advisory,
      new Promise<never>((_resolve, reject) => {
        advisoryTimeout = setTimeout(() => reject(new Error("pressure advisory was not observed")), 5_000)
      }),
    ])

    try {
      try {
        await wiring.afterBind(pi, sessionId, identity, eventCtx)
        await boundedAdvisory
      } finally {
        if (advisoryTimeout !== undefined) clearTimeout(advisoryTimeout)
      }
      expect(reservationAttempts).toEqual([])

      let reservationTimeout: ReturnType<typeof setTimeout> | undefined
      const boundedReservation = Promise.race([
        reservation,
        new Promise<never>((_resolve, reject) => {
          reservationTimeout = setTimeout(() => reject(new Error("pressure reservation was not observed after accepted input")), 5_000)
        }),
      ])
      try {
        await pi.dispatch("input", { source: "rpc", inputId: "pressure-input", text: "Continue." }, eventCtx)
        await pi.dispatch("input_disposition", { inputId: "pressure-input", disposition: "started" }, eventCtx)
        await pi.dispatch("agent_settled", {}, eventCtx)
        await boundedReservation
      } finally {
        if (reservationTimeout !== undefined) clearTimeout(reservationTimeout)
      }

      expect(reservationAttempts).toEqual([{
        trigger: "dream",
        origin: "pressure",
        conversationIds: [],
        snapshots: [],
      }])
    } finally {
      // Release everything the session opened inside the temp root before afterEach removes it (#10154).
      await wiring.onSessionShutdown({ reason: "reload", sessionId, deadlineAt: Date.now() + 10_000 })
    }
    // Nothing was left running detached past the budget, so no handle outlives the shutdown.
    expect(shutdownWarnings.filter((warning) => warning.message === "memory shutdown drain hit its budget")).toEqual([])
    expect(shutdownWarnings.filter((warning) => warning.message === "memory shutdown drain step failed")).toEqual([])
  }, 30_000)
})
