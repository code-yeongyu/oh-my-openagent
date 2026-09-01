/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"

import type { FinalOpenCodeAgentRegistryClient } from "./final-open-code-agent-registry"
import {
  hasProjectAgentProvenance,
  replaceProjectAgentProvenance,
  resolveFinalProjectAgent,
} from "./final-open-code-agent-registry"

const TEAM_TOOLS = ["team_send_message", "team_task_list", "team_task_get", "team_task_update", "team_status", "call_omo_agent"] as const

function createPermissionRules(taskAction: "allow" | "deny" = "deny") {
  return [...TEAM_TOOLS.map((permission) => ({ permission, pattern: "*", action: "allow" as const })), { permission: "task", pattern: "*", action: taskAction }, { permission: "question", pattern: "*", action: "deny" }]
}

describe("project agent provenance", () => {
  test("accepts a parent snapshot from a descendant member-worktree path", () => {
    // given: a project snapshot recorded above a member worktree
    const projectDirectory = "/tmp/test-project-agent-provenance-parent"
    const memberWorktreeDirectory = `${projectDirectory}/.omo/teams/example/worktrees/member`
    replaceProjectAgentProvenance(projectDirectory, ["project-agent"])

    // when: provenance is checked from the descendant member worktree
    const result = hasProjectAgentProvenance(memberWorktreeDirectory, "project-agent")

    // then: the parent project snapshot authorizes the agent
    expect(result).toBe(true)
  })

  test("rejects when the nearest snapshot does not contain the agent", () => {
    // given: an older matching snapshot and a nearer nonmatching snapshot
    const projectDirectory = "/tmp/test-project-agent-provenance-nonmatching"
    const nestedDirectory = `${projectDirectory}/nested`
    replaceProjectAgentProvenance(projectDirectory, ["project-agent"])
    replaceProjectAgentProvenance(nestedDirectory, ["other-agent"])

    // when: provenance is checked below the nearer snapshot
    const result = hasProjectAgentProvenance(`${nestedDirectory}/member`, "project-agent")

    // then: the nearer snapshot blocks the older ancestor
    expect(result).toBe(false)
  })

  test("rejects when the nearest snapshot is empty", () => {
    // given: an older matching snapshot and a nearer empty snapshot
    const projectDirectory = "/tmp/test-project-agent-provenance-empty"
    const nestedDirectory = `${projectDirectory}/nested`
    replaceProjectAgentProvenance(projectDirectory, ["project-agent"])
    replaceProjectAgentProvenance(nestedDirectory, [])

    // when: provenance is checked below the nearer snapshot
    const result = hasProjectAgentProvenance(`${nestedDirectory}/member`, "project-agent")

    // then: the empty snapshot blocks the older ancestor
    expect(result).toBe(false)
  })

  test("rejects a sibling-prefix path", () => {
    // given: a registered project and a sibling whose name shares its prefix
    const projectDirectory = "/tmp/test-project-agent-provenance-sibling"
    replaceProjectAgentProvenance(projectDirectory, ["project-agent"])

    // when: provenance is checked from the sibling-prefix path
    const result = hasProjectAgentProvenance(`${projectDirectory}-other/member`, "project-agent")

    // then: lexical prefix similarity does not authorize the sibling
    expect(result).toBe(false)
  })

  test("narrows final task allow to the member launch deny overlay", async () => {
    // given: a final project agent that unconditionally allows task
    const directory = "/tmp/test-registry-task-allow"
    replaceProjectAgentProvenance(directory, ["opencode-agent"])
    const mockClient: FinalOpenCodeAgentRegistryClient = {
      app: {
        agents: async () => [{
          name: "opencode-agent",
          mode: "all",
          native: false,
          hidden: false,
          permission: createPermissionRules("allow"),
        }],
      },
    }

    // when: the agent is resolved with the member launch permission overlay
    const result = await resolveFinalProjectAgent(mockClient, directory, "opencode-agent")

    // then: the enforcing task false overlay may narrow the final allow
    expect(result).toEqual({ name: "opencode-agent", model: undefined })
  })

  test("tolerates null hidden, variant, and model from OpenCode output", async () => {
    // given: OpenCode serializes absent optional fields as null
    const directory = "/tmp/test-registry-null-fields"
    replaceProjectAgentProvenance(directory, ["opencode-agent"])
    const mockClient: FinalOpenCodeAgentRegistryClient = {
      app: {
        agents: async () => [{
          name: "opencode-agent",
          mode: "subagent",
          native: false,
          hidden: null,
          model: null,
          variant: null,
          permission: createPermissionRules(),
        }],
      },
    }

    // when: the nullable final registry entry is resolved
    const result = await resolveFinalProjectAgent(mockClient, directory, "opencode-agent")

    // then: null optional fields are accepted and null model is treated as absent
    expect(result).toEqual({ name: "opencode-agent", model: undefined })
  })
})
