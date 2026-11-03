import { expect, onTestFinished, test } from "bun:test"
import type { CreateAgentSessionRuntimeFactory } from "@code-yeongyu/senpi"
import { GitMemoryRepo, buildDefaultSeedFiles } from "@oh-my-opencode/memory-core"
import { join } from "node:path"
import { ModelRegistry, ModelRuntime, createAgentSession, createAgentSessionRuntime, DefaultResourceLoader, SessionManager, SettingsManager } from "../../senpi-test-runtime"
import { composeOmoSenpiExtension } from "../../extension/compose"
import { createMemoryBinding } from "./binding"
import { createMemoryIdentityContext } from "./context"
import { FactsExtractorRunner } from "./facts-runner"
import { enqueue, fixture } from "./facts-runner.test-support"
import { componentContext, memorySettings } from "./memory.test-support"
import { createMemoryWiring } from "./wiring"
import type { MemorySessionStateLike } from "./wiring-types"
import { FACTS_RECORD_TOOL_NAME } from "./facts-record-tool"
import { sessionIdFrom } from "./wiring-context"

async function engineFixture() {
  const { root, identity, queue, cleanup } = await fixture(undefined, { registerCleanup: false })
  const repo = new GitMemoryRepo({ dir: identity.paths.repo, agentId: identity.id })
  await repo.init({ seedFiles: buildDefaultSeedFiles() })
  const headBefore = await repo.head()
  const requests: Array<{ readonly model: string; readonly extraction: boolean }> = []
  let extractionCalls = 0
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const body: unknown = await request.json()
      if (typeof body !== "object" || body === null || !("model" in body) || typeof body.model !== "string") {
        return new Response("invalid request", { status: 400 })
      }
      const extraction = "tools" in body && JSON.stringify(body.tools).includes(FACTS_RECORD_TOOL_NAME)
      requests.push({ model: body.model, extraction })
      if (extraction) extractionCalls += 1
      const recordsFact = extraction && extractionCalls === 1
      const delta = recordsFact
        ? { role: "assistant", tool_calls: [{ index: 0, id: "record-fact", type: "function", function: {
          name: FACTS_RECORD_TOOL_NAME,
          arguments: JSON.stringify({ scope: "project", text: "The project uses Bun.", date: "2026-10-11" }),
        } }] }
        : { role: "assistant", content: "Done." }
      const base = { id: "completion-1", object: "chat.completion.chunk", created: 1, model: body.model }
      return new Response([
        `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta, finish_reason: null }] })}`,
        `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: recordsFact ? "tool_calls" : "stop" }] })}`,
        "data: [DONE]",
      ].join("\n\n") + "\n\n", { headers: { "content-type": "text/event-stream" } })
    },
  })
  const activeClosers = new Set<() => Promise<void>>()
  onTestFinished(async () => {
    for (const close of [...activeClosers]) await close()
    server.stop(true)
    await cleanup()
  })
  const modelRuntime = ModelRuntime.createSync({ modelsPath: null })
  const registry = new ModelRegistry(modelRuntime)
  registry.registerProvider("openai", {
    api: "openai-completions", baseUrl: `${server.url}v1`, apiKey: "fixture-key",
    models: ["user-chosen", "gpt-6-luna-fast"].map((id) => ({
      id, name: id, reasoning: false, input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 100_000, maxTokens: 4096,
    })),
  })
  const memory = memorySettings({
    reflection: { ...memorySettings().reflection, enabled: false },
    dream: { ...memorySettings().dream, enabled: false },
    recall: { ...memorySettings().recall, enabled: false },
  })
  const context = createMemoryIdentityContext({
    identity: identity.id, identityPaths: identity.paths,
    binding: createMemoryBinding({ identity: identity.id, repoPath: identity.paths.repo, boundAt: 1 }),
  })
  const start = async (sessionContext: Readonly<Record<string, string>> = {}, modelId = "user-chosen") => {
    const operations: Promise<unknown>[] = []
    const agentDir = join(root, "agent")
    const createRuntime: CreateAgentSessionRuntimeFactory = async (runtimeOptions) => {
      const sessions = new Map<string, MemorySessionStateLike>()
      const wiring = createMemoryWiring({
        sessions, cwd: () => root,
        env: { HOME: root, OMO_CODING_AGENT_DIR: agentDir },
        loadConfig: () => ({ config: { memory }, layers: [], sources: [], diagnostics: [] }),
        createFactsExtractor: (options) => {
          const runner = new FactsExtractorRunner({ ...options, deadlineMs: 10_000 })
          const track = (operation: Promise<unknown>) => { operations.push(operation); return operation }
          return {
            launchPending: (signal, selection) => track(runner.launchPending(signal, selection)),
            reconcilePending: (signal) => track(runner.reconcilePending(signal)),
            cancelActive: () => runner.cancelActive(),
          }
        },
      })
      const settingsManager = SettingsManager.inMemory({ defaultProjectTrust: "always" })
      const loader = new DefaultResourceLoader({
        cwd: root, agentDir, settingsManager,
        sessionContext: runtimeOptions.launchProfile?.sessionContext,
        noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
        extensionFactories: [composeOmoSenpiExtension([{
          name: "memory",
          register(pi, component) {
            wiring.registerStatic(pi, component)
            pi.on("session_start", async (_event, ctx) => {
              const id = sessionIdFrom(ctx)
              if (id === undefined) throw new Error("engine session_start has no session ID")
              sessions.set(id, { context })
              await wiring.afterBind(pi, id, context, ctx)
            })
            pi.on("session_shutdown", async (_event, ctx) => {
              const id = sessionIdFrom(ctx)
              if (id === undefined) throw new Error("engine session_shutdown has no session ID")
              await wiring.onSessionShutdown({ reason: "reload", sessionId: id, deadlineAt: Date.now() + 10_000 })
            })
          },
        }], { logger: componentContext().logger })],
      })
      await loader.reload()
      const created = await createAgentSession({
        cwd: root, agentDir, modelRegistry: registry,
        model: registry.find("openai", modelId), thinkingLevel: "off",
        resourceLoader: loader, settingsManager, sessionManager: runtimeOptions.sessionManager,
        sessionStartEvent: runtimeOptions.sessionStartEvent, autoTitleSessions: false, tools: [],
      })
      await created.session.bindExtensions({ mode: "print" })
      return {
        ...created, diagnostics: [],
        services: {
          cwd: root, agentDir, authStorage: registry.authStorage, modelRegistry: registry,
          modelRuntime, settingsManager, resourceLoader: loader, diagnostics: [],
        },
      }
    }
    const runtime = await createAgentSessionRuntime(createRuntime, {
      cwd: root, agentDir, sessionManager: SessionManager.create(root, join(root, "sessions")),
      launchProfile: { cwd: root, sessionContext },
    })
    const drain = async () => { await Promise.all(operations.splice(0)) }
    let closed = false
    const close = async () => {
      if (closed) return
      closed = true
      try {
        await runtime.dispose()
        await drain()
      } finally {
        activeClosers.delete(close)
      }
    }
    activeClosers.add(close)
    await drain()
    return { runtime, get session() { return runtime.session }, drain, close }
  }
  return {
    start, requests, queue, repo, headBefore, debounceSettles: memory.facts.debounce_settles,
    seedPending: () => enqueue(queue, identity, "session-2", "m2", "The project uses TypeScript."),
  }
}

