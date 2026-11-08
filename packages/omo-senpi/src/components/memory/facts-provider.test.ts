import { expect, onTestFinished, test } from "bun:test"
import { join } from "node:path"
import { existsSync } from "node:fs"
import { GitMemoryRepo, buildDefaultSeedFiles } from "@oh-my-opencode/memory-core"
import { ModelRegistry, ModelRuntime } from "../../senpi-test-runtime"
import { createMemoryBinding } from "./binding"
import { createMemoryIdentityContext } from "./context"
import { FactsExtractorRunner } from "./facts-runner"
import { enqueue, fixture } from "./facts-runner.test-support"
import { MemoryFakeExtensionAPI, componentContext, memorySettings } from "./memory.test-support"
import { createMemoryWiring } from "./wiring"

const CHOSEN = "user-chosen"
const BUILTIN = "gpt-6-luna-fast"

async function providerFixture(chosen: string | undefined, explicit?: string) {
  const { root, identity, queue } = await fixture()
  const repo = new GitMemoryRepo({ dir: identity.paths.repo, agentId: identity.id })
  await repo.init({ seedFiles: buildDefaultSeedFiles() })
  const requests: string[] = []
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const body: unknown = await request.json()
      if (typeof body !== "object" || body === null || !("model" in body) || typeof body.model !== "string") {
        return new Response("missing model", { status: 400 })
      }
      requests.push(body.model)
      const base = { id: "completion-1", object: "chat.completion.chunk", created: 1, model: body.model }
      return new Response([
        `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { role: "assistant", content: "No new facts." }, finish_reason: null }] })}`,
        `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })}`,
        "data: [DONE]",
      ].join("\n\n") + "\n\n", { headers: { "content-type": "text/event-stream" } })
    },
  })
  onTestFinished(() => server.stop(true))
  const registry = new ModelRegistry(ModelRuntime.createSync({ modelsPath: null }))
  registry.registerProvider("openai", {
    api: "openai-completions",
    baseUrl: `${server.url}v1`,
    apiKey: "fixture-key",
    models: [CHOSEN, BUILTIN, "explicit-extractor"].map((id) => ({
      id, name: id, reasoning: false, input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 100_000, maxTokens: 4096,
    })),
  })
  const sessionId = "session-1"
  const context = createMemoryIdentityContext({
    identity: identity.id, identityPaths: identity.paths,
    binding: createMemoryBinding({ identity: identity.id, repoPath: identity.paths.repo, boundAt: 1 }),
  })
  const memory = memorySettings({
    facts: { enabled: true, debounce_settles: 1, ...(explicit === undefined ? {} : { model: explicit }) },
    reflection: { ...memorySettings().reflection, enabled: false },
    dream: { ...memorySettings().dream, enabled: false },
    recall: { ...memorySettings().recall, enabled: false },
  })
  const component = componentContext()
  const operations: Promise<unknown>[] = []
  let extractor: FactsExtractorRunner | undefined
  const branch = [{
    id: "u1", type: "message",
    message: { role: "user", content: "The project uses Bun." },
  }]
  const eventCtx = {
    sessionManager: {
      getSessionId: () => sessionId, getEntries: () => branch, getBranch: () => branch,
      getSessionFile: () => join(root, "session.jsonl"),
    },
    modelRegistry: registry,
    ...(chosen === undefined ? {} : { model: registry.find("openai", chosen) }),
    isIdle: () => true, hasPendingMessages: () => false,
  }
  const start = async () => {
    const pi = new MemoryFakeExtensionAPI()
    const wiring = createMemoryWiring({
      sessions: new Map([[sessionId, { context }]]),
      cwd: () => root,
      env: { HOME: root, OMO_CODING_AGENT_DIR: join(root, "agent") },
      loadConfig: () => ({ config: { memory }, diagnostics: [], sources: [], layers: [] }),
      logger: component.logger,
      createFactsExtractor: (options) => {
        const runner = new FactsExtractorRunner({ ...options, deadlineMs: 10_000 })
        extractor = runner
        return {
          launchPending: (signal, selection) => {
            const operation = runner.launchPending(signal, selection)
            operations.push(operation)
            return operation
          },
          reconcilePending: (signal) => {
            const operation = runner.reconcilePending(signal)
            operations.push(operation)
            return operation
          },
          cancelActive: () => runner.cancelActive(),
        }
      },
    })
    wiring.registerStatic(pi, component)
    await wiring.afterBind(pi, sessionId, context, eventCtx)
    const drain = async () => {
      await Promise.all(operations.splice(0))
      await wiring.whenIdle()
    }
    const close = async () => {
      await drain()
      await wiring.onSessionShutdown({ reason: "reload", sessionId, deadlineAt: Date.now() + 10_000 })
    }
    onTestFinished(close)
    return { pi, drain, close, rebind: () => wiring.afterBind(pi, sessionId, context, eventCtx) }
  }
  return {
    start, requests, queue, eventCtx, registry, identity, logs: component.logs,
    extractPending: () => {
      if (extractor === undefined) throw new Error("the fixture must bind before extraction")
      return extractor.launchPending()
    },
    seedPending: () => enqueue(queue, identity, "session-2", "m2", "The project uses TypeScript."),
  }
}

