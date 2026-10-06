/// <reference types="bun-types" />

import { beforeEach, describe, expect, mock, test } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import type { AgentOverrides, CategoriesConfig } from "../../config/schema"
import type { BackgroundManager } from "../../features/background-agent"
import { AGENT_MODEL_REQUIREMENTS } from "../../shared/model-requirements"
import { clearCallableAgentsCache } from "./agent-resolver"
import { createCallOmoAgent } from "./tools"

type LaunchInput = {
  model?: { providerID: string; modelID: string; variant?: string }
  fallbackChain?: Array<{ providers: string[]; model: string; variant?: string }>
}

function createCtx(): PluginInput {
  return {
    client: {
      app: {
        agents: mock(() => Promise.resolve({ data: [{ name: "explore", mode: "subagent" }] })),
      },
    },
    directory: "/test",
  } as unknown as PluginInput
}

async function launchExplore(
  agentOverrides?: AgentOverrides,
  userCategories?: CategoriesConfig,
): Promise<LaunchInput> {
  const launch = mock((_input: LaunchInput) => Promise.resolve({
    id: "task-explicit-model",
    sessionId: "sub-session",
    description: "Test task",
    agent: "explore",
    status: "pending",
  }))
  const manager = { launch, getTask: mock(() => undefined) } as unknown as BackgroundManager
  const toolDef = createCallOmoAgent(createCtx(), manager, [], agentOverrides, userCategories)

  await toolDef.execute(
    {
      description: "Test explicit model fallback",
      prompt: "Test prompt",
      subagent_type: "explore",
      run_in_background: true,
    },
    { sessionID: "test", messageID: "msg", agent: "test", abort: new AbortController().signal } as never,
  )

  const firstCall = launch.mock.calls[0]
  if (firstCall === undefined) {
    throw new Error("Expected launch to be called")
  }
  return firstCall[0]
}

describe("call_omo_agent fallback chain for explicit user models (#8536)", () => {
  beforeEach(() => {
    clearCallableAgentsCache()
  })

  test("#given an explicit agent model without fallback_models #when launched #then no built-in fallback chain is attached", async () => {
    // given
    const agentOverrides: AgentOverrides = { explore: { model: "zhipuai-coding-plan/glm-5.3-flash" } }

    // when
    const launchInput = await launchExplore(agentOverrides)

    // then
    expect(launchInput.model).toEqual({ providerID: "zhipuai-coding-plan", modelID: "glm-5.3-flash" })
    expect(launchInput.fallbackChain).toBeUndefined()
  })

  test("#given a category-derived model without fallback_models #when launched #then no built-in fallback chain is attached", async () => {
    // given
    const agentOverrides: AgentOverrides = { explore: { category: "research" } }
    const userCategories: CategoriesConfig = { research: { model: "zhipuai-coding-plan/glm-5.3-flash" } }

    // when
    const launchInput = await launchExplore(agentOverrides, userCategories)

    // then
    expect(launchInput.model).toEqual({ providerID: "zhipuai-coding-plan", modelID: "glm-5.3-flash" })
    expect(launchInput.fallbackChain).toBeUndefined()
  })

  test("#given an explicit agent model with fallback_models #when launched #then only the configured chain is attached", async () => {
    // given
    const agentOverrides: AgentOverrides = {
      explore: {
        model: "zhipuai-coding-plan/glm-5.3-flash",
        fallback_models: ["zhipuai-coding-plan/glm-5.3"],
      },
    }

    // when
    const launchInput = await launchExplore(agentOverrides)

    // then
    expect(launchInput.fallbackChain).toEqual([
      { providers: ["zhipuai-coding-plan"], model: "glm-5.3", variant: undefined },
    ])
  })

  test("#given no agent model override #when launched #then the built-in fallback chain is still attached", async () => {
    // given
    const builtinChain = AGENT_MODEL_REQUIREMENTS["explore"]?.fallbackChain

    // when
    const launchInput = await launchExplore()

    // then
    expect(builtinChain?.length).toBeGreaterThan(0)
    expect(launchInput.fallbackChain).toEqual(builtinChain)
  })
})