test("#given pending facts #when the real engine launches and relaunches without a prompt #then no HTTP model request occurs", async () => {
  const f = await engineFixture()
  const first = await f.start()
  await first.close()
  await f.start()
  expect(f.requests).toEqual([])
  expect(await f.queue.listPending()).toHaveLength(1)
}, 30_000)

test("#given inherited facts with the default four-turn debounce #when the first real prompt settles #then extraction commits on the chosen model", async () => {
  const f = await engineFixture()
  expect(f.debounceSettles).toBe(4)
  const run = await f.start()
  await run.session.prompt("The project uses Bun.", { source: "rpc" })
  await run.session.waitForIdle()
  await run.drain()
  expect(f.requests.filter((request) => request.extraction).length).toBeGreaterThan(0)
  expect(new Set(f.requests.map((request) => request.model))).toEqual(new Set(["user-chosen"]))
  expect(await f.queue.listPending()).toHaveLength(0)
  expect(await f.repo.head()).not.toBe(f.headBefore)
}, 30_000)

test("#given a persisted session and pending facts #when the real runtime resumes it without another prompt #then no facts request occurs", async () => {
  const f = await engineFixture()
  const run = await f.start()
  await run.session.prompt("The project uses Bun.", { source: "rpc" })
  await run.session.waitForIdle()
  await run.drain()
  const sessionId = run.session.sessionId
  const sessionFile = run.session.sessionManager.getSessionFile()
  if (sessionFile === undefined) throw new Error("the seeded session must be persisted")
  expect((await run.runtime.newSession()).cancelled).toBe(false)
  await f.seedPending()
  f.requests.splice(0)

  expect((await run.runtime.switchSession(sessionFile)).cancelled).toBe(false)
  await run.drain()

  expect(run.session.sessionId).toBe(sessionId)
  expect(run.session.sessionManager.getSessionFile()).toBe(sessionFile)
  expect(f.requests).toEqual([])
  expect((await f.queue.listPending()).length).toBeGreaterThan(0)
}, 30_000)

test("#given an accepted parent prompt and pending facts #when the real runtime forks its persisted branch #then no facts request occurs before fork input", async () => {
  const f = await engineFixture()
  const run = await f.start()
  await run.session.prompt("The project uses Bun.", { source: "rpc" })
  await run.session.waitForIdle()
  await run.drain()
  const parentId = run.session.sessionId
  const parentFile = run.session.sessionManager.getSessionFile()
  const entry = run.session.sessionManager.getEntries().find((entry) => entry.type === "message" && entry.message.role === "assistant")
  if (entry === undefined || parentFile === undefined) throw new Error("the parent must have a persisted assistant entry")
  await f.seedPending()
  f.requests.splice(0)

  expect((await run.runtime.fork(entry.id, { position: "at" })).cancelled).toBe(false)
  await run.drain()

  expect(run.session.sessionId).not.toBe(parentId)
  expect(run.session.sessionManager.getHeader()?.parentSession).toBe(parentFile)
  expect(f.requests).toEqual([])
  expect((await f.queue.listPending()).length).toBeGreaterThan(0)
}, 30_000)

test("#given an RPC task child with reloaded memory and a task model #when four accepted task prompts settle #then no facts extraction runs", async () => {
  const f = await engineFixture()
  const run = await f.start({ role: "child" }, "gpt-6-luna-fast")

  for (let turn = 0; turn < 4; turn += 1) {
    await run.session.prompt("Perform the assigned task.", { source: "rpc" })
    await run.session.waitForIdle()
    await run.drain()
  }

  expect(f.requests.length).toBeGreaterThan(0)
  expect(f.requests.filter((request) => request.extraction)).toEqual([])
  expect(new Set(f.requests.map((request) => request.model))).toEqual(new Set(["gpt-6-luna-fast"]))
  expect((await f.queue.listPending()).length).toBeGreaterThan(0)
  expect(await f.repo.head()).toBe(f.headBefore)
}, 30_000)
