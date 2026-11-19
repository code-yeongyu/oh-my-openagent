import { describe, expect, test } from "bun:test"
import type { OmoConfig } from "@oh-my-opencode/omo-config-core"
import {
  BUILTIN_CATEGORY_DEFAULTS,
  resolveAgent,
  resolveCategory,
  resolveTaskAgents,
  type SenpiModelPort,
} from "@oh-my-opencode/senpi-task"

import { CATEGORY_FALLBACK_CHAINS } from "../../../../senpi-task/src/category/fallback-chains"
import { AGENT_FALLBACK_CHAINS } from "../../../../senpi-task/src/agents/builtin/fallback-chains"
import { resolveModelRoutingRows, type ModelRoutingRow } from "./model-routing-rows"
import { createTaskChildPlanner, type TaskModelRegistry } from "./planner"

// Retention: protocol contract (#11344): every row is exactly what resolveCategory / resolveAgent pick for a spawn.

type FakeModel = SenpiModelPort

function registry(models: readonly FakeModel[]) {
  return {
    getAvailable: () => models,
    find: (provider: string, modelId: string) =>
      models.find((model) => model.provider === provider && model.id === modelId),
  }
}

const CHAIN_MODELS: readonly FakeModel[] = [
  ...Object.values(CATEGORY_FALLBACK_CHAINS),
  ...Object.values(AGENT_FALLBACK_CHAINS),
]
  .flat()
  .flatMap((rung) => (rung.providers[0] === undefined ? [] : [{ provider: rung.providers[0], id: rung.model }]))
const USER_MODEL: FakeModel = { provider: "user-lab", id: "second-model" }
const FULL = registry([...CHAIN_MODELS, USER_MODEL])
const DEAD = registry([{ provider: "nobody", id: "nothing" }])
const CATEGORY_NAMES = BUILTIN_CATEGORY_DEFAULTS.map((definition) => definition.name)

function row(rows: readonly ModelRoutingRow[], kind: ModelRoutingRow["kind"], name: string): ModelRoutingRow {
  const found = rows.filter((candidate) => candidate.kind === kind && candidate.name === name)
  expect(found).toHaveLength(1)
  return found[0] as ModelRoutingRow
}

function categoryPick(name: string, config: OmoConfig, models: ReturnType<typeof registry>) {
  const resolution = resolveCategory(name, config, models)
  if (resolution.kind !== "resolved") return { effective: null }
  const variant = resolution.spec.reasoning ?? resolution.spec.reasoningEffort ?? resolution.spec.variant
  return {
    effective: `${resolution.spec.provider}/${resolution.spec.modelId}`,
    ...(variant === undefined ? {} : { variant }),
  }
}

function withoutSource(target: ModelRoutingRow) {
  const { source: _source, kind: _kind, name: _name, ...rest } = target
  return rest
}

