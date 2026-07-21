/// <reference types="bun-types" />

import { beforeEach, describe, expect, mock, test } from "bun:test"
import { randomUUID } from "node:crypto"

import type { Agent, PermissionRuleset } from "@opencode-ai/sdk/v2"

import { unsafeTestValue } from "../../../../../../test-support/unsafe-test-value"
import type { ExecutorContext } from "../../../tools/delegate-task/executor-types"
import { replaceProjectAgentProvenance } from "../final-open-code-agent-registry"
import type { Member } from "../types"

const resolveCategoryExecutionMock = mock()
const resolveSubagentExecutionMock = mock()
const buildSystemContentMock = mock(() => "resolved-system-content")

mock.module("./resolve-member-dependencies", () => ({
  resolveCategoryExecution: resolveCategoryExecutionMock,
  resolveSubagentExecution: resolveSubagentExecutionMock,
  buildSystemContent: buildSystemContentMock,
}))

const { resolveMember, TeamMemberResolutionError } = await import("./resolve-member?resolve-member-test")

const TEAM_TOOLS = ["team_send_message", "team_task_list", "team_task_get", "team_task_update", "team_status"] as const

type ContextFixture = Readonly<{ context: ExecutorContext; appAgents: ReturnType<typeof mock>; configGet: ReturnType<typeof mock>; sessionGet: ReturnType<typeof mock> }>

function createExecutorContext(directory = "/tmp/team-mode-test"): ExecutorContext {
  return {
    client: unsafeTestValue<ExecutorContext["client"]>({}),
    manager: unsafeTestValue<ExecutorContext["manager"]>({}),
    directory,
  }
}

function createPermissionRules(): PermissionRuleset {
  return TEAM_TOOLS.map((permission) => ({ permission, pattern: "*", action: "allow" }))
}

function createFinalAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    name: "project-worker", mode: "subagent", native: false, hidden: false,
    permission: createPermissionRules(),
    model: { providerID: "openai", modelID: "gpt-5.4-mini" },
    variant: "high", options: {}, ...overrides,
  }
}

function createProjectMember(name = "worker"): Member {
  return {
    kind: "subagent_type", name, subagent_type: "project-worker",
    backendType: "in-process", isActive: true,
  }
}

function createRegistryContext(directory: string, response: unknown): ContextFixture {
  const context = createExecutorContext(directory)
  const appAgents = mock(async () => response)
  const configGet = mock(async () => ({ data: { permission: { "*": "allow" } } }))
  const sessionGet = mock(async () => ({ data: { directory, permission: [] } }))
  Object.assign(context.client, {
    app: { agents: appAgents },
    config: { get: configGet },
    session: { get: sessionGet },
  })
  return { context, appAgents, configGet, sessionGet }
}

function createProvenRegistryContext(response: unknown): ContextFixture {
  const directory = `/tmp/project-agent-${randomUUID()}`
  replaceProjectAgentProvenance(directory, ["project-worker"])
  return createRegistryContext(directory, response)
}

