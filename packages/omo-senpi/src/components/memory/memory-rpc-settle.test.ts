import { afterEach, expect, jest, spyOn, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { buildIdentityPaths, TranscriptJournal } from "@oh-my-opencode/memory-core"

import { composeOmoSenpiExtension } from "../../extension/compose"
import { createMemoryIdentityContext } from "./context"
import type { MemoryIdentityRuntime } from "./identity-runtime"
import { createMemoryRpcBridge, MEMORY_UPDATED_RPC_EVENT, type MemoryRpcBridge, type MemoryRpcSnapshot } from "./memory-rpc-bridge"
import { registerJournalSettleDelivery } from "./journal-settle-delivery"
import * as journalState from "./memory-rpc-journal-state"
import { MemoryFakeExtensionAPI, componentContext, loadedMemoryConfig, memorySettings } from "./memory.test-support"
import { createMemoryWiring, type MemoryWiring } from "./wiring"

afterEach(() => jest.useRealTimers())

test.each(["initial", "cached", "aborted"] as const)("#given an %s full sync held in flight #when agent_settled dispatches #then journal delivery releases the host before the full result", async (mode) => {
  const root = await mkdtemp(join(tmpdir(), "memory-rpc-full-held-"))
  const sessionId = "held-full-session"
  const identity = createMemoryIdentityContext({
    identity: "ordered-agent", identityPaths: buildIdentityPaths(root, "ordered-agent"),
    binding: { identity: "ordered-agent", repoPathHash: "fixture", boundAt: 1 },
  })
  const entries: unknown[] = []
  const eventCtx = { sessionManager: { getSessionId: () => sessionId, getBranch: () => entries } }
  const entered = Promise.withResolvers<void>()
  const journalRead = Promise.withResolvers<void>()
  const release = Promise.withResolvers<string>()
  const deadline = Promise.withResolvers<never>()
  const sequence: string[] = []
  const snapshots: unknown[] = []
  const pi = new MemoryFakeExtensionAPI()
  pi.rpc = { emit(name, data) {
    if (name === MEMORY_UPDATED_RPC_EVENT) { sequence.push("memory"); snapshots.push(data) }
  } }
  let hold = false
  let reads = 0
  let bridge: MemoryRpcBridge | undefined
  await composeOmoSenpiExtension([{
    name: "memory",
    register(api) {
      bridge = createMemoryRpcBridge(api, {
        resolveContext: () => identity, activeRun: () => undefined,
        createGitRepo: () => ({
          head: () => { reads++; if (hold) entered.resolve(); return hold ? release.promise : Promise.resolve("initial") },
          headCommitTimestamp: async () => null, headSubject: async () => null,
          status: async () => "", lsTree: async () => [], show: async () => "",
        }),
      })
      bridge.attach(sessionId)
      registerJournalSettleDelivery(api, {
        resolveContext: () => identity, lastEventCtx: {}, activeSession: {},
        deliver: (_id, observed) => bridge?.syncJournal(observed),
      })
    },
  }], { logger: componentContext().logger })(pi)
  if (bridge === undefined) throw new Error("memory bridge was not registered")
  if (mode !== "initial") await bridge.sync()
  sequence.length = 0
  snapshots.length = 0
  const readJournal = journalState.readMemoryRpcJournalState
  const journalSpy = spyOn(journalState, "readMemoryRpcJournalState").mockImplementation(async (...args) => {
    const result = await readJournal(...args)
    journalRead.resolve()
    return result
  })
  hold = true
  const controller = new AbortController()
  const full = bridge.sync(controller.signal)
  let settling: Promise<unknown> | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    // Both full-build inputs are observed: the journal result is already stale (zero steps).
    await Promise.all([entered.promise, journalRead.promise])
    if (mode === "aborted") controller.abort()
    const readsBefore = reads
    entries.push({ type: "message", id: "answer-1", message: { role: "assistant", content: [{ type: "text", text: "Done." }] } })
    settling = pi.dispatch("agent_settled", {}, eventCtx).then(() => {
      sequence.push("agent_settled", "agent_idle")
    })
    // Failure deadline only: passing requires the exact settle event while the git latch stays held.
    timer = setTimeout(() => deadline.reject(new Error("settle delivery waited for the held full build")), 4_000)
    await Promise.race([settling, deadline.promise])
    expect(sequence).toEqual(["memory", "agent_settled", "agent_idle"])
    expect(reads).toBe(readsBefore)
    expect(snapshots[0]).toMatchObject({ journal: { totalSteps: 1 }, reflection: { backlogSteps: 1 } })
    release.resolve("late-full")
    await full
    expect(sequence).toEqual(mode === "aborted"
      ? ["memory", "agent_settled", "agent_idle"]
      : ["memory", "agent_settled", "agent_idle", "memory"])
    if (mode !== "aborted") {
      expect(snapshots[1]).toMatchObject({
        repo: { headSha: "late-full" }, journal: { totalSteps: 1 }, reflection: { backlogSteps: 1 },
      })
    }
  } finally {
    clearTimeout(timer)
    release.resolve("late-full")
    await Promise.allSettled([full, settling])
    journalSpy.mockRestore()
    bridge.dispose()
    await rm(root, { recursive: true, force: true })
  }
})

