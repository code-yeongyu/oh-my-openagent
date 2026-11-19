import { describe, expect, test } from "bun:test"

import type { OmoConfig } from "@oh-my-opencode/omo-config-core"

import type { AgentDefinition } from "../../agents"
import { listTaskCategories } from "./categories"
import { buildTaskToolDescription } from "./description"

// Claude Code (the Claude subscription path) keeps only the first 4096 chars of an MCP tool
// description and appends "… [truncated]" (#14291).
const CLAUDE_CODE_MCP_DESCRIPTION_CAP = 4096

const plainAgents = Object.fromEntries(
  Array.from({ length: 40 }, (_, index) => [`agent-${index}`, { name: `agent-${index}`, description: "Plain agent" }]),
)
const agents: Readonly<Record<string, AgentDefinition>> = {
  ...plainAgents,
  "plan-consultant": { name: "plan-consultant", description: "Pre-planning consultant" },
  "plan-reviewer": { name: "plan-reviewer", description: "Plan reviewer" },
}

describe("buildTaskToolDescription under the Claude Code MCP description cap", () => {
  test("#given many agents and a long custom category #when built #then only the category catalogue lies past the first 4096 chars", () => {
    // given
    const config: OmoConfig = {
      categories: { "release-crew": { description: "Ships the release train. ".repeat(80) } },
      agents: {},
    }
    const categories = listTaskCategories(config)

    // when
    const description = buildTaskToolDescription({ omoConfig: config, agents })

    // then the catalogue is the tail, so everything before it (every rule, the agent lists, the plan-reviewer
    // notice) survives the cut
    expect(description.length).toBeGreaterThan(CLAUDE_CODE_MCP_DESCRIPTION_CAP)
    const catalogueStart = description.indexOf(`\n  - ${categories[0]?.name}`)
    expect(catalogueStart).toBeGreaterThan(0)
    expect(catalogueStart).toBeLessThanOrEqual(CLAUDE_CODE_MCP_DESCRIPTION_CAP)
    const tail = description.slice(catalogueStart + 1).split("\n")
    expect(tail.filter((line) => !line.startsWith("  - ") && !line.startsWith("    "))).toEqual([])
    expect(tail.filter((line) => line.startsWith("  - ")).length).toBe(categories.length)
  })
})
