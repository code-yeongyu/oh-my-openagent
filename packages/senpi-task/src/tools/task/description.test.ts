import { describe, expect, test } from "bun:test"

import type { OmoConfig } from "@oh-my-opencode/omo-config-core"

import type { AgentDefinition } from "../../agents"
import { TASK_PROMPT_GUIDELINES, TASK_PROMPT_SNIPPET, buildTaskToolDescription } from "./description"

const agents: Readonly<Record<string, AgentDefinition>> = {
  oracle: { name: "oracle", description: "Deep reasoning" },
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
    expect(description).toContain("oracle")
  })

  test("#given the prompt surfaces #when read #then snippet and guidelines are present", () => {
    // then
    expect(TASK_PROMPT_SNIPPET.length).toBeGreaterThan(0)
    expect(TASK_PROMPT_GUIDELINES.length).toBeGreaterThan(0)
  })
})