test("#given pending facts #when launch binds with no input #then the real provider receives zero requests", async () => {
  const f = await providerFixture(CHOSEN)
  const run = await f.start()
  await run.drain()
  expect(f.requests).toEqual([])
  expect(await f.queue.listPending()).toHaveLength(1)
}, 30_000)

test("#given pending facts from a previous run #when a fresh wiring relaunches #then the real provider receives zero requests", async () => {
  const f = await providerFixture(CHOSEN)
  const first = await f.start()
  await first.close()
  const relaunched = await f.start()
  await relaunched.drain()
  expect(f.requests).toEqual([])
  expect((await f.queue.listPending()).map((entry) => entry.range.end_message_id)).toContain("m1")
}, 30_000)

test("#given a chosen model #when a real prompt settles #then extraction sends that model and consumes pending work", async () => {
  const f = await providerFixture(CHOSEN)
  const run = await f.start()
  await run.drain()
  f.requests.splice(0)
  await run.pi.dispatch("input", { type: "input", source: "rpc", inputId: "input-1", text: "Remember this." }, f.eventCtx)
  await run.pi.dispatch("input_disposition", { type: "input_disposition", inputId: "input-1", disposition: "started" }, f.eventCtx)
  await run.pi.dispatch("agent_settled", {}, f.eventCtx)
  await run.drain()
  expect(f.requests.length).toBeGreaterThan(0)
  expect(new Set(f.requests)).toEqual(new Set([CHOSEN]))
  expect(await f.queue.listPending()).toHaveLength(0)
}, 30_000)

test("#given no chosen or configured model but a built-in model is available #when a real prompt settles #then extraction skips with one log line", async () => {
  const f = await providerFixture(undefined)
  const run = await f.start()
  await run.drain()
  f.requests.splice(0)
  f.logs.splice(0)
  await run.pi.dispatch("input", { type: "input", source: "rpc", inputId: "input-1", text: "Remember this." }, f.eventCtx)
  await run.pi.dispatch("input_disposition", { type: "input_disposition", inputId: "input-1", disposition: "started" }, f.eventCtx)
  await run.pi.dispatch("agent_settled", {}, f.eventCtx)
  await run.drain()
  expect(f.requests).toEqual([])
  expect(f.logs.filter((log) => log.details !== undefined && typeof log.details === "object" && log.details !== null && "cause" in log.details)).toHaveLength(1)
  expect((await f.queue.listPending()).map((entry) => entry.range.end_message_id)).toContain("m1")
}, 30_000)

test("#given an explicit extraction model #when a real prompt settles #then that model overrides the session selection", async () => {
  const f = await providerFixture(CHOSEN, "openai/explicit-extractor")
  const run = await f.start()
  await run.pi.dispatch("input", { type: "input", source: "rpc", inputId: "input-1", text: "Remember this." }, f.eventCtx)
  await run.pi.dispatch("input_disposition", { type: "input_disposition", inputId: "input-1", disposition: "started" }, f.eventCtx)
  await run.pi.dispatch("agent_settled", {}, f.eventCtx)
  await run.drain()
  expect(f.requests.length).toBeGreaterThan(0)
  expect(new Set(f.requests)).toEqual(new Set(["explicit-extractor"]))
}, 30_000)

