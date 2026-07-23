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
    expect(restrictions.call_omo_agent).toBe(false)
    expect(restrictions.look_at).toBe(false)
  })

  describe("Oracle", () => {
    test("denies all file-writing tools", () => {
      // given
      const agent = createOracleAgent(TEST_MODEL)

      // when
      const permission = agent.permission as Record<string, string>

      // then
      for (const tool of FILE_WRITE_TOOLS) {
        expect(permission[tool]).toBe("deny")
      }
    })

    test("denies spawn tools at the session boundary", () => {
      // given
      const agent = createOracleAgent(TEST_MODEL)

      // when
      const permission = agent.permission as Record<string, string>

      // then
      const sessionRestrictions = getAgentToolRestrictions("oracle")

      expect(permission["task"]).toBe("deny")
      expect(sessionRestrictions["task"]).toBe(false)
      expect(sessionRestrictions["call_omo_agent"]).toBe(false)
      expect(sessionRestrictions["look_at"]).toBe(false)
    })
  })

  describe("Librarian", () => {
    test("denies all file-writing tools", () => {
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
    test("denies all file-writing tools", () => {
      // given
      const agent = createExploreAgent(TEST_MODEL)

      // when
      const permission = agent.permission as Record<string, string>

      // then
      for (const tool of FILE_WRITE_TOOLS) {
        expect(permission[tool]).toBe("deny")
      }
    })
  })

  describe("Momus", () => {
    test("denies all file-writing tools", () => {
      // given
      const agent = createMomusAgent(TEST_MODEL)

      // when
      const permission = agent.permission as Record<string, string>

      // then
      for (const tool of FILE_WRITE_TOOLS) {
        expect(permission[tool]).toBe("deny")
      }
    })

    test("denies spawn tools consistently with reviewer admission", () => {
      // given
      const agent = createMomusAgent(TEST_MODEL)

      // when
      const permission = agent.permission as Record<string, string>
      const sessionRestrictions = getAgentToolRestrictions("momus")

      // then
      expect(permission["task"]).toBeUndefined()
      expect(sessionRestrictions["task"]).toBe(false)
      expect(sessionRestrictions["call_omo_agent"]).toBe(false)
      expect(sessionRestrictions["look_at"]).toBe(false)
    })
  })

  describe("Metis", () => {
    test("denies all file-writing tools", () => {
      // given
      const agent = createMetisAgent(TEST_MODEL)

      // when
      const permission = agent.permission as Record<string, string>

      // then
      for (const tool of FILE_WRITE_TOOLS) {
        expect(permission[tool]).toBe("deny")
      }
    })

    test("denies spawn tools consistently with specialist admission", () => {
      // given
      const agent = createMetisAgent(TEST_MODEL)

      // when
      const permission = agent.permission as Record<string, string>
      const sessionRestrictions = getAgentToolRestrictions("metis")

      // then
      expect(permission["task"]).toBeUndefined()
      expect(sessionRestrictions["task"]).toBe(false)
      expect(sessionRestrictions["call_omo_agent"]).toBe(false)
      expect(sessionRestrictions["look_at"]).toBe(false)
    })
  })

  describe("Atlas", () => {
    test("allows delegation tools for orchestration", () => {
      // given
      const agent = createAtlasAgent({ model: TEST_MODEL })

      // when
      const permission = (agent.permission ?? {}) as Record<string, string>
      const sessionRestrictions = getAgentToolRestrictions("atlas")

      // then
      expect(permission["task"]).toBeUndefined()
      expect(permission["call_omo_agent"]).toBeUndefined()
      expect(sessionRestrictions["task"]).toBeUndefined()
      expect(sessionRestrictions["call_omo_agent"]).toBeUndefined()
      expect(sessionRestrictions["look_at"]).toBeUndefined()
    })
  })

  describe("Hephaestus", () => {
    test("denies spawn tools consistently with worker admission", () => {
      // given / when
      const restrictions = getAgentToolRestrictions("hephaestus")

      // then
      expect(restrictions.task).toBe(false)
      expect(restrictions.call_omo_agent).toBe(false)
      expect(restrictions.look_at).toBe(false)
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
