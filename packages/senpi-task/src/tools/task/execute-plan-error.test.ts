import { describe, expect, test } from "bun:test"

import type { StartResult } from "../../manager"
import { CTX, createFakeManager, makeDeps } from "./__fixtures__/task-tool-fakes"
import { buildTaskExecute } from "./execute"

describe("buildTaskExecute plan errors", () => {
  test("#given an unknown target with active agents and categories #when executed #then both roster suffixes are rendered", async () => {
    // given
    const manager = createFakeManager({
      start: async (): Promise<StartResult> => ({
        kind: "plan_unresolved",
        error: {
          code: "unknown_target",
          message: 'Target "nope" not found.',
          availableAgents: ["explore", "momus"],
          availableCategories: ["deep", "quick"],
        },
      }),
    })
    const execute = buildTaskExecute(makeDeps(manager))

    // when
    const result = await execute("call-plan-error", { prompt: "p", subagent_type: "nope" }, undefined, undefined, CTX)

    // then
    const text = result.content[0]?.type === "text" ? result.content[0].text : ""
    expect(text).toBe(
      'Target "nope" not found. Available agents: explore, momus. Available categories: deep, quick.',
    )
  })

  test("#given a model_unavailable plan error #when executed #then the suffix says valid category names with the omo.json config hint", async () => {
    // given
    const manager = createFakeManager({
      start: async (): Promise<StartResult> => ({
        kind: "plan_unresolved",
        error: {
          code: "model_unavailable",
          message: 'No available model for category "quick" (attempted opengateway/glm-5.2-ultrafast).',
          availableCategories: ["deep", "quick"],
        },
      }),
    })
    const execute = buildTaskExecute(makeDeps(manager))

    // when
    const result = await execute("call-model-unavailable", { prompt: "p", category: "quick" }, undefined, undefined, CTX)

    // then
    const text = result.content[0]?.type === "text" ? result.content[0].text : ""
    expect(text).toContain("Valid category names: deep, quick")
    expect(text).toContain("omo.json")
    expect(text).not.toContain('Pass model:')
    expect(text).not.toContain("Available categories:")
  })
})
