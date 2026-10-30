import { describe, expect, test } from "bun:test"

import type { OmoConfig } from "@oh-my-opencode/omo-config-core"

import type { AgentDefinition } from "../../agents"
import { TASK_PROMPT_GUIDELINES, buildTaskToolDescription } from "./description"

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

  test("#given the guidelines #when read #then task_summary usage is advertised to the model", () => {
    // given / when / then
    expect(TASK_PROMPT_GUIDELINES.some((guideline) => guideline.includes("task_summary"))).toBe(true)
  })

  test("#given caller-directed category guidance #when description is built #then selection sentinels reach the caller", () => {
    // given
    const config: OmoConfig = { categories: {}, agents: {} }

    // when
    const description = buildTaskToolDescription({ omoConfig: config, agents })

    // then
    expect(description).toContain("<Selection_Gate>")
    expect(description).toContain("<Caller_Warning>")
  })
})
