/// <reference types="bun-types" />

const { describe, expect, mock, test, beforeEach } = await import("bun:test")
import type { ExecutorContext } from "../../../tools/delegate-task/executor-types"
import type { Member } from "../types"

const resolveCategoryExecutionMock = mock()
const resolveSubagentExecutionMock = mock()
const buildSystemContentMock = mock(() => "resolved-system-content")

mock.module("./resolve-member-dependencies", () => ({
  resolveCategoryExecution: resolveCategoryExecutionMock,
  resolveSubagentExecution: resolveSubagentExecutionMock,
  buildSystemContent: buildSystemContentMock,
}))

const { resolveMember, TeamMemberResolutionError } = await import("./resolve-member")

function createExecutorContext(): ExecutorContext {
  return {
    client: {} as ExecutorContext["client"],
    manager: {} as ExecutorContext["manager"],
    directory: "/tmp/team-mode-test",
  }
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
      disabledProviders: ["github-copilot"],
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
    expect(executorCtxArg.disabledProviders).toEqual(["github-copilot"])
  })

  test("forwards category member runtime model and variant while stripping only the global junior override", async () => {
    // given
    const member = {
      backendType: "in-process",
      isActive: true,
      kind: "category",
      name: "architect",
      category: "deep",
      prompt: "design X",
      model: "openai/gpt-5.5",
      variant: "xhigh",
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
    await resolveMember(member, ctxWithJuniorOverride, "deep, quick")

    // then
    const [argsArg, executorCtxArg] = resolveCategoryExecutionMock.mock.calls[0]
    expect(argsArg.model).toBe("openai/gpt-5.5")
    expect(argsArg.variant).toBe("xhigh")
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
  })

  test("forwards subagent member runtime model and variant", async () => {
    // given
    const member = {
      backendType: "in-process",
      isActive: true,
      kind: "subagent_type",
      name: "m2",
      subagent_type: "atlas",
      prompt: "addendum",
      model: "openai/gpt-5.4",
      variant: "xhigh",
    } satisfies Member

    resolveSubagentExecutionMock.mockResolvedValue({
      agentToUse: "atlas",
      categoryModel: { providerID: "openai", modelID: "gpt-5.4", variant: "xhigh" },
      fallbackChain: [],
    })

    // when
    await resolveMember(member, createExecutorContext(), "deep, quick", "sisyphus")

    // then
    const [argsArg] = resolveSubagentExecutionMock.mock.calls[0]
    expect(argsArg).toMatchObject({
      subagent_type: "atlas",
      model: "openai/gpt-5.4",
      variant: "xhigh",
    })
  })

  test("throws TeamMemberResolutionError without category fallback when subagent resolution fails", async () => {
    // given
    const member = {
      backendType: "in-process",
      isActive: true,
      kind: "subagent_type",
      name: "unknown",
      subagent_type: "unknown-agent",
    } satisfies Member

    resolveSubagentExecutionMock.mockRejectedValue(new Error("unknown agent"))

    // when
    let caught: unknown
    try {
      await resolveMember(member, createExecutorContext(), "deep, quick")
    } catch (error) {
      caught = error
    }

    // then
    expect(caught).toBeInstanceOf(TeamMemberResolutionError)
    expect(caught instanceof Error ? caught.message : String(caught)).toBe("Failed to resolve member 'unknown': unknown agent")
    expect(resolveCategoryExecutionMock).not.toHaveBeenCalled()
  })

  test("reuses buildSystemContent for both resolution kinds without custom prompt concatenation", async () => {
    // given
    const categoryMember = {
      backendType: "in-process",
      isActive: true,
      kind: "category",
      name: "m1",
      category: "deep",
      prompt: "impl X",
    } satisfies Member
    const subagentMember = {
      backendType: "in-process",
      isActive: true,
      kind: "subagent_type",
      name: "m2",
      subagent_type: "atlas",
      prompt: "addendum",
    } satisfies Member

    resolveCategoryExecutionMock.mockResolvedValue({
      agentToUse: "sisyphus-junior",
      categoryModel: { providerID: "openai", modelID: "gpt-5.4" },
      categoryPromptAppend: "appendix",
      maxPromptTokens: 128,
      fallbackChain: [],
    })
    resolveSubagentExecutionMock.mockResolvedValue({
      agentToUse: "atlas",
      categoryModel: { providerID: "openai", modelID: "gpt-5.4-mini" },
      fallbackChain: [],
    })
    const source = await Bun.file(new URL("./resolve-member.ts", import.meta.url)).text()

    // when
    await resolveMember(categoryMember, createExecutorContext(), "deep, quick")
    await resolveMember(subagentMember, createExecutorContext(), "deep, quick")

    // then
    expect(buildSystemContentMock).toHaveBeenCalledTimes(2)
    expect(buildSystemContentMock).toHaveBeenNthCalledWith(1, {
      agentName: "sisyphus-junior",
      categoryPromptAppend: "appendix",
      maxPromptTokens: 128,
      model: { providerID: "openai", modelID: "gpt-5.4" },
    })
    expect(buildSystemContentMock).toHaveBeenNthCalledWith(2, {
      agentName: "atlas",
      categoryPromptAppend: undefined,
      maxPromptTokens: undefined,
      model: { providerID: "openai", modelID: "gpt-5.4-mini" },
    })
    expect(source).toContain("buildSystemContent({")
    expect(source).not.toContain("member.prompt +")
    expect(source).not.toContain("+ member.prompt")
    expect(source).not.toContain(".join(")
  })
})
