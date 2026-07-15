/// <reference types="bun-types" />

import { expect, mock, test } from "bun:test"

import type { ExecutorContext } from "../../../tools/delegate-task/executor-types"
import type { OmoAgentClient } from "../../../tools/delegate-task/types"
import type { Member } from "../types"
import {
  ProjectAgentMemberError,
  resolveProjectAgentMember,
} from "./project-agent-member"
import {
  createResolveMember,
  type ResolveMemberDependencies,
  TeamMemberResolutionError,
} from "./resolve-member"

type NativeAgentFixture = {
  readonly name: string
  readonly mode: "subagent" | "primary"
  readonly native: true
  readonly permission: readonly [{
    readonly permission: "*"
    readonly pattern: "*"
    readonly action: "allow"
  }]
}

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

function createContext(appAgents: OmoAgentClient["app"]["agents"]): ExecutorContext {
  return {
    client: createClient(appAgents),
    directory: "/repository-member-worktree",
    manager: {} as ExecutorContext["manager"],
  }
}

function createMember(subagentType: string): Extract<Member, { kind: "subagent_type" }> {
  return {
    backendType: "in-process",
    isActive: true,
    kind: "subagent_type",
    name: "reviewer",
    subagent_type: subagentType,
  }
}

function createNativeAgent(name: string, mode: NativeAgentFixture["mode"]): NativeAgentFixture {
  return {
    name,
    mode,
    native: true,
    permission: [{ permission: "*", pattern: "*", action: "allow" }],
  }
}

for (const [agentName, mode] of [["general", "subagent"], ["build", "primary"]] as const) {
  test(`returns a typed rejection for native ${agentName}`, async () => {
    // given
    const appAgents = mock(async () => ({ data: [createNativeAgent(agentName, mode)] }))
    const context = createContext(appAgents)
    const member = createMember(agentName)

    // when
    const resolution = resolveProjectAgentMember(member, context, {
      directory: context.directory,
      isLead: false,
    })

    // then
    await expect(resolution).rejects.toBeInstanceOf(ProjectAgentMemberError)
  })

  test(`rejects native ${agentName} before legacy subagent resolution`, async () => {
    // given
    const appAgents = mock(async () => ({ data: [createNativeAgent(agentName, mode)] }))
    const context = createContext(appAgents)
    const member = createMember(agentName)
    const resolveSubagentExecution = mock<ResolveMemberDependencies["resolveSubagentExecution"]>(async () => ({
      agentToUse: agentName,
      categoryModel: undefined,
      fallbackChain: undefined,
    }))
    const resolveMember = createResolveMember({
      buildSystemContent: mock(() => "unused"),
      resolveCategoryExecution: mock<ResolveMemberDependencies["resolveCategoryExecution"]>(),
      resolveProjectAgentMember,
      resolveSubagentExecution,
    })

    // when
    const resolution = resolveMember(member, context, {
      directory: context.directory,
      isLead: false,
    })

    // then
    await expect(resolution).rejects.toBeInstanceOf(TeamMemberResolutionError)
    expect(resolveSubagentExecution).not.toHaveBeenCalled()
  })
}