describe("omo.modelRouting.resolve rows match resolveCategory for every builtin category", () => {
  test("#given no user config #when routed #then the category rows are exactly the builtin categories", () => {
    const names = resolveModelRoutingRows({}, FULL, { agents: resolveTaskAgents({}) })
      .filter((candidate) => candidate.kind === "category")
      .map((candidate) => candidate.name)
    expect(names).toEqual([...CATEGORY_NAMES].sort())
    expect(names).toEqual(expect.arrayContaining(["deep-low", "deep-high"]))
  })

  for (const name of CATEGORY_NAMES) {
    test(`#given ${name} with no user config #when routed #then the row is the builtin pick, sourced provider-fallback`, () => {
      const target = row(resolveModelRoutingRows({}, FULL, { agents: resolveTaskAgents({}) }), "category", name)
      expect(resolveCategory(name, {}, FULL).kind).toBe("resolved")
      expect(withoutSource(target)).toEqual(categoryPick(name, {}, FULL))
      expect(target.source).toBe("provider-fallback")
    })

    test(`#given ${name} with a user models[] chain whose head is gone #when routed #then the row is the promoted user rung, sourced override`, () => {
      const config: OmoConfig = {
        categories: { [name]: { models: ["user-lab/absent-model", "user-lab/second-model"] } },
      }
      const target = row(resolveModelRoutingRows(config, FULL, { agents: resolveTaskAgents(config) }), "category", name)
      expect(withoutSource(target)).toEqual(categoryPick(name, config, FULL))
      expect(target.effective).toBe("user-lab/second-model")
      expect(target.source).toBe("override")
    })

    test(`#given ${name} whose builtin chain has no usable rung #when routed #then the row has no model and reads unresolved`, () => {
      const target = row(resolveModelRoutingRows({}, DEAD, { agents: resolveTaskAgents({}) }), "category", name)
      expect(target).toEqual({ kind: "category", name, effective: null, source: "unresolved" })
    })

    test(`#given ${name} whose user chain names only missing models #when routed #then the row is whatever resolveCategory picks`, () => {
      const config: OmoConfig = { categories: { [name]: { models: ["user-lab/gone-model"] } } }
      const target = row(resolveModelRoutingRows(config, FULL, { agents: resolveTaskAgents(config) }), "category", name)
      const pick = categoryPick(name, config, FULL)
      expect(withoutSource(target)).toEqual(pick)
      expect(target.source).toBe(pick.effective === null ? "unresolved" : "override")
    })
  }

  test("#given a configured custom category and a disabled builtin #when routed #then both appear under their own names", () => {
    const config: OmoConfig = {
      categories: { "my-lane": { model: "user-lab/second-model" }, quick: { disable: true } },
    }
    const rows = resolveModelRoutingRows(config, FULL, { agents: resolveTaskAgents(config) })
    expect(row(rows, "category", "my-lane")).toEqual({
      kind: "category",
      name: "my-lane",
      effective: "user-lab/second-model",
      source: "override",
    })
    expect(row(rows, "category", "quick")).toEqual({
      kind: "category",
      name: "quick",
      effective: null,
      source: "unresolved",
    })
  })
})

describe("omo.modelRouting.resolve rows match resolveAgent for every task agent", () => {
  const agents = resolveTaskAgents({})

  for (const name of Object.keys(agents)) {
    test(`#given ${name} with no user config #when routed #then the row is resolveAgent's pick, sourced provider-fallback`, () => {
      const resolution = resolveAgent(name, agents, FULL, { omoConfig: {} })
      if (resolution.kind !== "resolved") throw new Error(`${name} must resolve against every chain model`)
      const record = resolution.resolved_model
      const variant = record?.reasoning ?? record?.reasoning_effort ?? record?.variant
      expect(row(resolveModelRoutingRows({}, FULL, { agents: resolveTaskAgents({}) }), "agent", name)).toEqual({
        kind: "agent",
        name,
        effective: resolution.model,
        source: "provider-fallback",
        ...(variant === undefined ? {} : { variant }),
      })
    })
  }

  test("#given a user model on an agent #when routed #then the agent row is that model, sourced override", () => {
    const config: OmoConfig = { agents: { explore: { model: "user-lab/second-model" } } }
    expect(
      row(resolveModelRoutingRows(config, FULL, { agents: resolveTaskAgents(config) }), "agent", "explore"),
    ).toMatchObject({
      effective: "user-lab/second-model",
      source: "override",
    })
  })

  test("#given a user override on the category an agent runs through #when routed #then the agent row is sourced override", () => {
    const config: OmoConfig = { categories: { "unspecified-high": { model: "user-lab/second-model" } } }
    expect(
      row(
        resolveModelRoutingRows(config, FULL, { agents: resolveTaskAgents(config) }),
        "agent",
        "omo-native-code-reviewer",
      ),
    ).toMatchObject({
      effective: "user-lab/second-model",
      source: "override",
    })
  })

  test("#given no usable model anywhere #when routed #then every agent row reads unresolved", () => {
    const rows = resolveModelRoutingRows({}, DEAD, { agents: resolveTaskAgents({}) }).filter(
      (candidate) => candidate.kind === "agent",
    )
    expect(rows.map((candidate) => candidate.name).sort()).toEqual(Object.keys(agents).sort())
    for (const candidate of rows)
      expect(candidate).toEqual({ kind: "agent", name: candidate.name, effective: null, source: "unresolved" })
  })
})

