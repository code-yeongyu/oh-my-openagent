import { describe, expect, test } from "bun:test"

import type { OmoConfig } from "@oh-my-opencode/omo-config-core"
import type { ChildHandle, ChildModelRegistry, ChildSpec, SenpiModelPort } from "@oh-my-opencode/senpi-task"

import {
  buildKibitzerSidecarSpec,
  createKibitzerSidecarChildStarter,
  KIBITZER_SIDECAR_DEFAULT_CATEGORY,
  KibitzerSidecarStartError,
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

    expect(resolution).toEqual({
      kind: "resolved",
      category: "quick",
      model: "omo-mock/mock-1",
      fallbacks: [],
      chain: { selectedModel: "omo-mock/mock-1" },
    })
  })

  test("#given no registry snapshot or a dead category #when resolved #then the sidecar refuses instead of drifting to another model", () => {
    expect(resolveKibitzerSidecarModel({ config, registry: undefined }))
      .toEqual({ kind: "unavailable", category: "quick", cause: "registry_snapshot_unavailable" })
    expect(resolveKibitzerSidecarModel({ config: { categories: {} }, registry: { getAvailable: () => [], find: () => undefined } }))
      .toEqual({ kind: "unavailable", category: "quick", cause: "category_unavailable" })
    // A registry that still offers SOME usable model must not be adopted beyond the pinned category.
    const beyond = {
      getAvailable: () => [{ provider: "omo-mock", id: "frontier-1", contextWindow: 200_000, cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 } }],
      find: () => undefined,
    }
    expect(resolveKibitzerSidecarModel({ config: { categories: {} }, registry: beyond }))
      .toEqual({ kind: "unavailable", category: "quick", cause: "beyond_category" })
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
})