describe("resolveMember", () => {
  beforeEach(() => {
    mock.restore()
    resolveCategoryExecutionMock.mockReset()
    resolveSubagentExecutionMock.mockReset()
    buildSystemContentMock.mockReset()
    buildSystemContentMock.mockImplementation(() => "resolved-system-content")
  })

  test("routes category members through resolveCategoryExecution", async () => {
    // given
    const member = {
      backendType: "in-process",
      isActive: true,
      kind: "category",
      name: "m1",
      category: "deep",
      prompt: "impl X",
    } satisfies Member

    resolveCategoryExecutionMock.mockResolvedValue({
      agentToUse: "sisyphus-junior",
      categoryModel: { providerID: "openai", modelID: "gpt-5.4" },
      categoryPromptAppend: "appendix",
      maxPromptTokens: 512,
      fallbackChain: [{ providers: ["openai"], model: "gpt-5.4-mini" }],
    })

    // when
    const result = await resolveMember(member, createExecutorContext(), "deep, quick")

    // then
    expect(resolveCategoryExecutionMock).toHaveBeenCalledTimes(1)
    expect(resolveCategoryExecutionMock).toHaveBeenCalledWith(
      {
        category: "deep",
        description: "Resolve team member",
        load_skills: [],
        prompt: "impl X",
        run_in_background: false,
        subagent_type: "sisyphus-junior",
      },
      createExecutorContext(),
      undefined,
      undefined,
    )
    expect(resolveSubagentExecutionMock).not.toHaveBeenCalled()
    expect(result.agentToUse).toBe("sisyphus-junior")
    expect(result.systemContent).toBe("resolved-system-content")
    expect(buildSystemContentMock).toHaveBeenCalledWith({
      agentName: "sisyphus-junior",
      categoryPromptAppend: "appendix",
      maxPromptTokens: 512,
      model: { providerID: "openai", modelID: "gpt-5.4" },
    })
  })

  test("strips sisyphusJuniorModel before resolving category members so each declared category keeps its own model", async () => {
    // given
    const member = {
      backendType: "in-process",
      isActive: true,
      kind: "category",
      name: "architect",
      category: "ultrabrain",
      prompt: "design X",
    } satisfies Member
    const ctxWithJuniorOverride: ExecutorContext = {
      ...createExecutorContext(),
      sisyphusJuniorModel: "anthropic/claude-sonnet-4-6",
    }
    resolveCategoryExecutionMock.mockResolvedValue({
      agentToUse: "sisyphus-junior",
      categoryModel: { providerID: "openai", modelID: "gpt-5.5", variant: "xhigh" },
      categoryPromptAppend: "appendix",
      maxPromptTokens: 256,
      fallbackChain: [],
    })

    // when
    await resolveMember(member, ctxWithJuniorOverride, "ultrabrain, deep")

    // then
    const [, executorCtxArg] = resolveCategoryExecutionMock.mock.calls[0]
    expect(executorCtxArg.sisyphusJuniorModel).toBeUndefined()
  })

  test("routes subagent members through resolveSubagentExecution", async () => {
    // given
    const member = {
      backendType: "in-process",
      isActive: true,
      kind: "subagent_type",
      name: "m2",
      subagent_type: "atlas",
      prompt: "addendum",
    } satisfies Member

    resolveSubagentExecutionMock.mockResolvedValue({
      agentToUse: "atlas",
      categoryModel: { providerID: "openai", modelID: "gpt-5.4-mini" },
      fallbackChain: [{ providers: ["openai"], model: "gpt-5.4-nano" }],
    })

    // when
    const result = await resolveMember(member, createExecutorContext(), "deep, quick", "sisyphus")

    // then
    expect(resolveSubagentExecutionMock).toHaveBeenCalledTimes(1)
    expect(resolveSubagentExecutionMock).toHaveBeenCalledWith(
      {
        description: "Resolve team member",
        load_skills: [],
        prompt: "addendum",
        run_in_background: false,
        subagent_type: "atlas",
      },
      createExecutorContext(),
      "sisyphus",
      "deep, quick",
      {
        allowSisyphusJuniorDirect: true,
        allowPrimaryAgentDelegation: true,
      },
    )
    expect(resolveCategoryExecutionMock).not.toHaveBeenCalled()
    expect(result.agentToUse).toBe("atlas")
    expect(result.systemContent).toBe("resolved-system-content")
    expect(buildSystemContentMock).toHaveBeenCalledWith({
      agentName: "atlas",
      categoryPromptAppend: undefined,
      maxPromptTokens: undefined,
      model: { providerID: "openai", modelID: "gpt-5.4-mini" },
    })
  })

  test("throws TeamMemberResolutionError without category fallback when an unknown type has no project source", async () => {
    // given
    const member = {
      backendType: "in-process",
      isActive: true,
      kind: "subagent_type",
      name: "unknown",
      subagent_type: "unknown-agent",
    } satisfies Member

    // when
    const result = resolveMember(member, createExecutorContext(), "deep, quick")

    // then
    await expect(result).rejects.toBeInstanceOf(TeamMemberResolutionError)
    await expect(result).rejects.toThrow("has no config-time provenance")
    expect(resolveCategoryExecutionMock).not.toHaveBeenCalled()
    expect(resolveSubagentExecutionMock).not.toHaveBeenCalled()
  })

  test("resolves an exact proven project agent from the final registry without prompt or fallback injection", async () => {
    // given
    const fixture = createProvenRegistryContext({
      data: [createFinalAgent({
        permission: [{ permission: "team_*", pattern: "*", action: "allow" }],
      })],
    })

    // when
    const result = await resolveMember(createProjectMember(), fixture.context, "deep, quick", "lead")

    // then
    expect(result).toEqual({
      memberName: "worker",
      agentToUse: "project-worker",
      model: { providerID: "openai", modelID: "gpt-5.4-mini", variant: "high" },
      fallbackChain: undefined,
      systemContent: undefined,
    })
    expect(fixture.appAgents).toHaveBeenCalledWith({
      query: { directory: fixture.context.directory },
    })
    expect(resolveSubagentExecutionMock).not.toHaveBeenCalled()
    expect(buildSystemContentMock).not.toHaveBeenCalled()
  })

  test.each([
    ["a fuzzy registry name", { data: [createFinalAgent({ name: "Project Worker" })] }, "no exact final OpenCode registry entry"],
    ["a malformed registry", { data: { name: "project-worker" } }, "no exact final OpenCode registry entry"],
    ["a native agent", { data: [createFinalAgent({ native: true })] }, "native === false"],
    ["a hidden agent", { data: [createFinalAgent({ hidden: true })] }, "must not be hidden"],
    ["a primary-only agent", { data: [createFinalAgent({ mode: "primary" })] }, "mode must be 'subagent' or 'all'"],
    ["a missing team permission", { data: [createFinalAgent({ permission: createPermissionRules().filter((rule) => rule.permission !== "team_status") })] }, "must unconditionally allow team_status"],
    ["a later ask permission", { data: [createFinalAgent({ permission: [...createPermissionRules(), { permission: "team_status", pattern: "*", action: "ask" as const }] })] }, "must unconditionally allow team_status"],
    ["a later deny permission", { data: [createFinalAgent({ permission: [...createPermissionRules(), { permission: "team_status", pattern: "*", action: "deny" as const }] })] }, "must unconditionally allow team_status"],
  ])("rejects %s", async (_label, response, expectedMessage) => {
    // given
    const fixture = createProvenRegistryContext(response)

    // when
    const result = resolveMember(createProjectMember(), fixture.context, "deep, quick", "lead")

    // then
    await expect(result).rejects.toThrow(expectedMessage)
    expect(fixture.configGet).not.toHaveBeenCalled()
    expect(fixture.sessionGet).not.toHaveBeenCalled()
  })

  test("accepts a project agent without an explicit model", async () => {
    // given
    const { model: _model, variant: _variant, ...modelLessAgent } = createFinalAgent()
    const fixture = createProvenRegistryContext({ data: [modelLessAgent] })

    // when
    const result = await resolveMember(createProjectMember(), fixture.context, "deep, quick", "lead")

    // then
    expect(result.model).toBeUndefined()
  })

  test("rejects a project agent used as the team lead", async () => {
    // given
    const fixture = createProvenRegistryContext({ data: [createFinalAgent()] })

    // when
    const result = resolveMember(
      createProjectMember("project-lead"),
      fixture.context,
      "deep, quick",
      "project-lead",
    )

    // then
    await expect(result).rejects.toThrow("Project-defined agents cannot be team leads")
  })
})
