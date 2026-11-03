import { describe, expect, test } from "bun:test"
import { AGENT_MODEL_REQUIREMENTS, CATEGORY_MODEL_REQUIREMENTS, launchRungRejections } from "@oh-my-opencode/model-core"
import { AGENT_FALLBACK_CHAINS } from "@oh-my-opencode/senpi-task/agents-builtin"
import "@oh-my-opencode/senpi-task/category-builtins"
import { BUILTIN_MODEL_PROFILES } from "./builtin-profiles"

// Release contract: every builtin chain table builds its Fable 5.5 rungs through launchRungs, which
// drops (never throws on) a released rung whose effort is not accepted and records it in one shared
// log. This package sees all three owners (model-core, senpi-task, omo-senpi), so a bad rung in any
// of them fails here instead of shipping.
describe("Fable 5.5 launch rungs across every builtin chain table", () => {
  test("building the model-core, senpi-task and omo-senpi tables records no launch rung rejection", () => {
    // given: importing the tables builds every chain through launchRungs
    const tables = [AGENT_MODEL_REQUIREMENTS, CATEGORY_MODEL_REQUIREMENTS, AGENT_FALLBACK_CHAINS, BUILTIN_MODEL_PROFILES]
    expect(tables.every((table) => Object.keys(table).length > 0)).toBe(true)
    // then
    expect(launchRungRejections()).toEqual([])
  })
})
