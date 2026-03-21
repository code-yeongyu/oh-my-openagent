declare const require: (name: string) => any
const { describe, test, expect, beforeEach, afterEach, spyOn, mock } = require("bun:test")

import { resolveModelForDelegateTask } from "./model-selection"
import { resolveSubagentExecution } from "./subagent-resolver"
import { resolveCategoryExecution } from "./category-resolver"
import * as connectedProvidersCache from "../../shared/connected-providers-cache"

const AVAILABLE_MODELS = new Set([
  "anthropic/claude-opus-4-6",
  "anthropic/claude-sonnet-4-6",
  "google/gemini-3-pro",
  "openai/gpt-5.3-codex",
])

describe("delegate-task model inheritance", () => {
  let cacheSpy: ReturnType<typeof spyOn>
  let providerModelsSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    mock.restore()
    cacheSpy = spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue(["anthropic", "google", "openai"])
    providerModelsSpy = spyOn(connectedProvidersCache, "readProviderModelsCache").mockReturnValue({
      models: {
        anthropic: ["claude-opus-4-6", "claude-sonnet-4-6"],
        google: ["gemini-3-pro"],
        openai: ["gpt-5.3-codex"],
      },
      connected: ["anthropic", "google", "openai"],
      updatedAt: "2026-01-01T00:00:00.000Z",
    })
  })

  afterEach(() => {
    cacheSpy.mockRestore()
    providerModelsSpy.mockRestore()
  })

  test("uses inherited model before built-in default when no explicit model exists", () => {
    const result = resolveModelForDelegateTask({
      inheritedModel: "anthropic/claude-opus-4-6",
      categoryDefaultModel: "google/gemini-3-pro",
      availableModels: AVAILABLE_MODELS,
      systemDefaultModel: "anthropic/claude-sonnet-4-6",
    })

    expect(result).toEqual({ model: "anthropic/claude-opus-4-6" })
  })

  test("keeps explicit subagent model instead of inherited model", async () => {
    const client = {
      app: {
        agents: async () => ({
          data: [
            {
              name: "oracle",
              mode: "subagent",
              model: { providerID: "google", modelID: "gemini-3-pro" },
            },
          ],
        }),
      },
    }

    const result = await resolveSubagentExecution(
      {
        description: "Use oracle",
        prompt: "Inspect architecture",
        subagent_type: "oracle",
        run_in_background: false,
        load_skills: [],
      },
      {
        manager: {} as never,
        client: client as never,
        directory: "/tmp",
        agentOverrides: {
          oracle: { model: "openai/gpt-5.3-codex" },
        },
      },
      "sisyphus",
      "quick, deep",
      "anthropic/claude-opus-4-6",
    )

    expect(result.categoryModel).toEqual({ providerID: "openai", modelID: "gpt-5.3-codex" })
  })

  test("uses inherited model for subagent when no explicit override exists", async () => {
    const client = {
      app: {
        agents: async () => ({
          data: [
            {
              name: "oracle",
              mode: "subagent",
              model: { providerID: "google", modelID: "gemini-3-pro" },
            },
          ],
        }),
      },
    }

    const result = await resolveSubagentExecution(
      {
        description: "Use oracle",
        prompt: "Inspect architecture",
        subagent_type: "oracle",
        run_in_background: false,
        load_skills: [],
      },
      {
        manager: {} as never,
        client: client as never,
        directory: "/tmp",
      },
      "sisyphus",
      "quick, deep",
      "anthropic/claude-opus-4-6",
    )

    expect(result.categoryModel).toEqual({ providerID: "anthropic", modelID: "claude-opus-4-6" })
  })

  test("marks inherited unstable subagent models for supervised execution", async () => {
    const client = {
      app: {
        agents: async () => ({
          data: [
            {
              name: "oracle",
              mode: "subagent",
              model: { providerID: "openai", modelID: "gpt-5.4" },
            },
          ],
        }),
      },
    }

    const result = await resolveSubagentExecution(
      {
        description: "Use oracle",
        prompt: "Inspect architecture",
        subagent_type: "oracle",
        run_in_background: false,
        load_skills: [],
      },
      {
        manager: {} as never,
        client: client as never,
        directory: "/tmp",
      },
      "sisyphus",
      "quick, deep",
      "google/gemini-3-pro",
    )

    expect(result.actualModel).toBe("google/gemini-3-pro")
    expect(result.isUnstableAgent).toBe(true)
  })

  test("uses inherited model for category when user did not configure one", async () => {
    const result = await resolveCategoryExecution(
      {
        description: "Do it fast",
        prompt: "Fix a typo",
        category: "quick",
        run_in_background: false,
        load_skills: [],
      },
      {
        manager: {} as never,
        client: {} as never,
        directory: "/tmp",
      },
      "anthropic/claude-opus-4-6",
      "anthropic/claude-sonnet-4-6",
    )

    expect(result.categoryModel).toEqual({ providerID: "anthropic", modelID: "claude-opus-4-6" })
    expect(result.modelInfo?.type).toBe("inherited")
  })
})
