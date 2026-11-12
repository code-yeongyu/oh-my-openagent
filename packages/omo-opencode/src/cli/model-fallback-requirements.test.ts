import { describe, expect, test } from "bun:test"

import {
  CLI_AGENT_MODEL_REQUIREMENTS,
  CLI_CATEGORY_MODEL_REQUIREMENTS,
} from "./model-fallback-requirements"
import {
  AGENT_MODEL_REQUIREMENTS,
  ATLAS_CLOUD_PROVIDER_ID,
  CATEGORY_MODEL_REQUIREMENTS,
  type ModelRequirement,
} from "../shared/model-requirements"

function withoutAtlasCloud(requirements: Record<string, ModelRequirement>): Record<string, ModelRequirement> {
  return JSON.parse(
    JSON.stringify(requirements, (key, value) =>
      Array.isArray(value) && value.every((item) => typeof item === "string")
        ? value.filter((item) => item !== ATLAS_CLOUD_PROVIDER_ID)
        : value,
    ),
  )
}

describe("CLI model fallback requirements", () => {
  test("agent requirements stay aligned with runtime requirements", () => {
    // #given
    const runtimeAgents = AGENT_MODEL_REQUIREMENTS

    // #when
    const cliAgents = withoutAtlasCloud(CLI_AGENT_MODEL_REQUIREMENTS)

    // #then
    expect(cliAgents).toEqual(runtimeAgents)
  })

  test("category requirements stay aligned with runtime requirements", () => {
    // #given
    const runtimeCategories = CATEGORY_MODEL_REQUIREMENTS

    // #when
    const cliCategories = withoutAtlasCloud(CLI_CATEGORY_MODEL_REQUIREMENTS)

    // #then
    expect(cliCategories).toEqual(runtimeCategories)
  })
})
