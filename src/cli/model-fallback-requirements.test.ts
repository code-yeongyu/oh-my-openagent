import { describe, expect, test } from "bun:test"

import {
  CLI_AGENT_MODEL_REQUIREMENTS,
  CLI_CATEGORY_MODEL_REQUIREMENTS,
} from "./model-fallback-requirements"
import { AGENT_MODEL_REQUIREMENTS, CATEGORY_MODEL_REQUIREMENTS } from "../shared/model-requirements"

describe("CLI model fallback requirements", () => {
  test("agent requirements stay aligned with runtime requirements", () => {
    // #given
    const runtimeAgents = AGENT_MODEL_REQUIREMENTS

    // #when
    const cliAgents = CLI_AGENT_MODEL_REQUIREMENTS

    // #then
    expect(cliAgents).toEqual(runtimeAgents)
  })

  test("category requirements stay aligned with runtime requirements", () => {
    // #given
    const runtimeCategories = CATEGORY_MODEL_REQUIREMENTS

    // #when
    const cliCategories = CLI_CATEGORY_MODEL_REQUIREMENTS

    // #then
    expect(cliCategories).toEqual(runtimeCategories)
  })
})
