import { afterEach, expect, jest, spyOn, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { buildIdentityPaths, TranscriptJournal } from "@oh-my-opencode/memory-core"

import { composeOmoSenpiExtension } from "../../extension/compose"
import { createMemoryIdentityContext } from "./context"
import type { MemoryIdentityRuntime } from "./identity-runtime"
import {
  createMemoryRpcBridge,
  MEMORY_UPDATED_RPC_EVENT,
  type MemoryRpcBridge,
  type MemoryRpcSnapshot,
} from "./memory-rpc-bridge"
import { registerJournalSettleDelivery } from "./journal-settle-delivery"
import * as journalState from "./memory-rpc-journal-state"
import * as snapshotState from "./memory-rpc-snapshot-state"
import { MemoryFakeExtensionAPI, componentContext, loadedMemoryConfig, memorySettings } from "./memory.test-support"
import { createMemoryWiring, type MemoryWiring } from "./wiring"
import { remainingTestTime } from "../../../../../test-support/test-deadline"

afterEach(() => jest.useRealTimers())

test.each(["initial", "cached", "aborted"] as const)(
  "#given an %s full sync held in flight #when agent_settled dispatches #then journal delivery releases the host before the full result",
  async (mode) => {
    const root = await mkdtemp(join(tmpdir(), "memory-rpc-full-held-"))
    const sessionId = "held-full-session"
    const identity = createMemoryIdentityContext({
      identity: "ordered-agent",
      identityPaths: buildIdentityPaths(root, "ordered-agent"),
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
    pi.rpc = {
      emit(name, data) {
        if (name === MEMORY_UPDATED_RPC_EVENT) {
          sequence.push("memory")
          snapshots.push(data)
        }
      },
    }
    let hold = false
    let reads = 0
    let bridge: MemoryRpcBridge | undefined
    await composeOmoSenpiExtension(
      [
        {
          name: "memory",
          register(api) {
            bridge = createMemoryRpcBridge(api, {
              resolveContext: () => identity,
              activeRun: () => undefined,
              createGitRepo: () => ({
                head: () => {
                  reads++
                  if (hold) entered.resolve()
                  return hold ? release.promise : Promise.resolve("initial")
                },
                headCommitTimestamp: async () => null,
                headSubject: async () => null,
                status: async () => "",
                lsTree: async () => [],
                show: async () => "",
              }),
            })
            bridge.attach(sessionId)
            registerJournalSettleDelivery(api, {
              resolveContext: () => identity,
              lastEventCtx: {},
              activeSession: {},
              deliver: (_id, observed) => bridge?.syncJournal(observed),
            })
          },
        },
      ],
      { logger: componentContext().logger },
    )(pi)
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
      entries.push({
        type: "message",
        id: "answer-1",
        message: { role: "assistant", content: [{ type: "text", text: "Done." }] },
      })
      settling = pi.dispatch("agent_settled", {}, eventCtx).then(() => {
        sequence.push("agent_settled", "agent_idle")
      })
      // Failure deadline only: passing requires the exact settle event while the git latch stays held.
      timer = setTimeout(
        () => deadline.reject(new Error("settle delivery waited for the held full build")),
        remainingTestTime(),
      )
      await Promise.race([settling, deadline.promise])
      expect(sequence).toEqual(["memory", "agent_settled", "agent_idle"])
      expect(reads).toBe(readsBefore)
      expect(snapshots[0]).toMatchObject({ journal: { totalSteps: 1 }, reflection: { backlogSteps: 1 } })
      release.resolve("late-full")
      await full
      expect(sequence).toEqual(
        mode === "aborted"
          ? ["memory", "agent_settled", "agent_idle"]
          : ["memory", "agent_settled", "agent_idle", "memory"],
      )
      if (mode !== "aborted") {
        expect(snapshots[1]).toMatchObject({
          repo: { headSha: "late-full" },
          journal: { totalSteps: 1 },
          reflection: { backlogSteps: 1 },
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
  },
)

test.each(["reflection", "journal"] as const)(
  "#given %s work outlives the observer #when a turn settles #then journal status precedes host settled and idle without waiting for that work",
  async (held) => {
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
    const journalSpy =
      held === "journal"
        ? spyOn(TranscriptJournal.prototype, "reconcile").mockImplementation(async () => {
            entered.resolve()
            await release.promise
            finished.resolve()
            return { appended: 0, skipped: 0 }
          })
        : undefined
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
    await composeOmoSenpiExtension(
      [
        {
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
        },
      ],
      { logger: context.logger },
    )(pi)
    let settling: Promise<unknown> | undefined
    try {
      await wiring?.afterBind(pi, sessionId, identity, eventCtx)
      expect(sequence).toEqual([0])
      await pi.dispatch("input", { source: "rpc", inputId: "accepted", text: "Work." }, eventCtx)
      await pi.dispatch("input_disposition", { inputId: "accepted", disposition: "started" }, eventCtx)
      entries.push({
        type: "message",
        id: "answer-1",
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
      expect(context.logs).toContainEqual(
        expect.objectContaining({
          message: "extension_handler_stalled",
          details: expect.objectContaining({
            hook: held === "reflection" ? "onSettled.reflection.reconcile" : "onSettled.journal.reconcileSession",
            stage: "timeout",
          }),
        }),
      )
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
  },
)

// omo.memory.updated is level-triggered (#12276): the bind-time full build races the first settle, so the publish
// count and the intermediate journal-only snapshot vary by order. The latest snapshot and monotone totals do not.
const LATCH_TIMEOUT_MS = 10_000

/** Awaits one fixture latch, failing with its name instead of hanging the test if it never resolves. */
async function latch<T>(promise: Promise<T>, name: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`waited ${LATCH_TIMEOUT_MS}ms for ${name}, it never resolved`)),
      LATCH_TIMEOUT_MS,
    )
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    clearTimeout(timer)
  }
}

async function publishBindAndOneTurn(order: "bind-first" | "settle-first"): Promise<MemoryRpcSnapshot[]> {
  const root = await mkdtemp(join(tmpdir(), "memory-rpc-level-"))
  const sessionId = "level-session"
  const identity = createMemoryIdentityContext({
    identity: "level-agent",
    identityPaths: buildIdentityPaths(root, "level-agent"),
    binding: { identity: "level-agent", repoPathHash: "fixture", boundAt: 1 },
  })
  const entries: unknown[] = []
  const eventCtx = {
    sessionManager: { getSessionId: () => sessionId, getEntries: () => entries, getBranch: () => entries },
  }
  const bindHeld = Promise.withResolvers<undefined>()
  const bindJournalRead = Promise.withResolvers<undefined>()
  const releaseBind = Promise.withResolvers<undefined>()
  const firstPublished = Promise.withResolvers<undefined>()
  const observerHeld = Promise.withResolvers<undefined>()
  const releaseObserver = Promise.withResolvers<undefined>()
  const delayedBindPublished = Promise.withResolvers<MemoryRpcSnapshot>()
  const realJournal = journalState.readMemoryRpcJournalState
  // The bind build's journal read finishes before the turn exists, so its journal fields are the stale pre-turn ones.
  const journalSpy = spyOn(journalState, "readMemoryRpcJournalState").mockImplementation(async (...args) => {
    const state = await realJournal(...args)
    bindJournalRead.resolve(undefined)
    return state
  })
  let firstHead = true
  const repoSpy = spyOn(snapshotState, "createMemoryRpcGitRepo").mockImplementation(() => ({
    head: async () => {
      if (firstHead && order === "settle-first") {
        firstHead = false
        bindHeld.resolve(undefined)
        await releaseBind.promise
      }
      return null
    },
    headCommitTimestamp: async () => null,
    headSubject: async () => null,
    status: async () => "",
    lsTree: async () => [],
    lsTreeSized: async () => [],
    show: async () => "",
  }))
  const published: MemoryRpcSnapshot[] = []
  const pi = new MemoryFakeExtensionAPI()
  pi.rpc = {
    emit(name, data) {
      if (name !== MEMORY_UPDATED_RPC_EVENT) return
      const snapshot = data as MemoryRpcSnapshot
      published.push(snapshot)
      firstPublished.resolve(undefined)
      if (snapshot.nonJournalState === undefined) delayedBindPublished.resolve(snapshot)
    },
  }
  const runtime = {
    async reconcile() {
      if (order === "settle-first") {
        observerHeld.resolve(undefined)
        await releaseObserver.promise
      }
    },
  } as unknown as MemoryIdentityRuntime
  const context = componentContext()
  let wiring: MemoryWiring | undefined
  let bound: Promise<void> | undefined
  let settling: Promise<unknown> | undefined
  let restoreObserverTimer: (() => void) | undefined
  try {
    await composeOmoSenpiExtension(
      [
        {
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
        },
      ],
      { logger: context.logger },
    )(pi)
    if (wiring === undefined) throw new Error("memory wiring was not registered")
    bound = wiring.afterBind(pi, sessionId, identity, eventCtx)
    if (order === "settle-first")
      await latch(Promise.all([bindHeld.promise, bindJournalRead.promise]), "the held bind build")
    else await latch(bound, "the bind build")
    await pi.dispatch("input", { source: "rpc", inputId: "accepted", text: "Work." }, eventCtx)
    await pi.dispatch("input_disposition", { inputId: "accepted", disposition: "started" }, eventCtx)
    entries.push({
      type: "message",
      id: "answer-1",
      message: { role: "assistant", content: [{ type: "text", text: "Done." }] },
    })
    // Neutralize the settle observer's 2 s budget, not the real failure deadlines for fixture latches.
    const realSetTimeout = globalThis.setTimeout
    const timerSpy = spyOn(globalThis, "setTimeout").mockImplementation(
      new Proxy(realSetTimeout, {
        apply(target, receiver, [callback, delay, ...args]) {
          return Reflect.apply(target, receiver, [delay === 2_000 ? () => {} : callback, delay, ...args])
        },
      }),
    )
    restoreObserverTimer = () => timerSpy.mockRestore()
    settling = pi.dispatch("agent_settled", {}, eventCtx)
    if (order === "settle-first") {
      await latch(Promise.all([firstPublished.promise, observerHeld.promise]), "journal delivery and the held observer")
      releaseBind.resolve(undefined)
      // The observer cannot start its own full build until its reconciliation is released.
      const delayedBind = await latch(delayedBindPublished.promise, "the delayed bind full snapshot to publish")
      expect(delayedBind, "the delayed bind publish retains the newer journal overlay").toMatchObject({
        journal: { totalSteps: 1 },
        reflection: { backlogSteps: 1 },
      })
      releaseObserver.resolve(undefined)
    }
    await latch(Promise.all([bound, settling]), "the bind build and the settle")
    expect(context.logs).not.toContainEqual(expect.objectContaining({ message: "extension_handler_stalled" }))
    return published
  } finally {
    journalSpy.mockRestore()
    repoSpy.mockRestore()
    restoreObserverTimer?.()
    releaseBind.resolve(undefined)
    releaseObserver.resolve(undefined)
    try {
      await latch(Promise.allSettled([bound, settling]), "bind and settle teardown")
    } finally {
      try {
        await latch(
          wiring?.onSessionShutdown({ reason: "reload", sessionId, deadlineAt: Date.now() + 5_000 }) ??
            Promise.resolve(),
          "memory session shutdown",
        )
      } finally {
        await latch(rm(root, { recursive: true, force: true }), "fixture directory removal")
      }
    }
  }
}

test("#given the bind build finishing before or after the first settle #when one turn completes #then omo.memory.updated ends at the same snapshot and its journal step total never decreases", async () => {
  const bindFirst = await publishBindAndOneTurn("bind-first")
  const settleFirst = await publishBindAndOneTurn("settle-first")

  // Both interleavings really ran: only the held bind lets the journal-only delivery publish first.
  expect(bindFirst[0]).toMatchObject({ journal: { totalSteps: 0 } })
  expect(bindFirst[0]?.nonJournalState).toBeUndefined()
  expect(settleFirst[0]).toMatchObject({ nonJournalState: "unknown", journal: { totalSteps: 1 } })
  expect(settleFirst.at(-1)).toEqual(bindFirst.at(-1))
  expect(bindFirst.at(-1)).toMatchObject({ journal: { totalSteps: 1 }, reflection: { backlogSteps: 1 } })
  expect(bindFirst.at(-1)?.nonJournalState).toBeUndefined()
  for (const published of [bindFirst, settleFirst]) {
    for (const [index, snapshot] of published.entries()) {
      if (index === 0) continue
      const previous = published[index - 1] as MemoryRpcSnapshot
      expect(snapshot.journal.totalSteps).toBeGreaterThanOrEqual(previous.journal.totalSteps)
    }
  }
})
