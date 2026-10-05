import { describe, expect, test } from "bun:test"

import type { OmoConfig } from "@oh-my-opencode/omo-config-core"
import type { ChildHandle, ChildModelRegistry, ChildSpec, SenpiModelPort } from "@oh-my-opencode/senpi-task"

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
    const dead = resolveKibitzerSidecarModel({ config: { categories: {} }, registry: { getAvailable: () => [], find: () => undefined } })
    expect(dead).toMatchObject({ kind: "unavailable", category: "quick", cause: "category_unavailable" })
    // The dead chain's unconnected providers ride the refusal so the notice can name them.
    expect(dead.kind === "unavailable" ? dead.missingProviders : undefined).toContain("chatgpt-subscription")
    // A registry that still offers SOME usable model must not be adopted beyond the pinned category,
    // and the refusal still names the chain providers a /login would revive.
    const beyond = {
      getAvailable: () => [{ provider: "omo-mock", id: "frontier-1", contextWindow: 200_000, cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 } }],
      find: () => undefined,
    }
    const refused = resolveKibitzerSidecarModel({ config: { categories: {} }, registry: beyond })
    expect(refused).toMatchObject({ kind: "unavailable", category: "quick", cause: "beyond_category" })
    expect(refused.kind === "unavailable" ? refused.missingProviders : undefined).toContain("chatgpt-subscription")
  })

  test.each([
    { provider: "zai", ids: ["glm-5.3", "glm-5.3-flash"], expected: "zai/glm-5.3-flash" },
    { provider: "xiaomi", ids: ["mimo-v2.6-pro", "mimo-v2.6-flash"], expected: "xiaomi/mimo-v2.6-flash" },
  ])("#given only $provider is logged in and quick is not configured #when resolved #then recall runs on $expected", ({ provider, ids, expected }) => {
    const models: SenpiModelPort[] = ids.map((id) => ({ provider, id }))
    const single = {
      getAvailable: () => models,
      find: (p: string, id: string) => models.find((candidate) => candidate.provider === p && candidate.id === id),
    }

    const resolution = resolveKibitzerSidecarModel({ config: { categories: {} }, registry: single })

    expect(resolution).toMatchObject({ kind: "resolved", category: "quick", model: expected, thinking: "low" })
  })
})

// A catalog that knows every model below, and an availability list naming only the connected ones:
// `find` answers for an unconnected provider's model exactly like the live catalog does (#9216).
const CATALOG = ["openai/gpt-5.6-luna-fast", "apitopia/gpt-5.6-luna-fast", "anthropic/claude-haiku-4-5", "deepseek/deepseek-flash", "omo-mock/unrelated-1"]

function port(selector: string): SenpiModelPort {
  const slash = selector.indexOf("/")
  return { provider: selector.slice(0, slash), id: selector.slice(slash + 1) }
}

function connectedRegistry(connected: readonly string[]) {
  return {
    getAvailable: () => connected.map(port),
    find: (provider: string, modelId: string) => (CATALOG.includes(`${provider}/${modelId}`) ? port(`${provider}/${modelId}`) : undefined),
  }
}

const unconnectedPin: OmoConfig = { categories: { quick: { models: ["openai/gpt-5.6-luna-fast", "apitopia/gpt-5.6-luna-fast"] } } }

