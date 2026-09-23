import { afterEach, describe, expect, spyOn, test } from "bun:test"

import * as connectedProvidersCache from "../../shared/connected-providers-cache"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import { resolveCategoryConfig } from "./categories"
import { resolveCategoryExecution } from "./category-resolver"
import type { ExecutorContext } from "./executor-types"
import type { DelegateTaskArgs } from "./types"

// writing's chain holds only Claude models. With none of them reachable the lane is unavailable: it
// never falls back to the session or system default, which would run writing work on another family.

const SYSTEM_DEFAULT_MODEL = "openai/gpt-6-sol"
const GPT_ONLY = new Set<string>(["openai/gpt-6-sol", "openai/gpt-5.6-sol", "openai/gpt-6-astra"])

const cacheSpies: Array<{ mockRestore: () => void }> = []

afterEach(() => {
  for (const cacheSpy of cacheSpies.splice(0)) cacheSpy.mockRestore()
})

function stubProviderCache(models: Record<string, string[]>): void {
  cacheSpies.push(
    spyOn(connectedProvidersCache, "readProviderModelsCache").mockReturnValue({
      models,
      connected: Object.keys(models),
      updatedAt: "2026-09-23T00:00:00.000Z",
    }),
  )
  cacheSpies.push(spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue(Object.keys(models)))
}

function executorContext(userCategories: ExecutorContext["userCategories"] = undefined): ExecutorContext {
  return {
    client: unsafeTestValue({}),
    manager: unsafeTestValue({}),
    directory: "/tmp/writing-availability",
    userCategories,
    sisyphusJuniorModel: undefined,
  }
}

const args: DelegateTaskArgs = {
  category: "writing",
  prompt: "Draft the release notes.",
  description: "writing availability",
  run_in_background: false,
  load_skills: [],
}

describe("writing category availability", () => {
  test("#given only GPT models #when writing config resolves #then the lane is unavailable", () => {
    stubProviderCache({ openai: ["gpt-6-sol", "gpt-5.6-sol", "gpt-6-astra"] })

    expect(resolveCategoryConfig("writing", { systemDefaultModel: SYSTEM_DEFAULT_MODEL, availableModels: GPT_ONLY })).toBeNull()
  })

  test("#given only GPT models #when writing is spawned #then it errors instead of running on the system default", async () => {
    stubProviderCache({ openai: ["gpt-6-sol", "gpt-5.6-sol", "gpt-6-astra"] })

    const result = await resolveCategoryExecution(args, executorContext(), undefined, SYSTEM_DEFAULT_MODEL)

    expect(result.actualModel).toBeUndefined()
    expect(result.error).toContain('Category "writing" has no available model')
    expect(result.error).toContain("claude-fable-5-1")
    expect(result.error).not.toContain(SYSTEM_DEFAULT_MODEL)
  })

  test("#given only the third Claude rung #when writing is spawned #then it runs on that rung", async () => {
    stubProviderCache({ anthropic: ["claude-opus-4-6"], openai: ["gpt-6-sol"] })

    const result = await resolveCategoryExecution(args, executorContext(), undefined, SYSTEM_DEFAULT_MODEL)

    expect(result.error).toBeUndefined()
    expect(result.actualModel).toBe("anthropic/claude-opus-4-6")
  })

  test("#given Copilot's dotted Fable id #when writing config resolves #then the lane stays open", () => {
    stubProviderCache({ "github-copilot": ["claude-fable-5.1"] })

    expect(resolveCategoryConfig("writing", { availableModels: new Set(["github-copilot/claude-fable-5.1"]) })).not.toBeNull()
  })

  test("#given an explicit omo.json writing model #when only GPT is available #then the user choice opens the lane", async () => {
    stubProviderCache({ openai: ["gpt-6-sol"] })

    const result = await resolveCategoryExecution(
      args,
      executorContext({ writing: { model: "openai/gpt-6-sol" } }),
      undefined,
      SYSTEM_DEFAULT_MODEL,
    )

    expect(result.error).toBeUndefined()
    expect(result.actualModel).toBe("openai/gpt-6-sol")
  })
})
