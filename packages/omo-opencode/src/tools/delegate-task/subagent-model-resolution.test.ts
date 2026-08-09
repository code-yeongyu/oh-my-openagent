import { afterEach, describe, expect, spyOn, test } from "bun:test"
import * as connectedProvidersCache from "../../shared/connected-providers-cache"
import { resolveSubagentModel } from "./subagent-model-resolution"
import type { ExecutorContext } from "./executor-types"

describe("resolveSubagentModel canonical primary settings", () => {
  let providerModelsSpy: ReturnType<typeof spyOn> | undefined

  afterEach(() => {
    providerModelsSpy?.mockRestore()
  })

  test("preserves a named agent primary rung's request settings", async () => {
    providerModelsSpy = spyOn(connectedProvidersCache, "readProviderModelsCache").mockReturnValue({
      models: { openai: ["gpt-5.6-sol", "gpt-5.4"] },
      connected: ["openai"],
      updatedAt: "2026-08-09T00:00:00.000Z",
    })
    const executorCtx = {
      client: {},
      manager: {},
      directory: "/tmp/test",
      agentOverrides: {
        explore: {
          reasoning: "low",
          models: [
            {
              model: "openai/gpt-5.6-sol",
              reasoning: "high",
              temperature: 0.2,
              max_tokens: 1024,
              provider_options: { serviceTier: "priority" },
            },
            "openai/gpt-5.4",
          ],
        },
      },
    } as ExecutorContext

    const result = await resolveSubagentModel(
      "explore",
      { name: "explore", mode: "subagent", model: "openai/gpt-5.6-sol" },
      executorCtx,
    )

    expect(result.categoryModel).toEqual({
      providerID: "openai",
      modelID: "gpt-5.6-sol",
      reasoning: "high",
      temperature: 0.2,
      maxTokens: 1024,
      providerOptions: { serviceTier: "priority" },
    })
  })
})
