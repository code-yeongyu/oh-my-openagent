import { describe, expect, test } from "bun:test"

import { unsafeTestValue } from "../../../../test-support/unsafe-test-value"
import { collectPendingBuiltinAgents } from "./builtin-agents/general-agents"
import { createMomusAgent } from "./momus"

type AgentSources = Parameters<typeof collectPendingBuiltinAgents>[0]["agentSources"]

describe("Momus GPT-5.6 warm-cache registration", () => {
  test("registers transformed Vercel terra ahead of Copilot terra", () => {
    // given
    const availableModels = new Set([
      "github-copilot/gpt-5.6-terra",
      "vercel/openai/gpt-5.6-terra",
    ])

    // when
    const { pendingAgentConfigs } = collectPendingBuiltinAgents({
      agentSources: unsafeTestValue<AgentSources>({ momus: createMomusAgent }),
      agentMetadata: {},
      disabledAgents: [],
      agentOverrides: {},
      mergedCategories: {},
      availableModels,
      isFirstRunNoCache: false,
    })
    const config = pendingAgentConfigs.get("momus")

    // then
    expect(config?.model).toBe("vercel/openai/gpt-5.6-terra")
    expect(config?.variant).toBe("high")
  })
})
