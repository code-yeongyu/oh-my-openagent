import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { ToolDefinition } from "@code-yeongyu/senpi"
import { Type } from "typebox"

import { loadSenpiBarrel } from "../../lazy/senpi-barrel"
import { InProcessRunner } from "../../runners/in-process"
import { createInProcessManagedRunner } from "../runner"
import type { ManagedRunner } from "../types"
import { answer, ALT, CLAUDE, GPT, MODELS, type Step, testModel } from "./model-chain-answers"
import { type EngineRunner, type EngineRunnerKind, startEngineRunner } from "./model-chain-engines"

export { ALT, CLAUDE, GPT, type Step }
export const COUNT_TOOL = "count_once"

export type RunnerKind = "in-process" | EngineRunnerKind

export type ProviderCall = {
  readonly model: string
  readonly toolResults: number
}

export type ModelChainWorld = {
  readonly settingsPath: string
  readonly calls: readonly ProviderCall[]
  toolRuns(): number
  runner(): ManagedRunner
  engineRunner(kind: EngineRunnerKind): Promise<ManagedRunner>
  dispose(): Promise<void>
}

export type ModelChainWorldOptions = {
  readonly userFallbackChains?: Readonly<Record<string, readonly string[]>>
}

/**
 * Three logged-in providers behind a real senpi engine. Each model answers from its own script (then
 * completes), every request records how many tool results its context carried, and one tool counts
 * how often it actually ran, so a test can tell a resumed transcript from a re-run. The same providers
 * load into a per-child process or a socket host through `engineRunner`.
 */
export async function createModelChainWorld(
  scripts: Readonly<Record<string, readonly Step[]>>,
  options: ModelChainWorldOptions = {},
): Promise<ModelChainWorld> {
  const { ModelRegistry, ModelRuntime } = await loadSenpiBarrel()
  const root = mkdtempSync(join(tmpdir(), "senpi-task-model-chain-"))
  const agentDir = join(root, "agent")
  mkdirSync(agentDir, { recursive: true })
  const settingsPath = join(agentDir, "settings.json")
  const retry = options.userFallbackChains === undefined ? {} : { retry: { fallbackChains: options.userFallbackChains } }
  writeFileSync(settingsPath, `${JSON.stringify({ defaultProvider: CLAUDE, defaultModel: "primary", ...retry }, null, 2)}\n`)
  const engines: EngineRunner[] = []
  const modelRuntime = ModelRuntime.createSync({ agentDir })
  const modelRegistry = new ModelRegistry(modelRuntime)
  const remaining = new Map(Object.entries(scripts).map(([model, steps]) => [model, [...steps]]))
  const calls: ProviderCall[] = []
  let toolRuns = 0

  for (const [provider, ids] of Object.entries(MODELS)) {
    Reflect.apply(modelRegistry.registerProvider, modelRegistry, [provider, {
      api: "openai-completions",
      baseUrl: `file://${provider}`,
      apiKey: "test-key",
      models: ids.map(testModel),
      streamSimple(model: { readonly id: string }, context: { readonly messages: readonly { readonly role: string }[] }) {
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
    get calls(): readonly ProviderCall[] {
      return [...calls, ...engines.flatMap((engine) => engine.calls.map((model) => ({ model, toolResults: 0 })))]
    },
    toolRuns: () => toolRuns,
    runner: () => createInProcessManagedRunner(new InProcessRunner({ sharedParentTools: [countTool] }), (spec) => {
      const [provider, id] = (spec.model ?? "").split("/")
      const model = provider === undefined || id === undefined ? undefined : modelRegistry.find(provider, id)
      return { agentDir, projectTrusted: false, modelRegistry, modelRuntime, ...(model === undefined ? {} : { model }) }
    }),
    engineRunner: async (kind) => {
      const engine = await startEngineRunner(kind, { root, settingsPath, scripts })
      engines.push(engine)
      return engine.runner
    },
    dispose: async () => {
      for (const engine of engines.splice(0)) await engine.stop()
      rmSync(root, { recursive: true, force: true })
    },
  }
}
