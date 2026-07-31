import { describe, expect, test } from "bun:test"

import type { OmoConfig } from "@oh-my-opencode/omo-config-core"

import type { AgentDefinition } from "../../agents"
import { TASK_PROMPT_GUIDELINES, TASK_PROMPT_SNIPPET, buildTaskToolDescription } from "./description"

const agents: Readonly<Record<string, AgentDefinition>> = {
  momus: { name: "momus", description: "Deep reasoning" },
}

describe("buildTaskToolDescription", () => {
  test("#given a custom omo.json category #when the description is built #then it lists that category dynamically", () => {
    // given
    const config: OmoConfig = {
      categories: { "release-crew": { description: "Ships the release train" } },
      agents: {},
    }

    // when
    const description = buildTaskToolDescription({ omoConfig: config, agents })

    // then
    expect(description).toContain("release-crew")
    expect(description).toContain("Ships the release train")
  })

  test("#given the description #when built #then it enforces the category XOR subagent_type contract", () => {
    // given
    const config: OmoConfig = { categories: {}, agents: {} }

    // when
    const description = buildTaskToolDescription({ omoConfig: config, agents })

    // then
    expect(description).toContain("EITHER category OR subagent_type")
    expect(description).toContain("DO NOT provide both")
  })

  test("#given the description #when built #then it describes spawn-only task and task_send continuation", () => {
    // given
    const config: OmoConfig = { categories: {}, agents: {} }

    // when
    const description = buildTaskToolDescription({ omoConfig: config, agents })

    // then
    expect(description).toContain("task_send")
    expect(description).not.toContain("task(task_id")
    expect(description).toContain("run_in_background")
  })

  test("#given loaded agents #when built #then it lists available agent types", () => {
    // given
    const config: OmoConfig = { categories: {}, agents: {} }

    // when
    const description = buildTaskToolDescription({ omoConfig: config, agents })

    // then
    expect(description).toContain("momus")
  })

  test("#given the prompt surfaces #when read #then snippet and guidelines are present", () => {
    // then
    expect(TASK_PROMPT_SNIPPET.length).toBeGreaterThan(0)
    expect(TASK_PROMPT_GUIDELINES.length).toBeGreaterThan(0)
  })

  test("#given task prompt surfaces #when responsibilities are inspected #then target selection belongs to the tool description only", () => {
    // given
    const config: OmoConfig = { categories: {}, agents: {} }

    // when
    const description = buildTaskToolDescription({ omoConfig: config, agents })
    const duplicatedTargetRule = TASK_PROMPT_GUIDELINES.some(
      (guideline) => /category.*subagent_type|subagent_type.*category/i.test(guideline),
    )

    // then
    expect(description).toMatch(/\bprompt\b/)
    expect(description).toMatch(/\btasks\b/)
    expect(duplicatedTargetRule).toBe(false)
  })
})

describe("buildTaskToolDescription category+model exclusivity", () => {
  test("#given the description #when built #then it forbids combining category with model and names the config escape hatch", () => {
    // given
    const config: OmoConfig = { categories: {}, agents: {} }

    // when
    const description = buildTaskToolDescription({ omoConfig: config, agents })

    // then
    expect(description).toContain("NEVER combine model with category")
    expect(description).toContain("omo.json")
    expect(description).toContain("subagent_type")
  })

  test("#given the prompt guidelines #when read #then they carry the category/model exclusivity rule", () => {
    const joined = TASK_PROMPT_GUIDELINES.join("\n")
    expect(joined).toContain("model")
    expect(joined).toContain("category")
    expect(joined).toContain("omo.json")
  })
})
