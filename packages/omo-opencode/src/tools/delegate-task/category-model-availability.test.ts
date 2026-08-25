import { afterEach, describe, expect, spyOn, test } from "bun:test"
import type { CategoryConfig } from "../../config/schema"
import * as connectedProvidersCache from "../../shared/connected-providers-cache"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import { resolveCategoryExecution } from "./category-resolver"
import type { ExecutorContext } from "./executor-types"
import type { DelegateTaskArgs } from "./types"

const CATEGORY_NAME = "verifier"
const MODEL_PROVIDER = "test-provider"

const args: DelegateTaskArgs = {
  category: CATEGORY_NAME,
  prompt: "Verify the configured category model chain.",
  description: "Category model availability regression",
  run_in_background: false,
  load_skills: [],
}

const cacheSpies: Array<{ mockRestore: () => void }> = []

afterEach(() => {
  for (const cacheSpy of cacheSpies.splice(0)) {
    cacheSpy.mockRestore()
  }
})

function createExecutorContext(
  category: CategoryConfig,
  availableModelIDs: string[],
): ExecutorContext {
  cacheSpies.push(
    spyOn(connectedProvidersCache, "readProviderModelsCache").mockReturnValue({
      models: { [MODEL_PROVIDER]: availableModelIDs },
      connected: [MODEL_PROVIDER],
      updatedAt: "2026-08-18T00:00:00.000Z",
    }),
  )
  cacheSpies.push(
    spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue([MODEL_PROVIDER]),
  )

  return {
    client: unsafeTestValue({}),
    manager: unsafeTestValue({}),
    directory: "/tmp/issue-6972",
    userCategories: { [CATEGORY_NAME]: category },
    sisyphusJuniorModel: undefined,
  }
}

describe("category canonical model availability", () => {
  test("advances past unavailable entries while preserving the configured order", async () => {
    // given
    const executorContext = createExecutorContext(
      {
        models: [
          `${MODEL_PROVIDER}/missing-primary`,
          `${MODEL_PROVIDER}/available-second`,
          `${MODEL_PROVIDER}/missing-middle`,
          `${MODEL_PROVIDER}/available-fourth`,
          `${MODEL_PROVIDER}/available-fifth`,
        ],
      },
      ["available-second", "available-fourth", "available-fifth"],
    )

    // when
    const result = await resolveCategoryExecution(args, executorContext, undefined, "system/default")

    // then
    expect(result.error).toBeUndefined()
    expect(result.actualModel).toBe(`${MODEL_PROVIDER}/available-second`)
    expect(result.fallbackChain).toEqual([
      { providers: [MODEL_PROVIDER], model: "available-fourth", variant: undefined },
      { providers: [MODEL_PROVIDER], model: "available-fifth", variant: undefined },
    ])
  })

  test("keeps a configured fuzzy near-miss by resolving it to the available model id", async () => {
    // given
    const executorContext = createExecutorContext(
      { models: [`${MODEL_PROVIDER}/model-5.4`] },
      ["model-5.4-preview"],
    )

    // when
    const result = await resolveCategoryExecution(args, executorContext, undefined, "system/default")

    // then
    expect(result.error).toBeUndefined()
    expect(result.actualModel).toBe(`${MODEL_PROVIDER}/model-5.4-preview`)
    expect(result.categoryModel).toMatchObject({
      providerID: MODEL_PROVIDER,
      modelID: "model-5.4-preview",
    })
  })

  test("preserves model-entry settings when availability resolution promotes a fallback", async () => {
    // given
    const executorContext = createExecutorContext(
      {
        models: [
          `${MODEL_PROVIDER}/missing-primary`,
          {
            model: `${MODEL_PROVIDER}/available-second`,
            reasoning: "high",
            temperature: 0.3,
          },
        ],
      },
      ["available-second"],
    )

    // when
    const result = await resolveCategoryExecution(args, executorContext, undefined, "system/default")

    // then
    expect(result.error).toBeUndefined()
    expect(result.actualModel).toBe(`${MODEL_PROVIDER}/available-second`)
    expect(result.categoryModel).toMatchObject({
      providerID: MODEL_PROVIDER,
      modelID: "available-second",
      reasoning: "high",
      temperature: 0.3,
    })
  })

  test("errors with the configured chain when every entry is unavailable", async () => {
    // given
    const configuredModels = [
      `${MODEL_PROVIDER}/missing-primary`,
      `${MODEL_PROVIDER}/missing-fallback`,
    ]
    const executorContext = createExecutorContext({ models: configuredModels }, ["unrelated-model"])

    // when
    const result = await resolveCategoryExecution(args, executorContext, undefined, "system/default")

    // then
    expect(result.error).toContain("Configured model chain is unavailable")
    expect(result.error).toContain(configuredModels.join(" -> "))
    expect(result.actualModel).toBeUndefined()
    expect(result.categoryModel).toBeUndefined()
  })
})
