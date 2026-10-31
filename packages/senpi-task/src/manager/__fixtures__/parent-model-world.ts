import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { ToolDefinition } from "@code-yeongyu/senpi"
import { Type } from "typebox"

import { loadSenpiBarrel } from "../../lazy/senpi-barrel"
import { InProcessRunner } from "../../runners/in-process"
import { createInProcessManagedRunner } from "../runner"
import type { ManagedRunner } from "../types"
import type { ManagedChildHandle } from "../child-handle"

export const CLAUDE = "pm-claude"
export const GPT = "pm-gpt"
export const ALT = "pm-alt"
export const COUNT_TOOL = "count_once"

export const QUOTA_ERROR =
  `403: {"message":"You've reached your usage limit for this billing cycle. Your limit resets 3:20am.",` +
  `"type":"access_terminated_error"}`

// A limit whose wording names neither a model family nor the account (#11383).
export const WEEKLY_LIMIT_ERROR = '{"type":"error","error":{"type":"rate_limit_error","message":"Weekly usage limit reached. Resets at 2099-10-29T04:27:07Z."}}'

export type Step = "quota" | "weekly" | "complete" | "silent" | { readonly tool: string } | { readonly partialTool: string }

export type ProviderCall = {
  readonly model: string
  readonly toolResults: number
}

export type ParentModelWorld = {
  readonly settingsPath: string
  readonly calls: ProviderCall[]
  toolRuns(): number
  runner(): ManagedRunner
  dispose(): Promise<void>
}

const MODELS: Readonly<Record<string, readonly string[]>> = {
  [CLAUDE]: ["primary", "sibling"],
  [GPT]: ["parent"],
  [ALT]: ["rung"],
}

/**
 * Three logged-in providers behind a real senpi engine. Each model answers from its own script (then
 * completes), every request records how many tool results its context carried, and one tool counts
 * how often it actually ran, so a test can tell a resumed transcript from a re-run.
 */
export async function createParentModelWorld(scripts: Readonly<Record<string, readonly Step[]>>): Promise<ParentModelWorld> {
  const { ModelRegistry, ModelRuntime } = await loadSenpiBarrel()
  const root = mkdtempSync(join(tmpdir(), "senpi-task-parent-model-"))
  const agentDir = join(root, "agent")
  mkdirSync(agentDir, { recursive: true })
  const settingsPath = join(agentDir, "settings.json")
  writeFileSync(settingsPath, `${JSON.stringify({ defaultProvider: CLAUDE, defaultModel: "primary" }, null, 2)}\n`)
  const modelRuntime = ModelRuntime.createSync({ agentDir })
  const modelRegistry = new ModelRegistry(modelRuntime)
  const remaining = new Map(Object.entries(scripts).map(([model, steps]) => [model, [...steps]]))
  const calls: ProviderCall[] = []
  const handles = new Set<ManagedChildHandle>()
  let toolRuns = 0

  for (const [provider, ids] of Object.entries(MODELS)) {
    Reflect.apply(modelRegistry.registerProvider, modelRegistry, [provider, {
      api: "openai-completions",
      baseUrl: `file://${provider}`,
      apiKey: "test-key",
      models: ids.map(testModel),
      async streamSimple(
        model: { readonly id: string },
        context: { readonly messages: readonly { readonly role: string }[] },
        options: { readonly onPayload?: (payload: unknown) => unknown },
      ) {
        // Real providers call this hook immediately before sending their request. The synthetic
        // provider has no HTTP payload, but must preserve that boundary for request-time budgets.
        await options.onPayload?.({ model: model.id })
        const key = `${provider}/${model.id}`
        calls.push({ model: key, toolResults: context.messages.filter((message) => message.role === "toolResult").length })
        const step = remaining.get(key)?.shift() ?? "complete"
        return answer(provider, model.id, step)
      },
    }])
  }

  const countTool: ToolDefinition = {
    name: COUNT_TOOL,
    label: COUNT_TOOL,
    description: "Counts how often it ran.",
    parameters: Type.Object({}),
    execute: async () => {
      toolRuns += 1
      return { content: [{ type: "text", text: `ran ${toolRuns}` }], details: undefined }
    },
  }

  return {
    settingsPath,
    calls,
    toolRuns: () => toolRuns,
    runner: () => {
      const runner = createInProcessManagedRunner(new InProcessRunner({ sharedParentTools: [countTool] }), (spec) => {
        const [provider, id] = (spec.model ?? "").split("/")
        const model = provider === undefined || id === undefined ? undefined : modelRegistry.find(provider, id)
        return { agentDir, projectTrusted: false, modelRegistry, modelRuntime, ...(model === undefined ? {} : { model }) }
      })
      return { ...runner, start: async spec => {
        const handle = await runner.start(spec)
        handles.add(handle)
        return handle
      } }
    },
    dispose: async () => {
      try {
        await Promise.all([...handles].map(async handle => { await handle.abort(); await handle.dispose() }))
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    },
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

function answer(provider: string, model: string, step: Step) {
  const base = {
    role: "assistant" as const,
    api: "openai-completions" as const,
    provider,
    model,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    timestamp: Date.now(),
  }
  const toolCall = (name: string) => ({ type: "toolCall" as const, id: `call-${name}`, name, arguments: {} })
  if (step === "quota") return stream([], { ...base, content: [], stopReason: "error" as const, errorMessage: QUOTA_ERROR })
  if (step === "weekly") return stream([], { ...base, content: [], stopReason: "error" as const, errorMessage: WEEKLY_LIMIT_ERROR })
  // The provider accepted the call and never answers.
  if (step === "silent") return { result: () => new Promise<never>(() => {}), [Symbol.asyncIterator]: () => ({ next: () => new Promise<never>(() => {}) }) }
  if (step === "complete") {
    return stream([], { ...base, content: [{ type: "text" as const, text: `${provider}/${model} completed` }], stopReason: "stop" as const })
  }
  if ("tool" in step) return stream([], { ...base, content: [toolCall(step.tool)], stopReason: "toolUse" as const })
  // The limit lands while the call is still streaming: the provider had opened it, then errored.
  const partial = { ...base, content: [toolCall(step.partialTool)], stopReason: "toolUse" as const }
  return stream(
    [{ type: "start", partial }, { type: "toolcall_start", contentIndex: 0, partial }],
    { ...partial, stopReason: "error" as const, errorMessage: QUOTA_ERROR },
  )
}

function stream<Message extends { readonly stopReason: string }>(opening: readonly unknown[], message: Message) {
  const events = [
    ...opening,
    message.stopReason === "error" ? { type: "error", reason: "error", error: message } : { type: "done", reason: message.stopReason, message },
  ]
  return {
    result: () => Promise.resolve(message),
    [Symbol.asyncIterator]() {
      let index = 0
      return {
        next(): Promise<IteratorResult<unknown>> {
          const value = events[index]
          index += 1
          return Promise.resolve(value === undefined ? { value: undefined, done: true } : { value, done: false })
        },
      }
    },
  }
}
