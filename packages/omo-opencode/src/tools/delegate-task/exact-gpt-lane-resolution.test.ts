import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { resolveCategoryExecution } from "./category-resolver"
import type { ExecutorContext } from "./executor-types"
import * as connectedProvidersCache from "../../shared/connected-providers-cache"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"

// #14155: ultrabrain and deep-high run gpt-6.2-astra and deep-low runs gpt-6.2-sol, exactly. These drive
// the real delegate path (gate, then delegate-core resolution), which matches ids by substring.
const SYSTEM_DEFAULT = "anthropic/claude-sonnet-5"

const LANES = [
  { category: "ultrabrain", model: "gpt-6.2-astra", variant: "max" },
  { category: "deep-high", model: "gpt-6.2-astra", variant: "high" },
  { category: "deep-low", model: "gpt-6.2-sol", variant: "medium" },
] as const

const spies: Array<{ mockRestore(): void }> = []

function stubRegistry(models: Record<string, string[]>): void {
  const connected = Object.keys(models)
  spies.push(
    spyOn(connectedProvidersCache, "readProviderModelsCache").mockReturnValue({
      models,
      connected,
      updatedAt: "2026-11-20T00:00:00.000Z",
    }),
    spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue(connected),
    spyOn(connectedProvidersCache, "hasConnectedProvidersCache").mockReturnValue(true),
    spyOn(connectedProvidersCache, "hasProviderModelsCache").mockReturnValue(true),
  )
}

function context(
  userCategories: ExecutorContext["userCategories"] = {},
  sisyphusJuniorModel?: string,
): ExecutorContext {
  return {
    client: unsafeTestValue({}),
    manager: unsafeTestValue({}),
    directory: "/tmp/test",
    userCategories,
    sisyphusJuniorModel,
  }
}

function delegate(category: string, executorContext: ExecutorContext) {
  return resolveCategoryExecution(
    {
      category,
      prompt: "probe",
      description: "probe",
      run_in_background: false,
      load_skills: [],
      blockedBy: undefined,
      enableSkillTools: false,
    },
    executorContext,
    undefined,
    SYSTEM_DEFAULT,
  )
}

afterEach(() => {
  for (const spy of spies.splice(0)) spy.mockRestore()
})

describe("exact GPT-6.2 lanes on the OpenCode delegate path (#14155)", () => {
  for (const lane of LANES) {
    test(`${lane.category} skips the preferred provider's Fast tier for the exact id on a lower-priority provider`, async () => {
      stubRegistry({ openai: [`${lane.model}-fast`], "chatgpt-subscription": [lane.model] })

      const result = await delegate(lane.category, context())

      expect(result.error).toBeUndefined()
      expect(result.actualModel).toBe(`chatgpt-subscription/${lane.model}`)
      expect(result.categoryModel?.variant).toBe(lane.variant)
    })

    test(`${lane.category} takes the preferred provider when it serves the exact id`, async () => {
      stubRegistry({ openai: [lane.model, `${lane.model}-fast`], "chatgpt-subscription": [lane.model] })

      const result = await delegate(lane.category, context())

      expect(result.actualModel).toBe(`openai/${lane.model}`)
      expect(result.categoryModel?.variant).toBe(lane.variant)
    })

    test(`${lane.category} is unavailable on a Fast-only registry instead of resolving Fast or the system default`, async () => {
      stubRegistry({ openai: [`${lane.model}-fast`], "chatgpt-subscription": [`${lane.model}-fast`] })

      const result = await delegate(lane.category, context())

      expect(result.actualModel).toBeUndefined()
      expect(result.error).toContain(`requires model "${lane.model}"`)
    })

    test(`${lane.category} is unavailable on a registry holding only older GPT models`, async () => {
      stubRegistry({
        openai: ["gpt-6-astra", "gpt-6.1-sol", "gpt-6.1-sol-fast", "gpt-5.6-sol"],
        "github-copilot": ["gpt-6-astra", "gpt-5.6-sol"],
      })

      const result = await delegate(lane.category, context())

      expect(result.actualModel).toBeUndefined()
      expect(result.error).toContain(`requires model "${lane.model}"`)
    })

    test(`${lane.category} without its exact model stays unavailable when the user sets only a variant`, async () => {
      stubRegistry({ openai: [`${lane.model}-fast`, "gpt-6-astra"] })

      const result = await delegate(lane.category, context({ [lane.category]: { variant: "low" } }))

      expect(result.actualModel).toBeUndefined()
      expect(result.error).toContain(`requires model "${lane.model}"`)
    })

    test(`${lane.category} honors an explicit user model, older or Fast, on any registry`, async () => {
      stubRegistry({ openai: ["gpt-6-astra", `${lane.model}-fast`] })

      const older = await delegate(lane.category, context({ [lane.category]: { model: "openai/gpt-6-astra" } }))
      const fast = await delegate(lane.category, context({ [lane.category]: { model: `openai/${lane.model}-fast` } }))

      expect(older.actualModel).toBe("openai/gpt-6-astra")
      expect(older.modelInfo?.type).toBe("user-defined")
      expect(fast.actualModel).toBe(`openai/${lane.model}-fast`)
    })

    test(`${lane.category} honors the sisyphus-junior model override even without its exact model`, async () => {
      stubRegistry({ openai: [`${lane.model}-fast`], anthropic: ["claude-opus-5-5"] })

      const result = await delegate(lane.category, context({}, "anthropic/claude-opus-5-5"))

      expect(result.actualModel).toBe("anthropic/claude-opus-5-5")
      expect(result.modelInfo?.type).toBe("user-defined")
    })
  }
})
