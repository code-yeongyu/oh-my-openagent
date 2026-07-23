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
          availableAgents: ["explore", "oracle"],
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
      'Target "nope" not found. Available agents: explore, oracle. Available categories: deep, quick.',
    )
  })
})
