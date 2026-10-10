import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { loadSenpiBarrel } from "../../lazy/senpi-barrel"
import type { ChildSpec } from "../in-process"

export const PROVIDER = "caller-settings-test"

export type ProviderCall = {
  readonly modelId: string
  readonly timeoutMs: unknown
  readonly aborted: Promise<string>
}

export type ModelBehavior = "hang" | "quota" | "complete"

export type CallerSettingsWorld = {
  readonly root: string
  readonly agentDir: string
  readonly settingsPath: string
  readonly calls: ProviderCall[]
  readonly firstCall: Promise<ProviderCall>
  spec(overrides?: Partial<ChildSpec>): ChildSpec
  dispose(): void
}

const QUOTA_ERROR =
  `403: {"message":"You've reached your usage limit for this billing cycle.",` +
  `"type":"access_terminated_error"}`

/**
 * A caller whose settings.json lives in a temp agent dir, and a provider whose models either never
 * send a first event, fail with a fallback-eligible quota error, or complete. Every request records
 * the timeout the engine handed it and when (and why) the engine aborted it.
 */
export async function createCallerSettingsWorld(
  settings: Record<string, unknown>,
  behaviors: Readonly<Record<string, ModelBehavior>>,
): Promise<CallerSettingsWorld> {
  const { ModelRegistry, ModelRuntime } = await loadSenpiBarrel()
  const root = mkdtempSync(join(tmpdir(), "senpi-task-caller-settings-"))
  const agentDir = join(root, "agent")
  const cwd = join(root, "project")
  mkdirSync(agentDir, { recursive: true })
  mkdirSync(cwd, { recursive: true })
  const settingsPath = join(agentDir, "settings.json")
  writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`)
  const modelRuntime = ModelRuntime.createSync({ agentDir })
  const modelRegistry = new ModelRegistry(modelRuntime)
  const calls: ProviderCall[] = []
  let reportFirst: (call: ProviderCall) => void = () => {}
  const firstCall = new Promise<ProviderCall>((resolve) => { reportFirst = resolve })
  const provider = {
    api: "openai-completions",
    baseUrl: "file://caller-settings-test",
    apiKey: "test-key",
    models: Object.keys(behaviors).map(testModel),
    streamSimple(model: { readonly id: string }, _context: unknown, options: { readonly timeoutMs?: unknown; readonly signal?: AbortSignal }) {
      const stream = createStream()
      const aborted = new Promise<string>((resolve) => {
        options.signal?.addEventListener("abort", () => {
          const reason: unknown = options.signal?.reason
          resolve(reason instanceof Error ? reason.message : String(reason))
          stream.end(assistant(model.id, "aborted"))
        }, { once: true })
      })
      const call = { modelId: model.id, timeoutMs: options.timeoutMs, aborted }
      calls.push(call)
      reportFirst(call)
      const behavior = behaviors[model.id] ?? "complete"
      if (behavior !== "hang") queueMicrotask(() => stream.end(assistant(model.id, behavior === "quota" ? "error" : "stop")))
      return stream
    },
  }
  Reflect.apply(modelRegistry.registerProvider, modelRegistry, [PROVIDER, provider])
  return {
    root,
    agentDir,
    settingsPath,
    calls,
    firstCall,
    spec(overrides = {}) {
      const model = modelRegistry.find(PROVIDER, Object.keys(behaviors)[0] ?? "")
      if (model === undefined) throw new Error("caller-settings world has no primary model")
      return {
        taskId: "task-caller-settings",
        cwd,
        sessionDir: join(root, "sessions"),
        agentDir,
        projectTrusted: true,
        depth: 0,
        parentSessionId: "parent-1",
        rootSessionId: "root-1",
        prompt: "do the work",
        promptEnvelope: "bare",
        modelRegistry,
        modelRuntime,
        model,
        ...overrides,
      }
    },
    dispose() {
      rmSync(root, { recursive: true, force: true })
    },
  }
}

type Message = ReturnType<typeof assistant>

function assistant(model: string, outcome: "stop" | "error" | "aborted") {
  return {
    role: "assistant" as const,
    content: outcome === "stop" ? [{ type: "text" as const, text: `${model} completed` }] : [],
    api: "openai-completions" as const,
    provider: PROVIDER,
    model,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: 0 },
    stopReason: outcome,
    ...(outcome === "error" ? { errorMessage: QUOTA_ERROR } : {}),
    timestamp: Date.now(),
  }
}

function testModel(id: string) {
  return {
    id,
    name: id,
    reasoning: false,
    input: ["text"] as Array<"text">,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200_000,
    maxTokens: 4096,
  }
}

function createStream() {
  const waiters: Array<(value: IteratorResult<unknown>) => void> = []
  const queue: unknown[] = []
  let finished = false
  let settle: (message: Message) => void = () => {}
  const result = new Promise<Message>((resolve) => { settle = resolve })
  return {
    end(message: Message) {
      if (finished) return
      finished = true
      settle(message)
      const event = message.stopReason === "stop"
        ? { type: "done", reason: "stop", message }
        : { type: "error", reason: message.stopReason, error: message }
      const waiter = waiters.shift()
      if (waiter === undefined) queue.push(event)
      else waiter({ value: event, done: false })
      for (const rest of waiters.splice(0)) rest({ value: undefined, done: true })
    },
    result: () => result,
    [Symbol.asyncIterator]() {
      return {
        next(): Promise<IteratorResult<unknown>> {
          if (queue.length > 0) return Promise.resolve({ value: queue.shift(), done: false })
          if (finished) return Promise.resolve({ value: undefined, done: true })
          return new Promise((resolve) => waiters.push(resolve))
        },
      }
    },
  }
}
