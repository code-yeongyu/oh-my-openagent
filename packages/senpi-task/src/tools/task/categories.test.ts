import { describe, expect, test } from "bun:test"

import type { OmoConfig } from "@oh-my-opencode/omo-config-core"

import type { AgentDefinition } from "../../agents"
import { CATEGORY_PROMPT_APPENDS } from "../../category"
import { listTaskAgents, listTaskCategories } from "./categories"

describe("listTaskCategories", () => {
  test("#given empty omo config #when listed #then builtin categories carry their descriptions", () => {
    // given
    const config: OmoConfig = { categories: {}, agents: {} }

    // when
    const categories = listTaskCategories(config)

    // then
    const quick = categories.find((entry) => entry.name === "quick")
    expect(quick).toBeDefined()
    expect(quick?.description).toBeTruthy()
  })

  test("#given a custom omo.json category #when listed #then it appears with its description", () => {
    // given
    const config: OmoConfig = {
      categories: { "release-crew": { description: "Ships the release train" } },
      agents: {},
    }

    // when
    const categories = listTaskCategories(config)

    // then
    const custom = categories.find((entry) => entry.name === "release-crew")
    expect(custom).toEqual({ name: "release-crew", description: "Ships the release train" })
  })

  test("#given a disabled category #when listed #then it is omitted", () => {
    // given
    const config: OmoConfig = {
      categories: { quick: { disable: true } },
      agents: {},
    }

    // when
    const names = listTaskCategories(config).map((entry) => entry.name)

    // then
    expect(names).not.toContain("quick")
  })

  test("#given caller-directed builtin guidance #when worker appends are inspected #then only worker context remains", () => {
    // given
    const callerDirectedCategories = ["quick", "unspecified-low", "unspecified-high"]

    // when / then
    for (const category of callerDirectedCategories) {
      expect(CATEGORY_PROMPT_APPENDS[category]).toContain("<Category_Context>")
      expect(CATEGORY_PROMPT_APPENDS[category]).not.toContain("<Selection_Gate>")
      expect(CATEGORY_PROMPT_APPENDS[category]).not.toContain("<Caller_Warning>")
    }
  })
})

describe("listTaskAgents", () => {
  test("#given loaded agent definitions #when listed #then names and descriptions surface, disabled excluded", () => {
    // given
    const agents: Readonly<Record<string, AgentDefinition>> = {
      momus: { name: "momus", description: "Deep reasoning" },
      hidden: { name: "hidden", description: "n/a", disable: true },
    }

    // when
    const listed = listTaskAgents(agents)

    // then
    expect(listed).toContainEqual({ name: "momus", description: "Deep reasoning" })
    expect(listed.map((entry) => entry.name)).not.toContain("hidden")
  })
})
