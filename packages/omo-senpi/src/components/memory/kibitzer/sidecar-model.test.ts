import { describe, expect, test } from "bun:test"

import type { OmoConfig } from "@oh-my-opencode/omo-config-core"
import { resolveCategory, type ChildHandle, type ChildModelRegistry, type ChildSpec, type SenpiModelPort } from "@oh-my-opencode/senpi-task"

import {
  buildKibitzerSidecarSpec,
  createKibitzerSidecarChildStarter,
  KIBITZER_SIDECAR_DEFAULT_CATEGORY,
  KibitzerSidecarStartError,
  kibitzerConfigurationFailure,
  resolveKibitzerSidecarModel,
} from "./sidecar-model"
import { KIBITZER_SIDECAR_TOOL_NAMES } from "./sidecar-prompt"
import { createWakeToolBudget } from "./tools/budget"
import { createKibitzerSidecarNudgeTool } from "./tools/nudge"

const model: SenpiModelPort = { provider: "omo-mock", id: "mock-1" }
const registry = {
  getAvailable: () => [model],
  find: (provider: string, modelId: string) => (provider === model.provider && modelId === model.id ? model : undefined),
}
const config: OmoConfig = { categories: { quick: { model: "omo-mock/mock-1" } } }
const deadRegistry = { getAvailable: () => [], find: () => undefined }
/** Only a provider outside the quick chain is connected: the reported kimi-coding-only user. */
const beyondRegistry = {
  getAvailable: () => [{ provider: "kimi-coding", id: "k3", contextWindow: 200_000, cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 } }],
  find: () => undefined,
}
/** The builtin quick chain's unconnected providers, straight from the category resolver. */
function chainMissingProviders(registry: typeof deadRegistry | typeof beyondRegistry): readonly string[] {
  const chain = resolveCategory("quick", { categories: {} }, registry)
  if (chain.kind !== "model_unavailable" || chain.missing_providers === undefined) throw new Error("the quick chain is not dead")
  return chain.missing_providers
}

function nudgeTool() {
  const budget = createWakeToolBudget(8)
  return createKibitzerSidecarNudgeTool({
    offered: new Set(), searched: new Set(), surfaced: new Set(), maxItems: 2, accepted: () => [], budget: () => budget,
  })
}

describe("resolveKibitzerSidecarModel", () => {
  test("#given the quick category pinned to a registered model #when resolved #then the sidecar model and its chain are returned", () => {
    expect(KIBITZER_SIDECAR_DEFAULT_CATEGORY).toBe("quick")

    const resolution = resolveKibitzerSidecarModel({ config, registry })

    // thinking rides in from the builtin quick default (gpt-5.6-luna-fast at low); the pinned model
    // declares no reasoning of its own.
    expect(resolution).toEqual({
      kind: "resolved",
      category: "quick",
      model: "omo-mock/mock-1",
      thinking: "low",
      fallbacks: [],
      chain: { selectedModel: "omo-mock/mock-1" },
    })
  })

  test("#given no registry snapshot or a dead category #when resolved #then the sidecar refuses instead of drifting to another model", () => {
    expect(resolveKibitzerSidecarModel({ config, registry: undefined }))
      .toEqual({ kind: "unavailable", category: "quick", cause: "registry_snapshot_unavailable" })
    expect(resolveKibitzerSidecarModel({ config: { categories: {} }, registry: deadRegistry }))
      .toEqual({ kind: "unavailable", category: "quick", cause: "category_unavailable", missingProviders: chainMissingProviders(deadRegistry) })
    // A registry that still offers SOME usable model must not be adopted beyond the pinned category.
    expect(resolveKibitzerSidecarModel({ config: { categories: {} }, registry: beyondRegistry }))
      .toMatchObject({ kind: "unavailable", category: "quick", cause: "beyond_category" })
  })

  test("#given only a provider outside the chain is connected #when resolved #then the beyond-category refusal still names the chain's unconnected providers", () => {
    const missing = chainMissingProviders(beyondRegistry)
    expect(missing.length).toBeGreaterThan(0)
    expect(missing).not.toContain("kimi-coding")

    const resolution = resolveKibitzerSidecarModel({ config: { categories: {} }, registry: beyondRegistry })

    expect(resolution).toEqual({ kind: "unavailable", category: "quick", cause: "beyond_category", missingProviders: missing })
  })
})

describe("buildKibitzerSidecarSpec", () => {
  test("#given the sidecar tools #when the spec is built #then exactly the five read-only names are visible, the seed is bare, and completion is per turn", () => {
    const tools = [nudgeTool()]

    const spec = buildKibitzerSidecarSpec({
      sessionId: "parent-1",
      generation: 3,
      cwd: "/workspace",
      sessionDir: "/state/recall/sidecars/cGFyZW50LTE",
      agentDir: "/home/agent",
      modelRegistry: undefined,
      model: undefined,
      chain: { selectedModel: "omo-mock/mock-1" },
      systemPrompt: "persona",
      tools,
      prompt: "<kibitzer-seed/>",
    })

    expect(spec.taskId).toBe("kibitzer-parent-1-3")
    expect(spec.toolAllowlist).toEqual([...KIBITZER_SIDECAR_TOOL_NAMES])
    expect(spec.memberScopedTools).toBe(tools)
    expect(spec.memberScopedToolNames).toEqual(["nudge"])
    expect(spec).toMatchObject({
      cwd: "/workspace",
      sessionDir: "/state/recall/sidecars/cGFyZW50LTE",
      agentDir: "/home/agent",
      selectedModel: "omo-mock/mock-1",
      depth: 1,
      parentSessionId: "parent-1",
      rootSessionId: "parent-1",
      systemPrompt: "persona",
      promptEnvelope: "bare",
      completion: "turn",
      prompt: "<kibitzer-seed/>",
    })
    for (const forbidden of ["bash", "edit", "write", "find", "ls", "memory_search", "memory_read"]) {
      expect(spec.toolAllowlist).not.toContain(forbidden)
    }
    expect(spec.toolDenylist).toBeUndefined()
  })
})

