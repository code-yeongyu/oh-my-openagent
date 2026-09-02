import { describe, expect, test } from "bun:test"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import { createExploreAgent } from "../explore"
import { collectPendingBuiltinAgents } from "./general-agents"

type AgentSources = Parameters<typeof collectPendingBuiltinAgents>[0]["agentSources"]

describe("collectPendingBuiltinAgents disabled providers", () => {
  test("skips a static fallback entry when one of its mirrored providers is disabled", () => {
    // given
    const input = {
      agentSources: unsafeTestValue<AgentSources>({ explore: createExploreAgent }),
      agentMetadata: {},
      disabledAgents: [],
      disabledProviders: ["openai-codex"] as const,
      agentOverrides: {},
      mergedCategories: {},
      availableModels: new Set<string>(),
      isFirstRunNoCache: true,
    }

    // when
    const { pendingAgentConfigs } = collectPendingBuiltinAgents(input)

    // then
    expect(pendingAgentConfigs.get("explore")?.model).toBe("deepseek/deepseek-v4-flash")
  })
})
