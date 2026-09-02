import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import * as connectedProvidersCache from "../../shared/connected-providers-cache"
import type { ExecutorContext } from "./executor-types"
import { resolveCategoryExecution } from "./category-resolver"

describe("resolveCategoryExecution disabled providers", () => {
  const providerModelsSpy = spyOn(connectedProvidersCache, "readProviderModelsCache").mockReturnValue({
    models: {
      opencode: ["claude-opus-5"],
      openai: ["gpt-5.6-sol"],
    },
    connected: ["opencode", "openai"],
    updatedAt: "2026-09-02T00:00:00.000Z",
  })
  const hasProviderModelsSpy = spyOn(connectedProvidersCache, "hasProviderModelsCache").mockReturnValue(true)
  const hasConnectedProvidersSpy = spyOn(connectedProvidersCache, "hasConnectedProvidersCache").mockReturnValue(true)

  afterEach(() => {
    providerModelsSpy.mockRestore()
    hasProviderModelsSpy.mockRestore()
    hasConnectedProvidersSpy.mockRestore()
  })

  test("selects the next static fallback when a mirrored provider is disabled", async () => {
    // given
    const executorCtx = {
      client: unsafeTestValue<ExecutorContext["client"]>({}),
      manager: unsafeTestValue<ExecutorContext["manager"]>({}),
      directory: "/tmp/test",
      userCategories: {},
      disabledProviders: ["anthropic"] as const,
    }
    const args = {
      category: "visual-engineering",
      prompt: "Build the page",
      description: "Visual task",
      run_in_background: false,
      load_skills: [],
      blockedBy: undefined,
      enableSkillTools: false,
    }

    // when
    const result = await resolveCategoryExecution(args, executorCtx, undefined, undefined)

    // then
    expect(result.actualModel).toBe("openai/gpt-5.6-sol")
    expect(result.categoryModel).toMatchObject({
      providerID: "openai",
      modelID: "gpt-5.6-sol",
      variant: "medium",
    })
  })
})
