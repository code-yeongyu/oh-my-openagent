import { expect, test } from "bun:test"
import type { AgentSession, CreateAgentSessionOptions } from "@code-yeongyu/senpi"
import { FactsFailureStore, FactsQueue, GitMemoryRepo, factsQueuePaths } from "@oh-my-opencode/memory-core"
import type { ChildSessionEvent, ChildSessionListener, CreateChildSession } from "@oh-my-opencode/senpi-task"
import { readFile } from "node:fs/promises"
import { join } from "node:path"

import { FactsExtractorRunner } from "./facts-runner"
import type { FactsRecordTool } from "./facts-record-tool"
import { enqueue, fixture, onlyRunDir, registrySnapshot, runLedgers, runnerOptions } from "./facts-runner.test-support"

const SOURCE = `Old preference: tabs.\n${"context é🌍\\\"\n".repeat(12_000)}\nCorrection: spaces supersedes tabs.`
type Mode = "success" | "compaction_start" | "resume_context_reduced" | "length" | "bytes" | "hang" | "create-failed"

function childFactory(mode: Mode, captured: CreateAgentSessionOptions[], prompts: string[], started: () => void = () => undefined): CreateChildSession {
  return async (options) => {
    captured.push(options)
    if (mode === "create-failed") throw new Error("construction crash")
    const listeners = new Set<ChildSessionListener>()
    const emit = (event: ChildSessionEvent) => { for (const listener of listeners) listener(event) }
    const tool = options.customTools?.find((tool) => tool.name === "record_fact") as FactsRecordTool | undefined
    if (tool === undefined) throw new Error("missing facts tool")
    let release: (() => void) | undefined
    const streamFunction: AgentSession["agent"]["streamFunction"] = () => { throw new Error("fixture does not call a provider") }
    return {
      agent: { streamFunction }, abortCompaction: () => undefined, setAutoCompactionEnabled: () => undefined,
      sessionId: `oversized-${captured.length}`,
      prompt: async (prompt) => {
        prompts.push(prompt)
        if (mode === "hang") return new Promise<void>((resolve) => { release = resolve; started() })
        if (mode === "compaction_start" || mode === "resume_context_reduced") emit({ type: mode })
        if (mode === "length") emit({ type: "message_end", message: { role: "assistant", stopReason: "length", content: [] } })
        const result = await tool.execute("fact", { scope: "project", text: mode === "bytes" ? "x".repeat(131_072) : "spaces supersedes tabs", date: "2026-08-10" })
        if (mode !== "success") expect(result.isError).toBe(true)
        emit({ type: "message_end", message: { role: "assistant", content: [], stopReason: "stop" } })
      },
      steer: async () => undefined, followUp: async () => undefined,
      abort: async () => { release?.() },
      subscribe: (listener: ChildSessionListener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
      getLastAssistantText: () => undefined, dispose: () => undefined,
    }
  }
}

async function setup(mode: Mode = "success", started?: () => void) {
  const f = await fixture()
  await f.queue.markConsumed(await f.queue.listPending())
  await enqueue(f.queue, f.identity, "large", "last", SOURCE)
  const captured: CreateAgentSessionOptions[] = []
  const prompts: string[] = []
  const registry = registrySnapshot([{ id: "mock-1", contextWindow: 1_048_576, maxTokens: 8192 }, { id: "mock-2", contextWindow: 16384, maxTokens: 1024 }])
  const options = runnerOptions(f.root, f.identity, f.queue, "empty", {
    env: { HOME: f.root }, createRunner: undefined, createSession: childFactory(mode, captured, prompts, started),
    resolveModelRegistry: () => registry,
    loadConfig: () => ({ config: { categories: { quick: { models: [{ model: "omo-mock/mock-1" }, { model: "omo-mock/mock-2" }] } } }, diagnostics: [], layers: [], sources: [] }),
  })
  return { ...f, options, captured, prompts }
}

test("#given ordinary work and two eligible oversized entries #when draining #then ordinary batching stays intact and each complete oversized input commits once", async () => {
  const f = await setup()
  await enqueue(f.queue, f.identity, "large-two", "last-two", SOURCE)
  await enqueue(f.queue, f.identity, "small", "small-last", "small source")
  expect((await new FactsExtractorRunner(f.options).launchPending()).status).toBe("committed")
  const ledgers = await runLedgers(f.identity)
  expect(ledgers.map((ledger) => ledger.queued.length)).toEqual([1, 1, 1])
  expect(ledgers[0]?.queued[0]?.conversationId).toBe("small")
  expect(f.prompts).toHaveLength(3)
  for (const prompt of f.prompts.slice(1)) {
    const payload = JSON.parse(prompt.slice(prompt.indexOf("\n\n") + 2))
    expect(payload.entries[0].entries[0].text).toBe(SOURCE)
  }
  for (const options of f.captured.slice(1)) {
    expect(options.settingsManager?.getRetryFallbackSettings().modelFallback).toBe(false)
    expect(options.settingsManager?.getRetrySettings().maxRetries).toBe(0)
    expect(options.model?.id).toBe("mock-1")
  }
  expect(await f.queue.listPending()).toHaveLength(0)
  expect((await new FactsFailureStore({ identityPaths: f.identity.paths }).readFailures()).entries).toHaveLength(0)
}, 30_000)

test("#given a first-prompt guard failure or constructor crash #when the child settles #then original queue and watermarks survive with no smaller fallback", async () => {
  for (const mode of ["compaction_start", "resume_context_reduced", "length", "bytes", "create-failed"] as const) {
    const f = await setup(mode)
    const pending = await f.queue.listPending()
    const consumed = await readFile(factsQueuePaths(f.identity.paths).consumedPath, "utf8")
    expect((await new FactsExtractorRunner(f.options).launchPending()).status).toBe("failed")
    expect(await f.queue.listPending()).toEqual(pending)
    expect(await readFile(factsQueuePaths(f.identity.paths).consumedPath, "utf8")).toBe(consumed)
    expect(f.captured).toHaveLength(1)
    const repo = new GitMemoryRepo({ dir: f.identity.paths.repo, agentId: f.identity.id })
    expect((await repo.log()).filter((commit) => commit.trailers["Omo-Facts-Batch"] !== undefined)).toHaveLength(0)
  }
}, 30_000)

test("#given a bounded child cancelled during extraction #when cancellation settles #then no outcome or consume is published", async () => {
  let notify: (() => void) | undefined
  const started = new Promise<void>((resolve) => { notify = resolve })
  const f = await setup("hang", () => notify?.())
  const pending = await f.queue.listPending()
  const runner = new FactsExtractorRunner(f.options)
  const launch = runner.launchPending()
  await started
  await runner.cancelActive()
  await launch
  expect(await f.queue.listPending()).toEqual(pending)
  expect(await readFile(join(await onlyRunDir(f.identity), "outcome.json"), "utf8").catch(() => undefined)).toBeUndefined()
}, 30_000)

test("#given a bounded child exceeds the existing deadline #when aborted #then it fails without consuming input", async () => {
  const f = await setup("hang")
  expect((await new FactsExtractorRunner({ ...f.options, deadlineMs: 40 }).launchPending()).status).toBe("failed")
  expect(await f.queue.listPending()).toHaveLength(1)
  const outcome = JSON.parse(await readFile(join(await onlyRunDir(f.identity), "outcome.json"), "utf8"))
  expect(outcome.timedOut).toBe(true)
}, 30_000)

test("#given oversized apply commits before queue cleanup crashes #when reconciling #then its receipt recovers exactly once", async () => {
  const f = await setup()
  class CrashQueue extends FactsQueue {
    override async markConsumed(): Promise<void> { throw new Error("cleanup crash after apply") }
  }
  const crashing = new CrashQueue({ identityPaths: f.identity.paths })
  await expect(new FactsExtractorRunner({ ...f.options, queue: crashing }).launchPending()).rejects.toThrow("cleanup crash after apply")
  expect(await f.queue.listPending()).toHaveLength(1)
  expect((await new FactsExtractorRunner(f.options).reconcilePending()).status).toBe("empty")
  expect(await f.queue.listPending()).toHaveLength(0)
  const repo = new GitMemoryRepo({ dir: f.identity.paths.repo, agentId: f.identity.id })
  expect((await repo.log()).filter((commit) => commit.trailers["Omo-Facts-Batch"] !== undefined)).toHaveLength(1)
  expect(f.captured).toHaveLength(1)
}, 30_000)
