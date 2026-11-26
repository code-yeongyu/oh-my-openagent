/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import * as connectedProvidersCache from "../../../shared/connected-providers-cache"
import * as agentLoader from "../../../features/claude-code-agent-loader"
import type { ExecutorContext } from "../executor-types"
import type { DelegateTaskArgs } from "../types"

type SubagentResolverModule = typeof import("../subagent-resolver")

type ClaudeCodeAgentRecord = ReturnType<typeof agentLoader.loadUserAgents>

const readConnectedProvidersCacheMock = mock(() => null as string[] | null)
const readProviderModelsCacheMock = mock(
  () =>
    null as {
      models: Record<string, string[]>
      connected: string[]
      updatedAt: string
    } | null,
)
const loadUserAgentsMock = mock((): ClaudeCodeAgentRecord => ({}))
const loadProjectAgentsMock = mock((_directory?: string): ClaudeCodeAgentRecord => ({}))

async function importFreshSubagentResolverModule(): Promise<SubagentResolverModule> {
  return await import(`../subagent-resolver?test=${Date.now()}-${Math.random()}`)
}

function createBaseArgs(overrides?: Partial<DelegateTaskArgs>): DelegateTaskArgs {
  return {
    description: "Run review",
    prompt: "Review the current changes",
    run_in_background: false,
    load_skills: [],
    subagent_type: "claude-reviewer",
    ...overrides,
  }
}

function createExecutorContext(overrides?: Partial<ExecutorContext>): ExecutorContext {
  const client = {
    app: {
      agents: async () => [{ name: "oracle", mode: "subagent" }],
    },
  } as ExecutorContext["client"]

  return {
    client,
    manager: {} as ExecutorContext["manager"],
    directory: "/tmp/test",
    ...overrides,
  }
}

describe("resolveSubagentExecution claude_code.agents toggle", () => {
  let resolveSubagentExecution: SubagentResolverModule["resolveSubagentExecution"]

  beforeEach(async () => {
    mock.restore()
    readConnectedProvidersCacheMock.mockReset()
    readProviderModelsCacheMock.mockReset()
    readConnectedProvidersCacheMock.mockReturnValue(null)
    readProviderModelsCacheMock.mockReturnValue(null)
    loadUserAgentsMock.mockReset()
    loadProjectAgentsMock.mockReset()
    loadUserAgentsMock.mockImplementation(() => ({
      "claude-reviewer": { description: "User Claude Code agent", mode: "subagent" },
    }))
    loadProjectAgentsMock.mockImplementation(() => ({
      "claude-reviewer": { description: "Project Claude Code agent", mode: "subagent" },
    }))
    spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockImplementation(readConnectedProvidersCacheMock)
    spyOn(connectedProvidersCache, "readProviderModelsCache").mockImplementation(readProviderModelsCacheMock)
    spyOn(connectedProvidersCache, "hasConnectedProvidersCache").mockImplementation(
      () => readConnectedProvidersCacheMock() !== null,
    )
    spyOn(connectedProvidersCache, "hasProviderModelsCache").mockImplementation(
      () => readProviderModelsCacheMock() !== null,
    )
    spyOn(agentLoader, "loadUserAgents").mockImplementation(loadUserAgentsMock)
    spyOn(agentLoader, "loadProjectAgents").mockImplementation(loadProjectAgentsMock)
    ;({ resolveSubagentExecution } = await importFreshSubagentResolverModule())
  })

  afterEach(() => {
    mock.restore()
  })

  test("does not read .claude/agents when claude_code.agents is false", async () => {
    //#given
    const args = createBaseArgs()
    const executorCtx = createExecutorContext({ claudeCodeAgentsEnabled: false })

    //#when
    const result = await resolveSubagentExecution(args, executorCtx, "sisyphus", "deep")

    //#then
    expect(loadUserAgentsMock).not.toHaveBeenCalled()
    expect(loadProjectAgentsMock).not.toHaveBeenCalled()
    expect(result.agentToUse).toBe("")
    expect(result.error).toBe('Unknown agent: "claude-reviewer". Available agents: oracle')
  })

  test("still resolves server agents when claude_code.agents is false", async () => {
    //#given
    const args = createBaseArgs({ subagent_type: "oracle" })
    const executorCtx = createExecutorContext({ claudeCodeAgentsEnabled: false })

    //#when
    const result = await resolveSubagentExecution(args, executorCtx, "sisyphus", "deep")

    //#then
    expect(loadUserAgentsMock).not.toHaveBeenCalled()
    expect(loadProjectAgentsMock).not.toHaveBeenCalled()
    expect(result.error).toBeUndefined()
    expect(result.agentToUse).toBe("oracle")
  })

  test.each([
    { label: "unset", claudeCodeAgentsEnabled: undefined },
    { label: "true", claudeCodeAgentsEnabled: true },
  ])("merges .claude/agents when claude_code.agents is $label", async ({ claudeCodeAgentsEnabled }) => {
    //#given
    const args = createBaseArgs()
    const executorCtx = createExecutorContext({ claudeCodeAgentsEnabled })

    //#when
    const result = await resolveSubagentExecution(args, executorCtx, "sisyphus", "deep")

    //#then
    expect(loadUserAgentsMock).toHaveBeenCalled()
    expect(loadProjectAgentsMock).toHaveBeenCalledWith("/tmp/test")
    expect(result.error).toBeUndefined()
    expect(result.agentToUse).toBe("claude-reviewer")
  })
})
