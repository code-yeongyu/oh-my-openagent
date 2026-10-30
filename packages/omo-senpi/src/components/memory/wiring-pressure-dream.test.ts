import { afterEach, describe, expect, test } from "bun:test"
import { realpathSync } from "node:fs"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { buildIdentityPaths, GitMemoryRepo } from "@oh-my-opencode/memory-core"
import type { MemoryIdentityRuntime } from "./identity-runtime"
import { createMemoryIdentityContext } from "./context"
import { MemoryFakeExtensionAPI, componentContext, loadedMemoryConfig, memorySettings } from "./memory.test-support"
import { rmWhenReleased } from "./teardown.test-support"
import { createMemoryWiring } from "./wiring"

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rmWhenReleased(root)
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
    } as unknown as MemoryIdentityRuntime
    const wiring = createMemoryWiring({
      sessions: new Map([[sessionId, { context: identity }]]),
      loadConfig: () => loadedMemoryConfig(memorySettings({ compile_warn_tokens: 50 })),
      cwd: () => root,
      env: {},
      createRuntime: () => runtime,
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
  }, 30_000)
})