describe("resolveKibitzerSidecarModel connected-first ordering (#9216)", () => {
  test("#given an anthropic-only registry and a quick pin naming only unconnected providers #when resolved #then the connected builtin rung leads and the pins trail", () => {
    const resolution = resolveKibitzerSidecarModel({ config: unconnectedPin, registry: connectedRegistry(["anthropic/claude-haiku-4-5"]) })

    expect(resolution).toMatchObject({ kind: "resolved", category: "quick", model: "anthropic/claude-haiku-4-5", thinking: "off" })
    if (resolution.kind !== "resolved") throw new Error("unreachable")
    expect(resolution.chain.selectedModel).toBe("anthropic/claude-haiku-4-5")
    expect(resolution.fallbacks.map((candidate) => candidate.model)).toEqual(["openai/gpt-5.6-luna-fast", "apitopia/gpt-5.6-luna-fast"])
  })

  test("#given a pin whose later entry is connected and an earlier builtin rung also connected #when resolved #then the connected pin wins over the builtin chain", () => {
    const config: OmoConfig = { categories: { quick: { models: ["openai/gpt-5.6-luna-fast", "anthropic/claude-haiku-4-5"] } } }

    const resolution = resolveKibitzerSidecarModel({ config, registry: connectedRegistry(["deepseek/deepseek-flash", "anthropic/claude-haiku-4-5"]) })

    expect(resolution).toMatchObject({ kind: "resolved", model: "anthropic/claude-haiku-4-5" })
    if (resolution.kind !== "resolved") throw new Error("unreachable")
    const order = resolution.fallbacks.map((candidate) => candidate.model)
    // Connected rungs lead; the unconnected pin may stay reachable but only behind them.
    expect(order.indexOf("deepseek/deepseek-flash")).toBeLessThan(order.indexOf("openai/gpt-5.6-luna-fast"))
  })

  test("#given a known availability list with nothing the pin or the chain can use #when resolved #then the sidecar refuses as category_unavailable naming the providers to connect", () => {
    const resolution = resolveKibitzerSidecarModel({ config: unconnectedPin, registry: connectedRegistry(["omo-mock/unrelated-1"]) })

    expect(resolution).toMatchObject({ kind: "unavailable", category: "quick", cause: "category_unavailable" })
    const missing = resolution.kind === "unavailable" ? resolution.missingProviders ?? [] : []
    expect(missing.slice(0, 2)).toEqual(["openai", "apitopia"])
    expect(missing).toContain("chatgpt-subscription")
    expect(missing).toContain("anthropic")
  })

  test("#given the child starter on an anthropic-only registry with an unconnected pin #when a child starts #then its spec selects the connected rung", async () => {
    const specs: ChildSpec[] = []
    const start = createKibitzerSidecarChildStarter({
      cwd: "/workspace",
      sessionDir: "/state/recall/sidecars/cGFyZW50LTE",
      agentDir: "/home/agent",
      loadConfig: () => unconnectedPin,
      modelRegistry: () => connectedRegistry(["anthropic/claude-haiku-4-5"]) as unknown as ChildModelRegistry,
      loadPersona: () => "persona text",
      createRunner: () => ({ start: async (spec) => (specs.push(spec), {} as ChildHandle) }),
    })

    await start({ sessionId: "parent-1", generation: 1, prompt: "<kibitzer-seed/>", tools: [nudgeTool()], maxItems: 2 })

    expect(specs[0]?.selectedModel).toBe("anthropic/claude-haiku-4-5")
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

describe("kibitzerConfigurationFailure", () => {
  test("#given the starter's refusals #when classified #then only the category configuration states are configuration failures", () => {
    const deadChain = new KibitzerSidecarStartError("category_unavailable", "x", { category: "quick", missingProviders: ["chatgpt-subscription"] })
    expect(kibitzerConfigurationFailure(deadChain)).toEqual({ category: "quick", cause: "category_unavailable", missingProviders: ["chatgpt-subscription"] })
    const beyond = new KibitzerSidecarStartError("beyond_category", "x", { category: "quick", missingProviders: ["chatgpt-subscription"] })
    expect(kibitzerConfigurationFailure(beyond)).toEqual({ category: "quick", cause: "beyond_category", missingProviders: ["chatgpt-subscription"] })
    for (const transient of [
      new KibitzerSidecarStartError("registry_snapshot_unavailable", "x"),
      new KibitzerSidecarStartError("persona_unavailable", "x"),
      new KibitzerSidecarStartError("runtime_unavailable", "x"),
      new KibitzerSidecarStartError("session_create_failed", "x"),
      new Error("x"),
    ]) {
      expect(kibitzerConfigurationFailure(transient)).toBeUndefined()
    }
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

  test("#given the refusals the starter itself throws #when classified #then only the category refusals are configuration, and a missing registry snapshot stays transient although it names the category", async () => {
    const input = { sessionId: "parent-1", generation: 1, prompt: "<kibitzer-seed/>", tools: [nudgeTool()], maxItems: 2 }
    const failingRunner = () => ({ start: async (): Promise<ChildHandle> => { throw new Error("spawn failed") } })
    const refusal = (options: Partial<Parameters<typeof createKibitzerSidecarChildStarter>[0]>) =>
      createKibitzerSidecarChildStarter({ ...base, createRunner: failingRunner, ...options })(input).catch((error: unknown) => error)

    const dead = await refusal({ loadConfig: () => ({}), modelRegistry: () => ({ getAvailable: () => [], find: () => undefined }) as unknown as ChildModelRegistry })
    const noSnapshot = await refusal({ modelRegistry: () => undefined })
    const transient = [noSnapshot, await refusal({ loadPersona: () => { throw new Error("ENOENT") } }), await refusal({})]

    expect(kibitzerConfigurationFailure(dead)).toMatchObject({ category: "quick", cause: "category_unavailable" })
    // The starter attaches the category to every model refusal; the snapshot one must still retry as a failure.
    expect(noSnapshot).toMatchObject({ code: "registry_snapshot_unavailable", category: "quick" })
    expect(transient.map((error) => (error as KibitzerSidecarStartError).code)).toEqual(["registry_snapshot_unavailable", "persona_unavailable", "session_create_failed"])
    for (const error of transient) expect(kibitzerConfigurationFailure(error)).toBeUndefined()
  })

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

    const deadRegistry = { getAvailable: () => [], find: () => undefined }
    const deadChain = createKibitzerSidecarChildStarter({
      ...base,
      loadConfig: () => ({}),
      modelRegistry: () => deadRegistry as unknown as ChildModelRegistry,
      createRunner: runner,
    })
    const deadChainError = await deadChain(input).catch((error: unknown) => error)
    expect(deadChainError).toBeInstanceOf(KibitzerSidecarStartError)
    expect((deadChainError as KibitzerSidecarStartError).code).toBe("category_unavailable")
    expect((deadChainError as KibitzerSidecarStartError).category).toBe("quick")
    expect((deadChainError as KibitzerSidecarStartError).missingProviders).toContain("chatgpt-subscription")

    expect(starts).toBe(0)
  })
})
