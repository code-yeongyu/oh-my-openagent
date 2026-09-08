import { describe, expect, test } from "bun:test"

import type { SenpiModelPort } from "@oh-my-opencode/senpi-task"

import { createTaskChildPlanner, type TaskModelRegistry } from "./planner"

type CatalogModel = SenpiModelPort & {
  readonly upstreamModelId?: string
  readonly serviceTier?: "auto" | "flex" | "priority"
}

const CODEX = "openai-codex"
const LUNA = "gpt-5.6-luna"
const LUNA_FAST = `${LUNA}-fast`

function fastVariant(provider: string, baseId: string): CatalogModel {
  return { provider, id: `${baseId}-fast`, upstreamModelId: baseId, serviceTier: "priority" }
}

function registry(models: readonly CatalogModel[]): TaskModelRegistry {
  return {
    getAvailable: () => models,
    find: (provider, modelId) => models.find((candidate) => candidate.provider === provider && candidate.id === modelId),
  }
}

function plannerFor(models: readonly CatalogModel[], parentTier: "priority" | "auto" | undefined) {
  return createTaskChildPlanner({}, {}, () => registry(models), () => parentTier)
}

function expectResolved(plan: ReturnType<ReturnType<typeof createTaskChildPlanner>>) {
  if (plan.kind !== "resolved") throw new Error(`Expected resolved plan, got ${plan.kind}`)
  return plan.plan
}

describe("delegated task inherits the parent's fast mode", () => {
  test("#given a fast parent and an explicit base Codex model #when planned #then the child runs the -fast sibling", () => {
    // given
    const planner = plannerFor([{ provider: CODEX, id: LUNA }, fastVariant(CODEX, LUNA)], "priority")

    // when
    const plan = expectResolved(planner({ prompt: "Return exactly OK.", parent_session_id: "p", depth: 0, model: `${CODEX}/${LUNA}` }))

    // then
    expect(plan.model).toBe(`${CODEX}/${LUNA_FAST}`)
    expect(plan.resolved_model).toEqual({
      source: "explicit",
      provider: CODEX,
      model_id: LUNA_FAST,
      display: `${CODEX}/${LUNA_FAST}`,
    })
  })

  test("#given a fast parent and a category resolving to a base model #when planned #then metadata survives the swap", () => {
    // given
    const planner = createTaskChildPlanner(
      { categories: { quick: { model: `${CODEX}/${LUNA}`, variant: "low" } } },
      {},
      () => registry([{ provider: CODEX, id: LUNA }, fastVariant(CODEX, LUNA)]),
      () => "priority",
    )

    // when
    const plan = expectResolved(planner({ prompt: "Quick.", parent_session_id: "p", depth: 0, category: "quick" }))

    // then
    expect(plan.model).toBe(`${CODEX}/${LUNA_FAST}`)
    expect(plan.variant).toBe("low")
    expect(plan.category).toBe("quick")
    expect(plan.resolved_model?.model_id).toBe(LUNA_FAST)
    expect(plan.resolved_model?.variant).toBe("low")
  })

  test("#given a parent that is not fast #when planned #then the child keeps the planned model", () => {
    // given
    const models = [{ provider: CODEX, id: LUNA }, fastVariant(CODEX, LUNA)]

    // when
    const standard = expectResolved(plannerFor(models, "auto")({ prompt: "x", parent_session_id: "p", depth: 0, model: `${CODEX}/${LUNA}` }))
    const unknown = expectResolved(plannerFor(models, undefined)({ prompt: "x", parent_session_id: "p", depth: 0, model: `${CODEX}/${LUNA}` }))

    // then
    expect(standard.model).toBe(`${CODEX}/${LUNA}`)
    expect(unknown.model).toBe(`${CODEX}/${LUNA}`)
  })

  test("#given a fast parent and a model with no priority sibling #when planned #then the child keeps the planned model", () => {
    // given
    const planner = plannerFor([{ provider: CODEX, id: "gpt-5.4" }], "priority")

    // when
    const plan = expectResolved(planner({ prompt: "x", parent_session_id: "p", depth: 0, model: `${CODEX}/gpt-5.4` }))

    // then
    expect(plan.model).toBe(`${CODEX}/gpt-5.4`)
  })

  test("#given a fast parent and a same-suffix model that is not a tier alias #when planned #then it is not swapped in", () => {
    // given: a distinct SKU that happens to end in -fast, and a user entry whose upstream is not the base
    const planner = plannerFor(
      [
        { provider: "cursor", id: "composer-2.5" },
        { provider: "cursor", id: "composer-2.5-fast" },
        { provider: CODEX, id: "custom" },
        { provider: CODEX, id: "custom-fast", upstreamModelId: "custom-upstream", serviceTier: "priority" },
      ],
      "priority",
    )

    // when
    const cursor = expectResolved(planner({ prompt: "x", parent_session_id: "p", depth: 0, model: "cursor/composer-2.5" }))
    const custom = expectResolved(planner({ prompt: "x", parent_session_id: "p", depth: 0, model: `${CODEX}/custom` }))

    // then
    expect(cursor.model).toBe("cursor/composer-2.5")
    expect(custom.model).toBe(`${CODEX}/custom`)
  })

  test("#given a fast parent and a model already on -fast #when planned #then it is left untouched", () => {
    // given
    const planner = plannerFor([{ provider: CODEX, id: LUNA }, fastVariant(CODEX, LUNA)], "priority")

    // when
    const plan = expectResolved(planner({ prompt: "x", parent_session_id: "p", depth: 0, model: `${CODEX}/${LUNA_FAST}` }))

    // then
    expect(plan.model).toBe(`${CODEX}/${LUNA_FAST}`)
    expect(plan.resolved_model?.model_id).toBe(LUNA_FAST)
  })
})
