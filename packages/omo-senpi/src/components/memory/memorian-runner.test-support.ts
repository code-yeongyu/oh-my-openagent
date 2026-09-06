import { realpathSync } from "node:fs"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { CreateAgentSessionOptions } from "@code-yeongyu/senpi"
import {
  PendingNudges,
  buildIdentityPaths,
  type MemoryIdentityPaths,
  type RecallCandidate,
} from "@oh-my-opencode/memory-core"
import type { ChildHandle, ChildModelRegistry, ChildSession, ChildSessionListener, CreateChildSession } from "@oh-my-opencode/senpi-task"

import { ModelRegistry, ModelRuntime } from "../../senpi-test-runtime"
import type { MemorianGateRunner } from "./memorian-runner"
import type { MemorianNudgeTool } from "./memorian-nudge-tool"

export const IDENTITY = "memorian-agent"
export const SESSION_ID = "session-gate-1"
export const CANDIDATE_PATH = "reference/kubernetes-rollouts.md"
export const roots: string[] = []

export const CANDIDATES: readonly RecallCandidate[] = [
  { path: CANDIDATE_PATH, description: "Rollout policy", excerpt: "drain first", score: 1 },
]

export async function callNudge(options: CreateAgentSessionOptions, path: string, hint: string): Promise<{ readonly text: string; readonly isError: boolean }> {
  const tool = options.customTools?.find((candidate): candidate is MemorianNudgeTool => candidate.name === "nudge")
  if (tool === undefined) throw new Error("nudge tool missing from the child session options")
  const result = await tool.execute("call-1", { path, hint })
  const text = result.content.find((part) => part.type === "text")?.text ?? ""
  return { text, isError: "isError" in result && result.isError === true }
}

/**
 * The settle-time registry snapshot, as production captures it: the parent session's concrete
 * ModelRegistry. The runtime is created catalog-free (modelsPath: null) so the fixture owns exactly
 * which models exist - the shipped catalog would otherwise satisfy the quick chain on its own. An
 * in-process child shares this exact instance, so the judge cannot drift onto another engine's
 * model set.
 */
export function registrySnapshot(models: readonly { readonly id: string }[] = [{ id: "mock-1" }]): ChildModelRegistry {
  const registry = new ModelRegistry(ModelRuntime.createSync({ modelsPath: null }))
  registry.registerProvider("omo-mock", {
    api: "openai-completions",
    baseUrl: "https://example.test",
    apiKey: "test-key",
    models: models.map((model) => ({
      id: model.id,
      name: `Mock ${model.id}`,
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 1,
      maxTokens: 1,
    })),
  })
  return registry
}

interface ScriptedSession {
  readonly createSession: CreateChildSession
  readonly promptTexts: string[]
  readonly created: number
  /** Resolves once the child turn has actually started (prompt() was entered). */
  whenPrompted(): Promise<void>
  /** Settle the open turn; safe to call before the turn starts (the request is deferred). */
  resolve(): void
}

/**
 * A fake in-process child session: prompt() runs the script against the session options the
 * runner assembled (custom tools, model, loader), so the script can drive real `nudge` tool calls.
 * The turn settles when the test resolves it; a never-resolved script pins the turn open.
 */
export function scriptedSession(script: (options: CreateAgentSessionOptions) => Promise<void>): ScriptedSession {
  let captured: CreateAgentSessionOptions | undefined
  let settle: (() => void) | undefined
  let resolveRequested = false
  let onPrompted: (() => void) | undefined
  const prompted = new Promise<void>((resolve) => {
    onPrompted = resolve
  })
  const promptTexts: string[] = []
  const listeners = new Set<ChildSessionListener>()
  let created = 0
  const session: ChildSession = {
    sessionId: "memorian-child-1",
    async prompt(text) {
      promptTexts.push(text)
      onPrompted?.()
      const options = captured
      if (options === undefined) throw new Error("session options were not captured")
      await script(options)
      for (const listener of listeners) {
        listener({ type: "message_end", message: { role: "assistant", content: [{ type: "toolCall", id: "call-1", name: "nudge", arguments: {} }], stopReason: "toolUse" } })
        listener({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "" }], stopReason: "stop" } })
      }
      await new Promise<void>((resolve) => {
        settle = resolve
        if (resolveRequested) resolve()
      })
    },
    async steer() {},
    async followUp() {},
    async abort() {},
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getLastAssistantText: () => undefined,
    dispose() {},
  }
  return {
    promptTexts,
    whenPrompted: () => prompted,
    get created() {
      return created
    },
    resolve: () => {
      resolveRequested = true
      settle?.()
    },
    createSession: async (options) => {
      created += 1
      captured = options
      return session
    },
  }
}

export async function fixture(): Promise<{ root: string, identityPaths: MemoryIdentityPaths }> {
  const root = realpathSync.native(await mkdtemp(join(tmpdir(), "omo-memorian-runner-")))
  roots.push(root)
  return { root, identityPaths: buildIdentityPaths(root, IDENTITY) }
}

export async function nudgeOnce(options: CreateAgentSessionOptions): Promise<void> {
  const result = await callNudge(options, CANDIDATE_PATH, "Drain nodes before a rollout.")
  if (result.isError) throw new Error(`nudge rejected: ${result.text}`)
}

export function runnerOptions(
  identityPaths: MemoryIdentityPaths,
  overrides: Partial<ConstructorParameters<typeof MemorianGateRunner>[0]> = {},
): ConstructorParameters<typeof MemorianGateRunner>[0] {
  return {
    identityPaths,
    loadConfig: () => ({
      config: { categories: { quick: { model: "omo-mock/mock-1" } } },
      diagnostics: [],
      layers: [],
      sources: [],
    }),
    env: {},
    ...overrides,
  }
}

export function launchInput(overrides: Partial<Parameters<MemorianGateRunner["launch"]>[0]> = {}) {
  return {
    sessionId: SESSION_ID,
    candidates: CANDIDATES,
    surfaced: new Set<string>(),
    maxItems: 2,
    transcript: [{ role: "user" as const, text: "how do we handle kubernetes rollouts" }],
    modelRegistry: registrySnapshot(),
    ...overrides,
  }
}
