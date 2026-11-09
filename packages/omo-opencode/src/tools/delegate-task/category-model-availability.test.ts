import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { validatePluginConfig } from "../../config/validate"
import { loadOmoConfig, resolveModelReferences } from "@oh-my-opencode/omo-config-core"
import { mapOmoConfigAgents } from "@oh-my-opencode/senpi-task"
import { createTaskChildPlanner } from "../../../../omo-senpi/src/components/task/planner"
import type { CategoryConfig } from "../../config/schema"
import * as connectedProvidersCache from "../../shared/connected-providers-cache"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import { resolveCategoryExecution } from "./category-resolver"
import { resolveSubagentModel } from "./subagent-model-resolution"
import {
  clearAllDelegatedChildSessionBootstrap,
  registerDelegatedChildSessionBootstrap,
} from "../../shared/delegated-child-session-bootstrap"
import { getFallbackModelsForSession, getRawFallbackModels } from "../../hooks/runtime-fallback/fallback-models"
import { createFallbackState, prepareFallback } from "../../hooks/runtime-fallback/fallback-state"
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
  clearAllDelegatedChildSessionBootstrap()
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
  for (const runtime of ["opencode", "senpi"] as const) {
    for (const [target, catalog] of [
      ["agent", false], ["agent", true], ["category", false], ["category", true],
    ] as const) {
      test(`real ${runtime} ${catalog ? "catalog" : "literal"} config preserves ${target} distribution through materialization`, async () => {
        const home = mkdtempSync(join(tmpdir(), "distribution-config-"))
        try {
          mkdirSync(join(home, ".omo"))
          mkdirSync(join(home, "project"))
          const name = `loaded-${runtime}-${target}-${catalog}`
          const definition = {
            models: catalog ? ["first", "second", "third"]
              : ["test-provider/a", { model: "test-provider/b", reasoning: "high" }, "test-provider/c"],
            models_distribution: "round_robin",
          }
          writeFileSync(join(home, ".omo", "omo.json"), JSON.stringify({
            ...(catalog ? { models: {
              first: { model: "test-provider/a" },
              second: { model: "test-provider/b", reasoning: "high" },
              third: { model: "test-provider/c" },
            } } : {}),
            [target === "agent" ? "agents" : "categories"]: { [name]: definition },
          }))
          const env = { HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: join(home, ".config") }
          const context = createExecutorContext({}, ["a", "b", "c"])
          const actual: string[] = []
          if (runtime === "opencode") {
            const loaded = validatePluginConfig(join(home, "project"), env)
            expect(loaded.valid).toBe(true)
            context.agentOverrides = loaded.config.agents
            context.userCategories = loaded.config.categories
            for (let i = 0; i < 4; i++) {
              if (target === "agent") {
                const result = await resolveSubagentModel(name, { name, mode: "subagent" }, context)
                actual.push(result.categoryModel?.modelID ?? "missing")
              } else {
                const result = await resolveCategoryExecution({ ...args, category: name }, context, undefined, undefined)
                actual.push(result.categoryModel?.modelID ?? "missing")
              }
            }
          } else {
            const loaded = loadOmoConfig({ cwd: join(home, "project"), env, harness: "senpi" })
            const config = resolveModelReferences(loaded.config).view
            const models = ["a", "b", "c"].map((id) => ({ provider: "test-provider", id }))
            const planner = createTaskChildPlanner(config, mapOmoConfigAgents(config), () => ({
              getAvailable: () => models,
              find: (provider, id) => models.find((model) => model.provider === provider && model.id === id),
            }))
            for (let i = 0; i < 4; i++) {
              const result = planner({
                prompt: "fixture", parent_session_id: "parent", depth: 0,
                ...(target === "agent" ? { subagent_type: name } : { category: name }),
              })
              if (result.kind !== "resolved") throw new Error(JSON.stringify(result))
              actual.push(result.plan.resolved_model?.model_id ?? "missing")
            }
          }
          expect(actual).toEqual(["a", "b", "c", "a"])
        } finally {
          rmSync(home, { recursive: true, force: true })
        }
      })
    }
  }

  test("reactive fallback consumes the spawn snapshot and exhausts without wrapping twice", async () => {
    const category = {
      models: [
        "test-provider/a", "test-provider/b",
        { model: "test-provider/c", reasoningEffort: "high", temperature: 0.3 },
      ],
      models_distribution: "round_robin",
    } satisfies CategoryConfig
    const executorContext = createExecutorContext(category, ["a", "b", "c"])
    executorContext.userCategories = { "reactive-distribution": category }
    await resolveCategoryExecution(
      { ...args, category: "reactive-distribution" }, executorContext, undefined, undefined,
    )
    const result = await resolveCategoryExecution(
      { ...args, category: "reactive-distribution" }, executorContext, undefined, undefined,
    )
    registerDelegatedChildSessionBootstrap({
      sessionID: "distribution-reactive",
      promptText: "fixture",
      category: "reactive-distribution",
      fallbackChain: result.fallbackChain,
    })
    const chain = getFallbackModelsForSession("distribution-reactive", undefined, {
      categories: executorContext.userCategories,
    })
    expect(getRawFallbackModels("distribution-reactive", undefined, {
      categories: executorContext.userCategories,
    })?.[0]).toMatchObject({
      model: "test-provider/c", reasoningEffort: "high", temperature: 0.3,
    })
    expect(chain).toEqual(["test-provider/c", "test-provider/a"])
    const state = createFallbackState("test-provider/b")
    const retryConfig = {
      enabled: true, retry_on_errors: [429], max_fallback_attempts: 8,
      cooldown_seconds: 60, timeout_seconds: 30, notify_on_fallback: false,
      restore_primary_after_cooldown: false,
    }
    expect(prepareFallback("distribution-reactive", state, chain, retryConfig).newModel).toBe("test-provider/c")
    expect(prepareFallback("distribution-reactive", state, chain, retryConfig).newModel).toBe("test-provider/a")
    expect(prepareFallback("distribution-reactive", state, chain, retryConfig).success).toBe(false)
  })

  test("round robin allocates concurrent spawns once and wraps the fallback order", async () => {
    const executorContext = createExecutorContext(
      {
        models: ["test-provider/a", { model: "test-provider/b", variant: "high" }, "test-provider/c"],
        models_distribution: "round_robin",
      },
      ["a", "b", "c"],
    )
    const results = await Promise.all(Array.from({ length: 4 }, () =>
      resolveCategoryExecution(args, executorContext, undefined, undefined)))
    expect(results.map((result) => result.actualModel)).toEqual([
      "test-provider/a", "test-provider/b", "test-provider/c", "test-provider/a",
    ])
    expect(results[1].categoryModel?.variant).toBe("high")
    expect(results.map((result) => result.fallbackChain?.map((entry) => entry.model))).toEqual([
      ["b", "c"], ["c", "a"], ["a", "b"], ["b", "c"],
    ])
    expect(executorContext.userCategories?.[CATEGORY_NAME]?.models?.[0]).toBe("test-provider/a")
  })

  test("agent round robin rotates canonical models and keeps per-entry tuning", async () => {
    const executorContext = createExecutorContext({}, ["a", "b", "c"])
    executorContext.agentOverrides = {
      Distributor: {
        models: ["test-provider/a", { model: "test-provider/b", variant: "high" }, "test-provider/c"],
        models_distribution: "round_robin",
      },
    }
    const results = await Promise.all(Array.from({ length: 4 }, () =>
      resolveSubagentModel("distributor", { name: "distributor", mode: "subagent" }, executorContext)))
    expect(results.map((result) => result.categoryModel?.modelID)).toEqual(["a", "b", "c", "a"])
    expect(results[1].categoryModel?.variant).toBe("high")
    expect(results.map((result) => result.fallbackChain?.map((entry) => entry.model))).toEqual([
      ["b", "c"], ["c", "a"], ["a", "b"], ["b", "c"],
    ])
    registerDelegatedChildSessionBootstrap({
      sessionID: "distribution-agent",
      promptText: "fixture",
      fallbackChain: results[1].fallbackChain,
    })
    expect(getFallbackModelsForSession("distribution-agent", "distributor", {
      agents: executorContext.agentOverrides,
    })).toEqual(["test-provider/c", "test-provider/a"])
  })

  test("sequential and omitted policies retain the primary for every spawn", async () => {
    for (const policy of [undefined, "sequential"] as const) {
      const executorContext = createExecutorContext(
        {
          models: ["test-provider/a", "test-provider/b"],
          ...(policy === undefined ? {} : { models_distribution: policy }),
        },
        ["a", "b"],
      )
      const results = await Promise.all(Array.from({ length: 3 }, () =>
        resolveCategoryExecution(args, executorContext, undefined, undefined)))
      expect(results.map((result) => result.actualModel)).toEqual(Array(3).fill("test-provider/a"))
      expect(results[0].fallbackChain?.map((entry) => entry.model)).toEqual(["b"])
    }
  })

  test("rotation skips unavailable entries without repeating a model or sharing target cursors", async () => {
    const executorContext = createExecutorContext({}, ["a", "b"])
    executorContext.userCategories = {
      "rotation-availability": {
        models: ["test-provider/missing", "test-provider/a", "test-provider/a", "test-provider/b"],
        models_distribution: "round_robin",
      },
      "rotation-independent": {
        models: ["test-provider/a", "test-provider/b"],
        models_distribution: "round_robin",
      },
    }
    const spawn = (category: string) =>
      resolveCategoryExecution({ ...args, category }, executorContext, undefined, undefined)
    const results = await Promise.all(Array.from({ length: 3 }, () => spawn("rotation-availability")))
    expect(results.map((result) => result.actualModel)).toEqual([
      "test-provider/a", "test-provider/a", "test-provider/b",
    ])
    expect(results[2].fallbackChain?.map((entry) => entry.model)).toEqual(["a"])
    expect((await spawn("rotation-independent")).actualModel).toBe("test-provider/a")
  })

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