test.each(["reflection", "journal"] as const)("#given %s work outlives the observer #when a turn settles #then journal status precedes host settled and idle without waiting for that work", async (held) => {
  const root = await mkdtemp(join(tmpdir(), "memory-rpc-settle-"))
  const sessionId = "ordered-session"
  const identity = createMemoryIdentityContext({
    identity: "ordered-agent",
    identityPaths: buildIdentityPaths(root, "ordered-agent"),
    binding: { identity: "ordered-agent", repoPathHash: "fixture", boundAt: 1 },
  })
  const entries: unknown[] = []
  const eventCtx = {
    sessionManager: {
      getSessionId: () => sessionId,
      getEntries: () => entries,
      getBranch: () => entries,
    },
  }
  const entered = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const finished = Promise.withResolvers<void>()
  const journalSpy = held === "journal" ? spyOn(TranscriptJournal.prototype, "reconcile").mockImplementation(async () => {
    entered.resolve()
    await release.promise
    finished.resolve()
    return { appended: 0, skipped: 0 }
  }) : undefined
  const runtime = {
    reconcile: async () => {
      entered.resolve()
      await release.promise
      finished.resolve()
    },
  } as unknown as MemoryIdentityRuntime
  const pi = new MemoryFakeExtensionAPI()
  const sequence: Array<string | number> = []
  pi.rpc = {
    emit(name, data) {
      if (name === MEMORY_UPDATED_RPC_EVENT) sequence.push((data as MemoryRpcSnapshot).journal.totalSteps)
    },
  }
  const context = componentContext()
  let wiring: MemoryWiring | undefined
  await composeOmoSenpiExtension([{
    name: "memory",
    register(api, ctx) {
      wiring = createMemoryWiring({
        sessions: new Map([[sessionId, { context: identity }]]),
        loadConfig: () => loadedMemoryConfig(memorySettings({ facts: { enabled: false, debounce_settles: 4 } })),
        cwd: () => root,
        env: {},
        logger: ctx.logger,
        createRuntime: () => runtime,
      })
      wiring.registerStatic(api, ctx)
    },
  }], { logger: context.logger })(pi)
  let settling: Promise<unknown> | undefined
  try {
    await wiring?.afterBind(pi, sessionId, identity, eventCtx)
    expect(sequence).toEqual([0])
    await pi.dispatch("input", { source: "rpc", inputId: "accepted", text: "Work." }, eventCtx)
    await pi.dispatch("input_disposition", { inputId: "accepted", disposition: "started" }, eventCtx)
    entries.push({
      type: "message", id: "answer-1",
      message: { role: "assistant", content: [{ type: "text", text: "Done." }] },
    })
    jest.useFakeTimers()
    // Senpi awaits extension handlers before emitting these two host events.
    settling = pi.dispatch("agent_settled", {}, eventCtx).then(() => {
      sequence.push("agent_settled", "agent_idle")
    })
    await entered.promise
    // Even a held journal lock must not postpone the observation of the completed answer.
    expect(sequence).toEqual([0, 1])
    jest.advanceTimersByTime(2_000)
    await settling

    expect(sequence).toEqual([0, 1, "agent_settled", "agent_idle"])
    expect(context.logs).toContainEqual(expect.objectContaining({
      message: "extension_handler_stalled",
      details: expect.objectContaining({
        hook: held === "reflection" ? "onSettled.reflection.reconcile" : "onSettled.journal.reconcileSession",
        stage: "timeout",
      }),
    }))
    // The assertion above completed while recovery was still held by this test.
    release.resolve()
    await finished.promise
    expect(sequence).toEqual([0, 1, "agent_settled", "agent_idle"])
  } finally {
    release.resolve()
    await settling
    journalSpy?.mockRestore()
    jest.useRealTimers()
    await wiring?.onSessionShutdown({ reason: "reload", sessionId, deadlineAt: Date.now() + 5_000 })
    await rm(root, { recursive: true, force: true })
  }
})
