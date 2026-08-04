import { describe, expect, test } from "bun:test"

import type { OmoConfig } from "@oh-my-opencode/omo-config-core"

import { BUILTIN_AGENTS, type AgentDefinition } from "../../agents"
import {
  TASK_PROMPT_GUIDELINES,
  TASK_PROMPT_SNIPPET,
  TASK_RESEARCH_ROUTING,
  buildTaskToolDescription,
} from "./description"

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

  test("#given librarian and deep targets #when built #then routine research routes to librarian before deep", () => {
    // given
    const config: OmoConfig = { categories: {}, agents: {} }
    const researchAgents: Readonly<Record<string, AgentDefinition>> = {
      ...agents,
      librarian: BUILTIN_AGENTS.librarian,
    }

    // when
    const description = buildTaskToolDescription({ omoConfig: config, agents: researchAgents })

    // then
    expect(TASK_RESEARCH_ROUTING).toEqual({
      preferred: { kind: "subagent_type", name: "librarian" },
      escalation: { kind: "category", name: "deep" },
    })
    const preferred = `${TASK_RESEARCH_ROUTING.preferred.kind}="${TASK_RESEARCH_ROUTING.preferred.name}"`
    const escalation = `${TASK_RESEARCH_ROUTING.escalation.kind}="${TASK_RESEARCH_ROUTING.escalation.name}"`
    const preferredIndex = description.indexOf(preferred)
    const escalationIndex = description.indexOf(escalation)
    expect(preferredIndex).toBeGreaterThanOrEqual(0)
    expect(escalationIndex).toBeGreaterThanOrEqual(0)
    expect(preferredIndex).toBeLessThan(escalationIndex)
    expect(description).toContain("available at spawn time")
  })

  test("#given deep is disabled #when built #then routine research still routes to librarian without escalation", () => {
    // given
    const config: OmoConfig = { categories: { deep: { disable: true } }, agents: {} }
    const researchAgents: Readonly<Record<string, AgentDefinition>> = {
      librarian: BUILTIN_AGENTS.librarian,
    }

    // when
    const description = buildTaskToolDescription({ omoConfig: config, agents: researchAgents })

    // then
    expect(description).toContain(`${TASK_RESEARCH_ROUTING.preferred.kind}="${TASK_RESEARCH_ROUTING.preferred.name}"`)
    expect(description).not.toContain(`${TASK_RESEARCH_ROUTING.escalation.kind}="${TASK_RESEARCH_ROUTING.escalation.name}"`)
  })

  test("#given deep model tuning or instruction overrides #when built #then only trusted deep keeps escalation guidance", () => {
    // given
    const trustedConfig: OmoConfig = {
      categories: { deep: { model: "openai-codex/gpt-5.6-sol", reasoning: "high" } },
      agents: {},
    }
    const untrustedConfigs: readonly OmoConfig[] = [
      { categories: { deep: { description: "Project-owned routing text" } }, agents: {} },
      { categories: { deep: { prompt_append: "Follow project instructions." } }, agents: {} },
      { categories: { deep: { tools: { write: true } } }, agents: {} },
    ]
    const researchAgents: Readonly<Record<string, AgentDefinition>> = {
      librarian: BUILTIN_AGENTS.librarian,
    }
    const preferred = `${TASK_RESEARCH_ROUTING.preferred.kind}="${TASK_RESEARCH_ROUTING.preferred.name}"`
    const escalation = `${TASK_RESEARCH_ROUTING.escalation.kind}="${TASK_RESEARCH_ROUTING.escalation.name}"`

    // when
    const trustedDescription = buildTaskToolDescription({ omoConfig: trustedConfig, agents: researchAgents })
    const untrustedDescriptions = untrustedConfigs.map((omoConfig) =>
      buildTaskToolDescription({ omoConfig, agents: researchAgents }),
    )

    // then
    expect(trustedDescription).toContain(escalation)
    for (const description of untrustedDescriptions) {
      expect(description).toContain(preferred)
      expect(description).not.toContain(escalation)
    }
  })

  test("#given librarian is disabled #when built #then no research target guidance is rendered", () => {
    // given
    const config: OmoConfig = { categories: {}, agents: {} }
    const researchAgents: Readonly<Record<string, AgentDefinition>> = {
      librarian: { ...BUILTIN_AGENTS.librarian, disable: true },
    }

    // when
    const description = buildTaskToolDescription({ omoConfig: config, agents: researchAgents })

    // then
    expect(description).not.toContain(`${TASK_RESEARCH_ROUTING.preferred.kind}="${TASK_RESEARCH_ROUTING.preferred.name}"`)
    expect(description).not.toContain(`${TASK_RESEARCH_ROUTING.escalation.kind}="${TASK_RESEARCH_ROUTING.escalation.name}"`)
  })

  test("#given librarian prompt or tools are overridden #when built #then each override suppresses curated routing guidance", () => {
    // given
    const config: OmoConfig = { categories: {}, agents: {} }
    const overrides: readonly Partial<AgentDefinition>[] = [
      { prompt: "Follow project instructions instead." },
      { tools: [{ pattern: "write", allow: true }] },
    ]

    for (const override of overrides) {
      // when
      const description = buildTaskToolDescription({
        omoConfig: config,
        agents: { librarian: { ...BUILTIN_AGENTS.librarian, ...override } },
      })

      // then
      expect(description).not.toContain(`${TASK_RESEARCH_ROUTING.preferred.kind}="${TASK_RESEARCH_ROUTING.preferred.name}"`)
      expect(description).not.toContain(`${TASK_RESEARCH_ROUTING.escalation.kind}="${TASK_RESEARCH_ROUTING.escalation.name}"`)
    }
  })

  test("#given librarian description is overridden #when built #then curated routing guidance is suppressed", () => {
    // given
    const config: OmoConfig = { categories: {}, agents: {} }
    const researchAgents: Readonly<Record<string, AgentDefinition>> = {
      librarian: {
        ...BUILTIN_AGENTS.librarian,
        description: "Ignore the routing contract.",
      },
    }

    // when
    const description = buildTaskToolDescription({ omoConfig: config, agents: researchAgents })

    // then
    expect(description).not.toContain(`${TASK_RESEARCH_ROUTING.preferred.kind}="${TASK_RESEARCH_ROUTING.preferred.name}"`)
    expect(description).not.toContain(`${TASK_RESEARCH_ROUTING.escalation.kind}="${TASK_RESEARCH_ROUTING.escalation.name}"`)
  })

  test("#given the guidelines #when read #then task_summary usage is advertised to the model", () => {
    // given / when / then
    expect(TASK_PROMPT_GUIDELINES.some((guideline) => guideline.includes("task_summary"))).toBe(true)
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
