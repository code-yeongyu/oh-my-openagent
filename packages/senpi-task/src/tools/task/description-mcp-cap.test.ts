import { describe, expect, test } from "bun:test"

import type { OmoConfig } from "@oh-my-opencode/omo-config-core"

import type { AgentDefinition } from "../../agents"
import { buildTaskToolDescription } from "./description"

// Claude Code (the Claude subscription path) keeps only the first 4096 chars of an MCP tool
// description and appends "… [truncated]" (#14291).
const CLAUDE_CODE_MCP_DESCRIPTION_CAP = 4096

const RULE_ANCHORS = [
  "Choose exactly one input form",
  "Each spawn MUST provide EITHER category OR subagent_type",
  "fails with unknown_target",
  "run_in_background is batch-wide",
  "model is an explicit override for subagent_type spawns ONLY",
  "apply and merge require isolation to be enabled",
  "NEVER combine model with category",
  "task_send continues an existing child; task always spawns.",
  "Prompts MUST be in English.",
  "plan-reviewer is one-shot",
]

const agents: Readonly<Record<string, AgentDefinition>> = {
  explore: { name: "explore", description: "Codebase search" },
  librarian: { name: "librarian", description: "Docs research" },
  "plan-consultant": { name: "plan-consultant", description: "Pre-planning consultant" },
  "plan-reviewer": { name: "plan-reviewer", description: "Plan reviewer" },
}

describe("buildTaskToolDescription under the Claude Code MCP description cap", () => {
  test("#given builtin categories plus a long custom one #when built #then every rule ends inside the first 4096 chars", () => {
    // given
    const config: OmoConfig = {
      categories: { "release-crew": { description: "Ships the release train. ".repeat(80) } },
      agents: {},
    }

    // when
    const description = buildTaskToolDescription({ omoConfig: config, agents })

    // then
    expect(description.length).toBeGreaterThan(CLAUDE_CODE_MCP_DESCRIPTION_CAP)
    const kept = description.slice(0, CLAUDE_CODE_MCP_DESCRIPTION_CAP)
    expect(RULE_ANCHORS.filter((anchor) => !kept.includes(anchor))).toEqual([])
    expect(kept).toContain("Available agents: explore, librarian")
  })
})
