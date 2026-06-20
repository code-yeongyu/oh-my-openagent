/// <reference types="bun-types" />

import { describe, test, expect } from "bun:test"
import { createOracleAgent } from "./oracle"
import { createLibrarianAgent } from "./librarian"
import { createExploreAgent } from "./explore"
import { createMomusAgent } from "./momus"
import { createMetisAgent } from "./metis"
import { createAtlasAgent } from "./atlas"
import { createSisyphusAgent } from "./sisyphus"
import { createHephaestusAgent } from "./hephaestus"
import { getAgentToolRestrictions } from "../shared/agent-tool-restrictions"

const TEST_MODEL = "anthropic/claude-sonnet-4-5"
const TEAM_TOOL_NAMES = [
  "team_create",
  "team_delete",
  "team_shutdown_request",
  "team_approve_shutdown",
  "team_reject_shutdown",
  "team_send_message",
  "team_task_create",
  "team_task_list",
  "team_task_update",
  "team_task_get",
  "team_status",
  "team_list",
] as const

describe("read-only agent tool restrictions", () => {
  const FILE_WRITE_TOOLS = ["write", "edit", "apply_patch"]
  // tools that must NOT be reachable on a deny-all allowlist agent: bash leaks
  // (echo > file, sed -i) and MCP write tools were the actual bypass paths.
  const LEAK_TOOLS = ["bash", "mcpm_morphllm-fast-apply_edit_file"]
  const REQUIRED_READ_TOOLS = ["read", "grep", "glob", "list"]

  const expectDenyAllAllowlist = (permission: Record<string, string>) => {
    expect(permission["*"]).toBe("deny")
    for (const tool of [...FILE_WRITE_TOOLS, ...LEAK_TOOLS]) {
      expect(permission[tool]).not.toBe("allow")
    }
    for (const tool of REQUIRED_READ_TOOLS) {
      expect(permission[tool]).toBe("allow")
    }
  }

  test("denies team tools for every delegated subagent prompt", () => {
    // given
    const restrictedAgentNames = [
      "explore",
      "librarian",
      "oracle",
      "metis",
      "momus",
      "multimodal-looker",
      "sisyphus-junior",
      "custom-worker",
    ]

    // when
    const restrictions = restrictedAgentNames.map((agentName) => getAgentToolRestrictions(agentName))

    // then
    for (const restriction of restrictions) {
      for (const toolName of TEAM_TOOL_NAMES) {
        expect(restriction[toolName]).toBe(false)
      }
    }
  })

  test("allows team tools for team member prompt restrictions", () => {
    // given
    const teamMemberAgentName = "sisyphus-junior"

    // when
    const restrictions = getAgentToolRestrictions(teamMemberAgentName, { includeTeamToolDenylist: false })

    // then
    for (const toolName of TEAM_TOOL_NAMES) {
      expect(restrictions[toolName]).toBeUndefined()
    }
    expect(restrictions.task).toBe(false)
  })

  describe("Oracle", () => {
    test("uses deny-all allowlist blocking bash and MCP writers", () => {
      // given
      const agent = createOracleAgent(TEST_MODEL)

      // when
      const permission = agent.permission as Record<string, string>

      // then
      expectDenyAllAllowlist(permission)
    })

    test("does not grant task or call_omo_agent", () => {
      // given
      const agent = createOracleAgent(TEST_MODEL)

      // when
      const permission = agent.permission as Record<string, string>

      // then
      expect(permission["task"]).not.toBe("allow")
      expect(permission["call_omo_agent"]).not.toBe("allow")
    })
  })

  describe("Librarian", () => {
    test("denies all file-writing tools (blocklist: needs bash for gh/git)", () => {
      // given
      const agent = createLibrarianAgent(TEST_MODEL)

      // when
      const permission = agent.permission as Record<string, string>

      // then
      for (const tool of FILE_WRITE_TOOLS) {
        expect(permission[tool]).toBe("deny")
      }
    })
  })

  describe("Explore", () => {
    test("uses deny-all allowlist blocking bash and MCP writers", () => {
      // given
      const agent = createExploreAgent(TEST_MODEL)

      // when
      const permission = agent.permission as Record<string, string>

      // then
      expectDenyAllAllowlist(permission)
    })
  })

  describe("Momus", () => {
    test("uses deny-all allowlist blocking bash and MCP writers", () => {
      // given
      const agent = createMomusAgent(TEST_MODEL)

      // when
      const permission = agent.permission as Record<string, string>

      // then
      expectDenyAllAllowlist(permission)
    })

    test("does not grant task delegation and stays ineligible for team membership", () => {
      // given
      const agent = createMomusAgent(TEST_MODEL)

      // when
      const permission = agent.permission as Record<string, string>
      const sessionRestrictions = getAgentToolRestrictions("momus")

      // then
      expect(permission["task"]).not.toBe("allow")
      expect(sessionRestrictions["task"]).toBeUndefined()
    })
  })

  describe("Metis", () => {
    test("uses deny-all allowlist blocking bash and MCP writers", () => {
      // given
      const agent = createMetisAgent(TEST_MODEL)

      // when
      const permission = agent.permission as Record<string, string>

      // then
      expectDenyAllAllowlist(permission)
    })

    test("does not grant task delegation and stays ineligible for team membership", () => {
      // given
      const agent = createMetisAgent(TEST_MODEL)

      // when
      const permission = agent.permission as Record<string, string>
      const sessionRestrictions = getAgentToolRestrictions("metis")

      // then
      expect(permission["task"]).not.toBe("allow")
      expect(sessionRestrictions["task"]).toBeUndefined()
    })
  })

  describe("Atlas", () => {
    test("allows delegation tools for orchestration", () => {
      // given
      const agent = createAtlasAgent({ model: TEST_MODEL })

      // when
      const permission = (agent.permission ?? {}) as Record<string, string>

      // then
      expect(permission["task"]).toBeUndefined()
      expect(permission["call_omo_agent"]).toBeUndefined()
    })
  })

  describe("Sisyphus GPT variants", () => {
    test("does not force-deny apply_patch for GPT or Claude models", () => {
      // given
      const gpt54Agent = createSisyphusAgent("openai/gpt-5.4")
      const gptGenericAgent = createSisyphusAgent("openai/gpt-5.5")
      const claudeAgent = createSisyphusAgent(TEST_MODEL)

      // when
      const gpt54Permission = (gpt54Agent.permission ?? {}) as Record<string, string>
      const gptGenericPermission = (gptGenericAgent.permission ?? {}) as Record<string, string>
      const claudePermission = (claudeAgent.permission ?? {}) as Record<string, string>

      // then
      expect(gpt54Permission["apply_patch"]).toBeUndefined()
      expect(gptGenericPermission["apply_patch"]).toBeUndefined()
      expect(claudePermission["apply_patch"]).toBeUndefined()
    })
  })

  describe("Sisyphus and Hephaestus frontier tool schema restrictions", () => {
    test("deny grep and glob for Opus 4.7 and GPT 5.5 models", () => {
      // given
      const frontierAgents = [
        createSisyphusAgent("anthropic/claude-opus-4-7"),
        createSisyphusAgent("anthropic/claude-opus-4.7"),
        createSisyphusAgent("openai/gpt-5.5"),
        createHephaestusAgent("openai/gpt-5.5"),
      ]

      // when
      const permissions = frontierAgents.map(
        (agent) => (agent.permission ?? {}) as Record<string, string>,
      )

      // then
      for (const permission of permissions) {
        expect(permission.grep).toBe("deny")
        expect(permission.glob).toBe("deny")
      }
    })

    test("keeps grep and glob available for other models", () => {
      // given
      const otherAgents = [
        createSisyphusAgent("anthropic/claude-sonnet-4-5"),
        createSisyphusAgent("openai/gpt-5.4"),
        createHephaestusAgent("openai/gpt-5.4"),
      ]

      // when
      const permissions = otherAgents.map(
        (agent) => (agent.permission ?? {}) as Record<string, string>,
      )

      // then
      for (const permission of permissions) {
        expect(permission.grep).toBeUndefined()
        expect(permission.glob).toBeUndefined()
      }
    })
  })
})
