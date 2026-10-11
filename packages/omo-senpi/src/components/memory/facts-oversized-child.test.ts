import { expect, test } from "bun:test"
import type { AgentSession } from "@code-yeongyu/senpi"
import { normalizeContext } from "@earendil-works/pi-ai"
import type { ChildSessionListener, QueuedInputDisposition } from "@oh-my-opencode/senpi-task"

import { createOversizedFactsGuard } from "./facts-oversized-child"
import { FACTS_REQUEST_LIMIT } from "./facts-oversized-budget"
import { registrySnapshot } from "./facts-runner.test-support"

type Stream = AgentSession["agent"]["streamFunction"]

async function fixture() {
  const listeners = new Set<ChildSessionListener>()
  const model = registrySnapshot([{ id: "mock-1", contextWindow: 1_048_576, maxTokens: 8192 }]).find("omo-mock", "mock-1")!
  const forwarded = new Error("provider forwarding probe")
  const calls: Parameters<Stream>[] = []
  const streamFunction: Stream = (...args) => { calls.push(args); throw forwarded }
  const failures: string[] = []
  let aborts = 0
  let compactionAborts = 0
  let disposed = false
  const child = {
    agent: { streamFunction }, sessionId: "guard-fixture",
    prompt: async () => undefined,
    steer: async (): Promise<QueuedInputDisposition> => "handled",
    followUp: async (): Promise<QueuedInputDisposition> => "handled",
    abort: async () => { aborts += 1 }, abortCompaction: () => { compactionAborts += 1 },
    setAutoCompactionEnabled: (enabled: boolean) => { expect(enabled).toBe(false) },
    subscribe: (listener: ChildSessionListener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    getLastAssistantText: () => undefined, dispose: () => { disposed = true },
  }
  const guard = createOversizedFactsGuard({ model, createSession: async () => child, onFailure: (reason) => failures.push(reason) })
  await guard.createSession({})
  return { child, model, guard, calls, failures, forwarded, listeners, counts: () => ({ aborts, compactionAborts, disposed }) }
}

test("#given a pinned child #when eight requests forward #then output and transport retries are bounded and the ninth cannot forward", async () => {
  const f = await fixture()
  for (let index = 0; index < FACTS_REQUEST_LIMIT; index += 1) {
    expect(() => f.child.agent.streamFunction(f.model, normalizeContext({ messages: [] }), { maxTokens: 99999, maxRetries: 5 })).toThrow(f.forwarded)
  }
  expect(f.calls).toHaveLength(FACTS_REQUEST_LIMIT)
  expect(f.calls.every((call) => call[2]?.maxTokens === 4096 && call[2]?.maxRetries === 0)).toBe(true)
  expect(() => f.child.agent.streamFunction(f.model, normalizeContext({ messages: [] }))).toThrow("budget")
  expect(f.calls).toHaveLength(FACTS_REQUEST_LIMIT)
  expect(f.guard.succeeded()).toBe(false)
  expect(f.counts().aborts).toBe(1)
})

test("#given a changed model or oversized complete context #when the stream starts #then no provider call happens", async () => {
  for (const failure of ["model", "context", "capacity", "output", "unknown"] as const) {
    const f = await fixture()
    const model = { ...f.model,
      ...(failure === "model" ? { id: "smaller-fallback" } : {}),
      ...(failure === "capacity" ? { contextWindow: 16384 } : {}),
      ...(failure === "output" ? { maxTokens: 512 } : {}),
      ...(failure === "unknown" ? { contextWindow: NaN } : {}),
    }
    expect(() => f.child.agent.streamFunction(
      model,
      normalizeContext({ messages: [], systemPrompt: failure === "context" ? "x".repeat(1_048_576) : "" }),
    )).toThrow("budget")
    expect(f.calls).toHaveLength(0)
    expect(f.guard.succeeded()).toBe(false)
  }
})

test("#given construction-time listeners #when compaction, reduced context, or output truncation occurs #then success is irreversibly refused and disposal releases listeners", async () => {
  for (const event of [{ type: "compaction_start" }, { type: "resume_context_reduced" }, { type: "message_end", message: { stopReason: "length" } }]) {
    const f = await fixture()
    for (const listener of f.listeners) listener(event)
    expect(f.guard.succeeded()).toBe(false)
    expect(f.counts()).toMatchObject({ aborts: 1, compactionAborts: 1 })
    expect(() => f.child.agent.streamFunction(f.model, normalizeContext({ messages: [] }))).toThrow("budget")
    expect(f.calls).toHaveLength(0)
    expect(f.failures).toHaveLength(1)
    f.child.dispose()
    expect(f.listeners.size).toBe(0)
    expect(f.counts().disposed).toBe(true)
  }
})