test("#given an unavailable explicit model #when a real prompt settles #then extraction does not fall back to the chosen or built-in model", async () => {
  const f = await providerFixture(CHOSEN, "missing/model")
  const run = await f.start()
  await run.pi.dispatch("input", { type: "input", source: "rpc", inputId: "input-1", text: "Remember this." }, f.eventCtx)
  await run.pi.dispatch("input_disposition", { type: "input_disposition", inputId: "input-1", disposition: "started" }, f.eventCtx)
  await run.pi.dispatch("agent_settled", {}, f.eventCtx)
  await run.drain()
  expect(f.requests).toEqual([])
}, 30_000)

test("#given extension input or rejected user input #when a synthetic settle arrives #then queued extraction stays dormant", async () => {
  const f = await providerFixture(CHOSEN)
  const run = await f.start()
  await run.pi.dispatch("input", { type: "input", source: "extension", inputId: "extension-1", text: "Hidden wake" }, f.eventCtx)
  await run.pi.dispatch("input_disposition", { type: "input_disposition", inputId: "extension-1", disposition: "started" }, f.eventCtx)
  await run.pi.dispatch("input", { type: "input", source: "rpc", inputId: "rejected-1", text: "Rejected" }, f.eventCtx)
  await run.pi.dispatch("input_disposition", { type: "input_disposition", inputId: "rejected-1", disposition: "handled" }, f.eventCtx)
  await run.pi.dispatch("agent_settled", {}, f.eventCtx)
  await run.drain()
  expect(f.requests).toEqual([])
}, 30_000)

test("#given a previously accepted prompt and new pending facts #when the same session is rebound without another prompt #then extraction permission resets", async () => {
  const f = await providerFixture(CHOSEN)
  const run = await f.start()
  await run.pi.dispatch("input", { type: "input", source: "rpc", inputId: "input-1", text: "Remember this." }, f.eventCtx)
  await run.pi.dispatch("input_disposition", { type: "input_disposition", inputId: "input-1", disposition: "queued" }, f.eventCtx)
  await run.pi.dispatch("agent_settled", {}, f.eventCtx)
  await run.drain()
  await f.seedPending()
  f.requests.splice(0)
  await run.rebind()
  await run.pi.dispatch("agent_settled", {}, f.eventCtx)
  await run.drain()
  expect(f.requests).toEqual([])
  expect((await f.queue.listPending()).map((entry) => entry.range.end_message_id)).toContain("m2")
}, 30_000)

test("#given a selected model visible in the catalog but without provider credentials #when a real prompt settles #then extraction skips without reserving a run", async () => {
  const f = await providerFixture(CHOSEN)
  f.registry.registerProvider("uncredentialed-fixture", {
    api: "openai-completions", baseUrl: "https://example.invalid",
    models: [{
      id: "selected", name: "Selected", reasoning: false, input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 100_000, maxTokens: 4096,
    }],
  })
  f.eventCtx.model = f.registry.find("uncredentialed-fixture", "selected")
  expect(f.eventCtx.model).toBeDefined()
  expect(f.registry.getAvailable().some((model) => model.provider === "uncredentialed-fixture")).toBe(false)
  const run = await f.start()
  await run.pi.dispatch("input", { type: "input", source: "rpc", inputId: "input-1", text: "Remember this." }, f.eventCtx)
  await run.pi.dispatch("input_disposition", { type: "input_disposition", inputId: "input-1", disposition: "started" }, f.eventCtx)
  await run.pi.dispatch("agent_settled", {}, f.eventCtx)
  await run.drain()
  expect(f.requests).toEqual([])
  expect(existsSync(join(f.identity.paths.facts, "runs"))).toBe(false)
}, 30_000)

test("#given a chosen model at admission #when the live selection changes during queue I/O #then extraction retains its originating model", async () => {
  const f = await providerFixture(CHOSEN)
  await f.start()
  const extraction = f.extractPending()
  f.eventCtx.model = f.registry.find("openai", BUILTIN)
  await extraction
  expect(f.requests.length).toBeGreaterThan(0)
  expect(new Set(f.requests)).toEqual(new Set([CHOSEN]))
}, 30_000)
