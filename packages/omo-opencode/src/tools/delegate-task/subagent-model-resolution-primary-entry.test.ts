import { afterEach, describe, expect, spyOn, test } from "bun:test"

import * as connectedProvidersCache from "../../shared/connected-providers-cache"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import type { ExecutorContext } from "./executor-types"
import type { AgentInfo } from "./subagent-discovery"
import { resolveSubagentModel } from "./subagent-model-resolution"

// The first `models[]` entry is the primary and, when it is an object, it carries the whole
// per-model contract. Resolution must keep every setting instead of extracting only `model`.

const cacheSpies: Array<{ mockRestore: () => void }> = []

afterEach(() => {
  for (const cacheSpy of cacheSpies.splice(0)) cacheSpy.mockRestore()
})

function stubProviderCache(models: Record<string, string[]>): void {
  cacheSpies.push(
    spyOn(connectedProvidersCache, "readProviderModelsCache").mockReturnValue({
      models,
      connected: Object.keys(models),
      updatedAt: "2026-11-02T00:00:00.000Z",
    }),
  )
  cacheSpies.push(spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue(Object.keys(models)))
}

function executorContext(overrides?: Partial<ExecutorContext>): ExecutorContext {
  return {
    client: unsafeTestValue({}),
    manager: unsafeTestValue({}),
    directory: "/tmp/subagent-model-resolution-primary-entry",
    ...overrides,
  }
}

const matchedExploreAgent: AgentInfo = {
  name: "explore",
  mode: "subagent",
  model: "openai/gpt-5.4-preview",
}

describe("resolveSubagentModel primary models[] entry", () => {
  test("#given an object primary model with mixed string and object fallbacks #when the primary is available #then every entry setting survives resolution", async () => {
    //#given
    stubProviderCache({
      openai: ["gpt-5.4"],
      opencode: ["qwen3.7-plus"],
      anthropic: ["claude-haiku-4-5"],
    })
    const executorCtx = executorContext({
      agentOverrides: {
        explore: {
          models: [
            {
              model: "openai/gpt-5.4",
              variant: "xhigh",
              reasoning: "high",
              reasoningEffort: "high",
              temperature: 0.1,
              top_p: 0.9,
              maxTokens: 4096,
              thinking: { type: "enabled", budgetTokens: 2048 },
            },
            "opencode/qwen3.7-plus",
            { model: "anthropic/claude-haiku-4-5", temperature: 0.3 },
          ],
        },
      },
    })

    //#when
    const result = await resolveSubagentModel("explore", matchedExploreAgent, executorCtx)

    //#then
    expect(result.categoryModel).toEqual({
      providerID: "openai",
      modelID: "gpt-5.4",
      variant: "xhigh",
      reasoning: "high",
      reasoningEffort: "high",
      temperature: 0.1,
      top_p: 0.9,
      maxTokens: 4096,
      thinking: { type: "enabled", budgetTokens: 2048 },
    })
  })

  test("#given an unavailable object primary with mixed fallbacks #when a string fallback is reachable #then the fallback keeps its own settings", async () => {
    //#given
    stubProviderCache({
      openai: ["gpt-5.4"],
      anthropic: ["claude-haiku-4-5"],
    })
    const executorCtx = executorContext({
      agentOverrides: {
        explore: {
          models: [
            { model: "quotio/claude-haiku-4-5-unavailable", temperature: 0.1, maxTokens: 4096 },
            "openai/gpt-5.4",
            { model: "anthropic/claude-haiku-4-5", temperature: 0.3 },
          ],
        },
      },
    })

    //#when
    const result = await resolveSubagentModel("explore", matchedExploreAgent, executorCtx)

    //#then the promoted fallback does not inherit the primary entry's settings
    expect(result.categoryModel).toEqual({
      providerID: "openai",
      modelID: "gpt-5.4",
    })
  })

  test("#given a mixed object fallback is promoted #when it carries settings #then those settings reach the resolved config", async () => {
    //#given
    stubProviderCache({
      openai: ["gpt-5.4"],
      anthropic: ["claude-haiku-4-5"],
    })
    const executorCtx = executorContext({
      agentOverrides: {
        explore: {
          models: [
            { model: "quotio/claude-haiku-4-5-unavailable", temperature: 0.1 },
            "openai/gpt-9.9-unavailable",
            {
              model: "anthropic/claude-haiku-4-5",
              reasoning: "max",
              temperature: 0.3,
              top_p: 0.5,
              maxTokens: 512,
              thinking: { type: "disabled" },
            },
          ],
        },
      },
    })

    //#when
    const result = await resolveSubagentModel("explore", matchedExploreAgent, executorCtx)

    //#then
    expect(result.categoryModel).toEqual({
      providerID: "anthropic",
      modelID: "claude-haiku-4-5",
      reasoning: "max",
      temperature: 0.3,
      top_p: 0.5,
      maxTokens: 512,
      thinking: { type: "disabled" },
    })
  })

  test("#given the agent variant and an object primary variant are both set #when the primary is resolved #then the agent-level variant override wins", async () => {
    //#given the agent override asks for low and the models[0] entry asks for xhigh
    stubProviderCache({
      openai: ["gpt-5.4"],
    })
    const executorCtx = executorContext({
      agentOverrides: {
        explore: {
          variant: "low",
          models: [{ model: "openai/gpt-5.4", variant: "xhigh" }],
        },
      },
    })

    //#when
    const result = await resolveSubagentModel("explore", matchedExploreAgent, executorCtx)

    //#then the fallback-entry pass applies the agent-level variant last, as its name says
    expect(result.categoryModel).toMatchObject({
      providerID: "openai",
      modelID: "gpt-5.4",
      variant: "low",
    })
  })
})