describe("createKibitzerSidecarChildStarter", () => {
  const base = {
    cwd: "/workspace",
    sessionDir: "/state/recall/sidecars/cGFyZW50LTE",
    agentDir: "/home/agent",
    loadConfig: () => config,
    // The resolver reads only the port half (getAvailable/find); the runner seam below never touches the rest.
    modelRegistry: () => registry as unknown as ChildModelRegistry,
    loadPersona: () => "persona text",
  }

  test("#given a runner seam #when the starter runs #then one child starts from the persona and the seed and the handle is returned", async () => {
    const specs: ChildSpec[] = []
    const handle = { task_id: "t", sessionId: "child-1" } as unknown as ChildHandle
    const start = createKibitzerSidecarChildStarter({
      ...base,
      createRunner: () => ({ start: async (spec) => (specs.push(spec), handle) }),
    })

    const started = await start({ sessionId: "parent-1", generation: 1, prompt: "<kibitzer-seed/>", tools: [nudgeTool()], maxItems: 2 })

    expect(started).toBe(handle)
    expect(specs).toHaveLength(1)
    expect(specs[0]).toMatchObject({ taskId: "kibitzer-parent-1-1", systemPrompt: "persona text", prompt: "<kibitzer-seed/>", selectedModel: "omo-mock/mock-1", completion: "turn" })
  })

  test("#given an unreadable persona or an unresolvable category #when the starter runs #then it fails typed with the cause and starts nothing", async () => {
    let starts = 0
    const runner = () => ({ start: async () => (starts += 1, {} as ChildHandle) })
    const input = { sessionId: "parent-1", generation: 1, prompt: "<kibitzer-seed/>", tools: [nudgeTool()], maxItems: 2 }

    const persona = createKibitzerSidecarChildStarter({ ...base, loadPersona: () => { throw new Error("ENOENT") }, createRunner: runner })
    const personaError = await persona(input).catch((error: unknown) => error)
    expect(personaError).toBeInstanceOf(KibitzerSidecarStartError)
    expect((personaError as KibitzerSidecarStartError).code).toBe("persona_unavailable")

    const category = createKibitzerSidecarChildStarter({ ...base, modelRegistry: () => undefined, createRunner: runner })
    const categoryError = await category(input).catch((error: unknown) => error)
    expect(categoryError).toBeInstanceOf(KibitzerSidecarStartError)
    expect((categoryError as KibitzerSidecarStartError).code).toBe("registry_snapshot_unavailable")

    expect(starts).toBe(0)
  })

  test("#given each start refusal #when classified #then only the two category refusals are a configuration state, carrying the category and its unconnected providers", async () => {
    const runner = () => ({ start: async (): Promise<ChildHandle> => { throw new Error("spawn failed") } })
    const input = { sessionId: "parent-1", generation: 1, prompt: "<kibitzer-seed/>", tools: [nudgeTool()], maxItems: 2 }
    const refusal = (options: Partial<Parameters<typeof createKibitzerSidecarChildStarter>[0]>) =>
      createKibitzerSidecarChildStarter({ ...base, createRunner: runner, ...options })(input).catch((error: unknown) => error)

    const dead = await refusal({ loadConfig: () => ({}), modelRegistry: () => deadRegistry as unknown as ChildModelRegistry })
    const beyond = await refusal({ loadConfig: () => ({}), modelRegistry: () => beyondRegistry as unknown as ChildModelRegistry })
    const transient = [
      await refusal({ modelRegistry: () => undefined }),
      await refusal({ loadPersona: () => { throw new Error("ENOENT") } }),
      await refusal({}),
      new KibitzerSidecarStartError("runtime_unavailable", "no in-process runner available"),
      new Error("not a start error"),
    ]

    expect(kibitzerConfigurationFailure(dead)).toEqual({ category: "quick", cause: "category_unavailable", missingProviders: chainMissingProviders(deadRegistry) })
    expect(kibitzerConfigurationFailure(beyond)).toEqual({ category: "quick", cause: "beyond_category", missingProviders: chainMissingProviders(beyondRegistry) })
    expect(transient.map((error) => error instanceof KibitzerSidecarStartError ? error.code : "plain"))
      .toEqual(["registry_snapshot_unavailable", "persona_unavailable", "session_create_failed", "runtime_unavailable", "plain"])
    for (const error of transient) expect(kibitzerConfigurationFailure(error)).toBeUndefined()
  })
})
