/// <reference types="bun-types" />

import { describe, expect, mock, test } from "bun:test"

import type { ExecutorContext } from "../../../tools/delegate-task/executor-types"
import type { OmoAgentClient } from "../../../tools/delegate-task/types"
import type { Member } from "../types"
import { ProjectAgentMemberError, resolveProjectAgentMember } from "./project-agent-member"

type AgentRule = {
  readonly permission: string
  readonly pattern: string
  readonly action: "allow" | "ask" | "deny"
}

type ProjectAgentFixture = {
  readonly name: string
  readonly mode: "subagent" | "primary" | "all"
  readonly hidden?: boolean
  readonly permission: readonly AgentRule[]
  readonly model?: {
    readonly providerID: string
    readonly modelID: string
  }
  readonly variant?: string
  readonly prompt?: string
}

const REQUIRED_TEAM_TOOLS = [
  "team_send_message",
  "team_task_list",
  "team_task_get",
  "team_task_update",
  "team_status",
] as const

function createClient(appAgents: OmoAgentClient["app"]["agents"]): OmoAgentClient {
  return {
    app: { agents: appAgents },
    config: { get: async () => ({}) },
    session: {
      abort: async () => ({}),
      create: async () => ({ data: { id: "unused-session" } }),
      get: async () => ({ data: {} }),
      messages: async () => [],
      status: async () => ({}),
    },
  }
}

function createContext(appAgents: OmoAgentClient["app"]["agents"]): Pick<ExecutorContext, "client"> {
  return {
    client: createClient(appAgents),
  }
}

function createMember(): Extract<Member, { kind: "subagent_type" }> {
  return {
    backendType: "in-process",
    isActive: true,
    kind: "subagent_type",
    name: "reviewer",
    subagent_type: "repository-reviewer",
  }
}

function createProjectAgent(overrides: Partial<ProjectAgentFixture> = {}): ProjectAgentFixture {
  return {
    name: "repository-reviewer",
    mode: "subagent",
    permission: [{ permission: "*", pattern: "*", action: "allow" }],
    model: { providerID: "openai", modelID: "gpt-5.6-sol" },
    variant: "xhigh",
    prompt: "Repository-specific review instructions.",
    ...overrides,
  }
}

describe("project agent Team Mode member resolution", () => {
  test("accepts nullable optional fields emitted by the final OpenCode agent registry", async () => {
    // given
    const appAgents = mock(async () => ({
      data: [
        {
          ...createProjectAgent({ name: "sisyphus" }),
          hidden: null,
          model: null,
          variant: null,
          prompt: null,
        },
        {
          ...createProjectAgent(),
          hidden: null,
        },
      ],
    }))

    // when
    const result = await resolveProjectAgentMember(createMember(), createContext(appAgents), {
      directory: "/repository-member-worktree",
      isLead: false,
    })

    // then
    expect(result?.agentToUse).toBe("repository-reviewer")
  })

  for (const mode of ["subagent", "all"] as const) {
    test(`preserves exact registry identity and model for a visible ${mode} read-only member`, async () => {
      // given
      const appAgents = mock(async (_input?: { readonly query?: { readonly directory?: string } }) => ({
        data: [createProjectAgent({
          mode,
          permission: [
            { permission: "*", pattern: "*", action: "allow" },
            { permission: "edit", pattern: "*", action: "deny" },
            { permission: "write", pattern: "*", action: "deny" },
            { permission: "apply_patch", pattern: "*", action: "deny" },
          ],
        })],
      }))

      // when
      const result = await resolveProjectAgentMember(createMember(), createContext(appAgents), {
        directory: "/repository-member-worktree",
        isLead: false,
      })

      // then
      expect(appAgents).toHaveBeenCalledWith({ query: { directory: "/repository-member-worktree" } })
      expect(result).toEqual({
        memberName: "reviewer",
        agentToUse: "repository-reviewer",
        exactAgent: true,
        model: { providerID: "openai", modelID: "gpt-5.6-sol", variant: "xhigh" },
        fallbackChain: undefined,
        systemContent: undefined,
      })
    })
  }

  test("rejects a member when an explicit required-tool deny follows wildcard allow", async () => {
    // given
    const appAgents = mock(async () => ({
      data: [createProjectAgent({
        permission: [
          { permission: "*", pattern: "*", action: "allow" },
          { permission: "team_status", pattern: "*", action: "deny" },
        ],
      })],
    }))

    // when
    const result = resolveProjectAgentMember(createMember(), createContext(appAgents), {
      directory: "/repository-member-worktree",
      isLead: false,
    })

    // then
    await expect(result).rejects.toBeInstanceOf(ProjectAgentMemberError)
    await expect(result).rejects.toThrow("team_status")
  })

  test("rejects hidden, primary, disabled, and incomplete project agents", async () => {
    for (const [label, agents] of [
      ["hidden", [createProjectAgent({ hidden: true })]],
      ["primary", [createProjectAgent({ mode: "primary" })]],
      ["disabled", []],
      ["incomplete", [createProjectAgent({
        permission: [
          { permission: "*", pattern: "*", action: "deny" },
          ...REQUIRED_TEAM_TOOLS.slice(0, -1).map((permission) => ({ permission, pattern: "*", action: "allow" as const })),
        ],
      })]],
    ] as const) {
      // given
      const appAgents = mock(async () => ({ data: agents }))

      // when
      const result = resolveProjectAgentMember(createMember(), createContext(appAgents), {
        directory: "/repository-member-worktree",
        isLead: false,
      })

      // then
      await expect(result, label).rejects.toBeInstanceOf(ProjectAgentMemberError)
    }
  })

  test("resolves only against the member worktree registry", async () => {
    // given
    const appAgents = mock(async (input?: { readonly query?: { readonly directory?: string } }) => ({
      data: input?.query?.directory === "/repository-parent" ? [createProjectAgent()] : [],
    }))

    // when
    const result = resolveProjectAgentMember(createMember(), createContext(appAgents), {
      directory: "/repository-member-worktree",
      isLead: false,
    })

    // then
    await expect(result).rejects.toThrow("repository-reviewer")
    expect(appAgents).toHaveBeenCalledWith({ query: { directory: "/repository-member-worktree" } })
  })

  test("rejects a valid project agent when selected as lead", async () => {
    // given
    const appAgents = mock(async () => ({ data: [createProjectAgent()] }))

    // when
    const result = resolveProjectAgentMember(createMember(), createContext(appAgents), {
      directory: "/repository-member-worktree",
      isLead: true,
    })

    // then
    await expect(result).rejects.toThrow("member-only")
  })

  test("keeps canonical collisions on the built-in resolution path", async () => {
    // given
    const appAgents = mock(async () => ({ data: [createProjectAgent({ name: "sisyphus" })] }))
    const member = { ...createMember(), subagent_type: "sisyphus" }

    // when
    const result = await resolveProjectAgentMember(member, createContext(appAgents), {
      directory: "/repository-member-worktree",
      isLead: false,
    })

    // then
    expect(appAgents).not.toHaveBeenCalled()
    expect(result).toBeUndefined()
  })
})
