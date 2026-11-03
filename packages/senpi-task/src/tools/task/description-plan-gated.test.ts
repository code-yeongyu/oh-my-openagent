import { describe, expect, test } from "bun:test"

import type { OmoConfig } from "@oh-my-opencode/omo-config-core"

import type { AgentDefinition } from "../../agents"
import { buildTaskToolDescription } from "./description"

const CONFIG: OmoConfig = { categories: {}, agents: {} }

function agentSet(): Readonly<Record<string, AgentDefinition>> {
  return {
    explore: { name: "explore", description: "Codebase search" },
    librarian: { name: "librarian", description: "Docs research" },
    "plan-consultant": { name: "plan-consultant", description: "Pre-planning consultant" },
    "plan-reviewer": { name: "plan-reviewer", description: "Plan reviewer" },
  }
}

describe("buildTaskToolDescription plan-gated agents", () => {
  test("#given gated and plain agents #when built #then plan-gated agents are classified separately with their invocation condition", () => {
    // given / when
    const description = buildTaskToolDescription({ omoConfig: CONFIG, agents: agentSet() })

    // then
    expect(description).toContain("Plan-gated agents")
    expect(description).toContain("ulw-plan")
    expect(description).toContain("ulw-execute")
    expect(description).toContain("user explicitly request")
    expect(description).toContain(".omo/plans")
    expect(description).toContain("plan-consultant")
    expect(description).toContain("plan-reviewer")
  })

  test("#given gated and plain agents #when built #then the plain available-agents line excludes the gated names", () => {
    // given / when
    const description = buildTaskToolDescription({ omoConfig: CONFIG, agents: agentSet() })

    // then
    const availableLine = description.split("\n").find((line) => line.includes("Available agents:")) ?? ""
    expect(availableLine).toContain("explore")
    expect(availableLine).toContain("librarian")
    expect(availableLine).not.toContain("plan-consultant")
    expect(availableLine).not.toContain("plan-reviewer")
  })

  test("#given only plain agents #when built #then no plan-gated section is rendered", () => {
    // given
    const agents: Readonly<Record<string, AgentDefinition>> = {
      explore: { name: "explore", description: "Codebase search" },
    }

    // when
    const description = buildTaskToolDescription({ omoConfig: CONFIG, agents })

    // then
    expect(description).not.toContain("Plan-gated agents")
  })
})
