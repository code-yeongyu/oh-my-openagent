/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import type { ExecutorContext } from "../executor-types"
import type { DelegateTaskArgs } from "../types"

type SubagentResolverModule = typeof import("../subagent-resolver")

type ClaudeCodeAgentRecord = Record<
  string,
  {
    description?: string
    mode?: string
    model?: string | { providerID: string; modelID: string }
  }
>

const logMock = mock((..._args: unknown[]) => {})
const readConnectedProvidersCacheMock = mock(() => null as string[] | null)
const readProviderModelsCacheMock = mock(
  () => null as {
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
      agents: async () => ([{ name: "oracle", mode: "subagent" }]),
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
    logMock.mockClear()
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
    mock.module("../../../shared/logger", () => ({
      log: logMock,
    }))
    mock.module("../../../shared/connected-providers-cache", () => ({
      readConnectedProvidersCache: readConnectedProvidersCacheMock,
      readProviderModelsCache: readProviderModelsCacheMock,
      hasConnectedProvidersCache: () => readConnectedProvidersCacheMock() !== null,
      hasProviderModelsCache: () => readProviderModelsCacheMock() !== null,
      _resetMemCacheForTesting: () => {},
    }))
    mock.module("../../../features/claude-code-agent-loader/loader", () => ({
      loadUserAgents: loadUserAgentsMock,
      loadProjectAgents: loadProjectAgentsMock,
    }))
    mock.module("../../../features/claude-code-agent-loader", () => ({
      loadUserAgents: loadUserAgentsMock,
      loadProjectAgents: loadProjectAgentsMock,
    }))
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