function plannedModel(
  planner: ReturnType<typeof createTaskChildPlanner>,
  target: { readonly subagent_type?: string; readonly category?: string },
): string {
  const plan = planner({ prompt: "Return exactly OK.", parent_session_id: "p", depth: 0, ...target })
  if (plan.kind !== "resolved") throw new Error(`expected a resolved plan, got ${plan.kind}`)
  return plan.plan.model
}

describe("omo.modelRouting.resolve rows answer from the planner's own inputs", () => {
  test("#given agents.explore.model edited mid-session #when routed and planned #then the row and the planned spawn agree", () => {
    // given: the engine composes its agent table once; the planner re-reads the config per plan
    const third: FakeModel = { provider: "user-lab", id: "third-model" }
    const models = registry([...CHAIN_MODELS, USER_MODEL, third])
    const atStart: OmoConfig = { agents: { explore: { model: "user-lab/second-model" } } }
    const agents = resolveTaskAgents(atStart)
    let live: OmoConfig = atStart
    const planner = createTaskChildPlanner(
      () => live,
      agents,
      () => models,
    )

    // when: the user edits the agent's model after the session started
    live = { agents: { explore: { model: "user-lab/third-model" } } }
    const target = row(resolveModelRoutingRows(live, models, { agents }), "agent", "explore")

    // then
    expect(target.effective).toBe(plannedModel(planner, { subagent_type: "explore" }))
    expect(target).toMatchObject({ effective: "user-lab/second-model", source: "override" })
  })

  test("#given a fast parent session #when routed #then rows carry the -fast sibling the planner picks, unless exclude_models keeps it out", () => {
    // given
    const fastModels: TaskModelRegistry = {
      getAvailable: () => FAST_CATALOG,
      find: (provider, modelId) => FAST_CATALOG.find((model) => model.provider === provider && model.id === modelId),
    }
    const config: OmoConfig = { categories: { quick: { model: "chatgpt-subscription/gpt-5.6-luna" } } }
    const agents = resolveTaskAgents(config)
    const planner = createTaskChildPlanner(
      config,
      agents,
      () => fastModels,
      () => "priority",
    )

    // when
    const fastRow = row(
      resolveModelRoutingRows(config, fastModels, { agents, parentServiceTier: "priority" }),
      "category",
      "quick",
    )
    const excluded: OmoConfig = { ...config, exclude_models: ["chatgpt-subscription/gpt-5.6-luna-fast"] }
    const excludedRow = row(
      resolveModelRoutingRows(excluded, fastModels, { agents, parentServiceTier: "priority" }),
      "category",
      "quick",
    )
    const standardRow = row(resolveModelRoutingRows(config, fastModels, { agents }), "category", "quick")

    // then
    expect(fastRow.effective).toBe("chatgpt-subscription/gpt-5.6-luna-fast")
    expect(fastRow.effective).toBe(plannedModel(planner, { category: "quick" }))
    expect(excludedRow.effective).toBe("chatgpt-subscription/gpt-5.6-luna")
    expect(standardRow.effective).toBe("chatgpt-subscription/gpt-5.6-luna")
  })

  test("#given a retired agent alias key in omo.json #when routed #then one row under the canonical name", () => {
    // given
    const config: OmoConfig = { agents: { "omo-senpi-code-reviewer": { model: "user-lab/second-model" } } }

    // when
    const names = resolveModelRoutingRows(config, FULL, { agents: resolveTaskAgents(config) })
      .filter((candidate) => candidate.kind === "agent")
      .map((candidate) => candidate.name)

    // then
    expect(names.filter((name) => name === "omo-native-code-reviewer")).toHaveLength(1)
    expect(names).not.toContain("omo-senpi-code-reviewer")
    expect(new Set(names).size).toBe(names.length)
  })
})

const FAST_CATALOG = [
  { provider: "chatgpt-subscription", id: "gpt-5.6-luna" },
  {
    provider: "chatgpt-subscription",
    id: "gpt-5.6-luna-fast",
    upstreamModelId: "gpt-5.6-luna",
    serviceTier: "priority" as const,
  },
]
