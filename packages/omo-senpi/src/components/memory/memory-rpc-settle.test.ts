import { afterEach, expect, jest, spyOn, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { buildIdentityPaths, TranscriptJournal } from "@oh-my-opencode/memory-core"

import { composeOmoSenpiExtension } from "../../extension/compose"
import { createMemoryIdentityContext } from "./context"
import type { MemoryIdentityRuntime } from "./identity-runtime"
import { MEMORY_UPDATED_RPC_EVENT, type MemoryRpcSnapshot } from "./memory-rpc-bridge"
import { MemoryFakeExtensionAPI, componentContext, loadedMemoryConfig, memorySettings } from "./memory.test-support"
import { createMemoryWiring, type MemoryWiring } from "./wiring"

afterEach(() => jest.useRealTimers())

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
