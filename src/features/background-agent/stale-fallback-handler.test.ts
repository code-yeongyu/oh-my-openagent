import { describe, it, expect, mock } from "bun:test"

import { resolveNextFallbackModel, buildFallbackLaunchInput, createStaleFallbackHandler } from "./stale-fallback-handler"
import type { BackgroundTask, LaunchInput } from "./types"
import type { OhMyOpenCodeConfig } from "../../config"

function createTask(overrides: Partial<BackgroundTask> = {}): BackgroundTask {
  return {
    id: "task-1",
    sessionID: "ses-1",
    parentSessionID: "parent-ses-1",
    parentMessageID: "msg-1",
    description: "test task",
    prompt: "test prompt",
    agent: "explore",
    status: "cancelled",
    startedAt: new Date(),
    model: { providerID: "kimi", modelID: "kimi-k2.5-free" },
    ...overrides,
  }
}

function createConfig(overrides: Partial<OhMyOpenCodeConfig> = {}): OhMyOpenCodeConfig {
  return {
    agents: {
      explore: {
        fallback_models: ["kimi/kimi-k2.5-free", "glm/glm-4-flash-250414"],
      },
    },
    ...overrides,
  } as unknown as OhMyOpenCodeConfig
}

describe("resolveNextFallbackModel", () => {
  it("should use task.fallbackModels when present", () => {
    //#given
    const task = createTask({
      fallbackModels: ["openai/gpt-4o", "anthropic/claude-sonnet-4-20250514"],
    })
    const config = createConfig()

    //#when
    const result = resolveNextFallbackModel(task, config)

    //#then
    expect(result).toEqual({
      nextModel: "openai/gpt-4o",
      remainingModels: ["anthropic/claude-sonnet-4-20250514"],
    })
  })

  it("should resolve from agent config when task.fallbackModels is empty", () => {
    //#given
    const task = createTask({
      agent: "explore",
      model: { providerID: "kimi", modelID: "kimi-k2.5-free" },
      fallbackModels: undefined,
    })
    const config = createConfig()

    //#when
    const result = resolveNextFallbackModel(task, config)

    //#then
    expect(result).toEqual({
      nextModel: "glm/glm-4-flash-250414",
      remainingModels: [],
    })
  })

  it("should resolve from category config when agent has no fallback_models", () => {
    //#given
    const task = createTask({
      agent: "unknown-agent",
      category: "quick",
      model: { providerID: "kimi", modelID: "kimi-k2.5-free" },
      fallbackModels: undefined,
    })
    const config = {
      agents: {},
      categories: {
        quick: {
          fallback_models: ["kimi/kimi-k2.5-free", "openai/gpt-4o-mini"],
        },
      },
    } as unknown as OhMyOpenCodeConfig

    //#when
    const result = resolveNextFallbackModel(task, config)

    //#then
    expect(result).toEqual({
      nextModel: "openai/gpt-4o-mini",
      remainingModels: [],
    })
  })

  it("should return undefined when no fallback models available", () => {
    //#given
    const task = createTask({
      agent: "unknown-agent",
      fallbackModels: undefined,
    })
    const config = { agents: {} } as unknown as OhMyOpenCodeConfig

    //#when
    const result = resolveNextFallbackModel(task, config)

    //#then
    expect(result).toBeUndefined()
  })

  it("should return undefined when current model is the last in the chain", () => {
    //#given
    const task = createTask({
      agent: "explore",
      model: { providerID: "glm", modelID: "glm-4-flash-250414" },
      fallbackModels: undefined,
    })
    const config = createConfig()

    //#when
    const result = resolveNextFallbackModel(task, config)

    //#then
    expect(result).toBeUndefined()
  })
})

describe("buildFallbackLaunchInput", () => {
  it("should build a valid LaunchInput with the new model", () => {
    //#given
    const task = createTask({
      parentModel: { providerID: "anthropic", modelID: "claude-opus-4-6" },
      parentAgent: "sisyphus",
      isUnstableAgent: true,
      category: "quick",
    })

    //#when
    const result = buildFallbackLaunchInput(task, "openai/gpt-4o", ["anthropic/claude-sonnet-4-20250514"])

    //#then
    expect(result).toEqual({
      description: "test task",
      prompt: "test prompt",
      agent: "explore",
      parentSessionID: "parent-ses-1",
      parentMessageID: "msg-1",
      parentModel: { providerID: "anthropic", modelID: "claude-opus-4-6" },
      parentAgent: "sisyphus",
      parentTools: undefined,
      model: { providerID: "openai", modelID: "gpt-4o" },
      isUnstableAgent: true,
      category: "quick",
      fallbackModels: ["anthropic/claude-sonnet-4-20250514"],
    })
  })

  it("should return undefined for invalid model format", () => {
    //#given
    const task = createTask()

    //#when
    const result = buildFallbackLaunchInput(task, "no-slash-model", [])

    //#then
    expect(result).toBeUndefined()
  })

  it("should handle model IDs with multiple slashes", () => {
    //#given
    const task = createTask()

    //#when
    const result = buildFallbackLaunchInput(task, "anthropic/claude-sonnet-4-20250514/latest", [])

    //#then
    expect(result?.model).toEqual({
      providerID: "anthropic",
      modelID: "claude-sonnet-4-20250514/latest",
    })
  })
})

describe("createStaleFallbackHandler", () => {
  it("should launch a new task with the next fallback model", async () => {
    //#given
    const mockLaunch = mock(() =>
      Promise.resolve(createTask({ id: "task-2", status: "pending" })),
    )
    const config = createConfig()
    const task = createTask({
      fallbackModels: ["openai/gpt-4o"],
    })
    const handler = createStaleFallbackHandler(config, mockLaunch)

    //#when
    await handler(task)

    //#then
    expect(mockLaunch).toHaveBeenCalledTimes(1)
    const launchInput = mockLaunch.mock.calls[0][0] as LaunchInput
    expect(launchInput.model).toEqual({ providerID: "openai", modelID: "gpt-4o" })
    expect(launchInput.fallbackModels).toEqual([])
  })

  it("should not launch when no fallback models are available", async () => {
    //#given
    const mockLaunch = mock(() => Promise.resolve(createTask()))
    const config = { agents: {} } as unknown as OhMyOpenCodeConfig
    const task = createTask({
      agent: "unknown",
      fallbackModels: undefined,
    })
    const handler = createStaleFallbackHandler(config, mockLaunch)

    //#when
    await handler(task)

    //#then
    expect(mockLaunch).not.toHaveBeenCalled()
  })

  it("should not throw when launch fails", async () => {
    //#given
    const mockLaunch = mock(() => Promise.reject(new Error("launch failed")))
    const config = createConfig()
    const task = createTask({
      fallbackModels: ["openai/gpt-4o"],
    })
    const handler = createStaleFallbackHandler(config, mockLaunch)

    //#when + then (should not throw)
    await handler(task)
    expect(mockLaunch).toHaveBeenCalledTimes(1)
  })
})
