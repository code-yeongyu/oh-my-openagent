/// <reference types="bun-types" />

import { readFileSync } from "node:fs"
import { beforeEach, describe, expect, mock, test } from "bun:test"
import type { ExecutorContext } from "../../../tools/delegate-task/executor-types"
import type { Member } from "../types"
import {
  createResolveMember,
  TeamMemberResolutionError,
  type ResolveMemberDependencies,
} from "./resolve-member"

const resolveCategoryExecutionMock = mock<ResolveMemberDependencies["resolveCategoryExecution"]>()
const resolveSubagentExecutionMock = mock<ResolveMemberDependencies["resolveSubagentExecution"]>()
const buildSystemContentMock = mock<ResolveMemberDependencies["buildSystemContent"]>(
  () => "resolved-system-content",
)

const resolveMember = createResolveMember({
  resolveCategoryExecution: (...args) => resolveCategoryExecutionMock(...args),
  resolveSubagentExecution: (...args) => resolveSubagentExecutionMock(...args),
  buildSystemContent: (...args) => buildSystemContentMock(...args),
  resolveProjectAgentMember: async () => undefined,
})

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
      modelInfo: undefined,
      actualModel: "openai/gpt-5.4",
      isUnstableAgent: false,
      fallbackChain: [{ providers: ["openai"], model: "gpt-5.4-mini" }],
    })

    // when
    const result = await resolveMember(member, createExecutorContext(), {
      categoryExamples: "deep, quick",
      directory: "/tmp/team-mode-test",
      isLead: false,
    })

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
    }
    resolveCategoryExecutionMock.mockResolvedValue({
      agentToUse: "sisyphus-junior",
      categoryModel: { providerID: "openai", modelID: "gpt-5.5", variant: "xhigh" },
      categoryPromptAppend: "appendix",
      maxPromptTokens: 256,
      modelInfo: undefined,
      actualModel: "openai/gpt-5.5",
      isUnstableAgent: false,
      fallbackChain: [],
    })

    // when
    await resolveMember(member, ctxWithJuniorOverride, {
      categoryExamples: "ultrabrain, deep",
      directory: "/tmp/team-mode-test",
      isLead: false,
    })

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
    const result = await resolveMember(member, createExecutorContext(), {
      categoryExamples: "deep, quick",
      directory: "/tmp/team-mode-test",
      isLead: false,
      parentAgent: "sisyphus",
    })

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

  test("throws TeamMemberResolutionError without category fallback when built-in subagent resolution fails", async () => {
    // given
    const member = {
      backendType: "in-process",
      isActive: true,
      kind: "subagent_type",
      name: "atlas-error",
      subagent_type: "atlas",
    } satisfies Member

    resolveSubagentExecutionMock.mockRejectedValue(new Error("unknown agent"))

    // when
    const result = resolveMember(member, createExecutorContext(), {
      categoryExamples: "deep, quick",
      directory: "/tmp/team-mode-test",
      isLead: false,
    })

    // then
    await expect(result).rejects.toBeInstanceOf(TeamMemberResolutionError)
    await expect(result).rejects.toThrow("Failed to resolve member 'atlas-error': unknown agent")
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
      modelInfo: undefined,
      actualModel: "openai/gpt-5.4",
      isUnstableAgent: false,
      fallbackChain: [],
    })
    resolveSubagentExecutionMock.mockResolvedValue({
      agentToUse: "atlas",
      categoryModel: { providerID: "openai", modelID: "gpt-5.4-mini" },
      fallbackChain: [],
    })
    const source = readFileSync(new URL("./resolve-member.ts", import.meta.url), "utf8")

    // when
    await resolveMember(categoryMember, createExecutorContext(), {
      categoryExamples: "deep, quick",
      directory: "/tmp/team-mode-test",
      isLead: false,
    })
    await resolveMember(subagentMember, createExecutorContext(), {
      categoryExamples: "deep, quick",
      directory: "/tmp/team-mode-test",
      isLead: false,
    })

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
    expect(source).toContain("dependencies.buildSystemContent")
    expect(source).not.toContain("member.prompt +")
    expect(source).not.toContain("+ member.prompt")
    expect(source).not.toContain(".join(")
  })
})
