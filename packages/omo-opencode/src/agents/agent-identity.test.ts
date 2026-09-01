/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"
import type { AgentConfig } from "@opencode-ai/sdk"
import { mergeAgentConfig } from "./builtin-agents/agent-overrides"
import { buildAgentIdentitySection } from "./dynamic-agent-core-sections"

describe("buildAgentIdentitySection", () => {
  it("propagates the supplied agent name and role description", () => {
    const result = buildAgentIdentitySection("SENTINEL_AGENT_NAME", "SENTINEL_ROLE_DESCRIPTION")

    expect(result).toContain("SENTINEL_AGENT_NAME")
    expect(result).toContain("SENTINEL_ROLE_DESCRIPTION")
  })

  it("does not leak inputs from a different identity build", () => {
    const first = buildAgentIdentitySection("SENTINEL_AGENT_A", "SENTINEL_ROLE_A")
    const second = buildAgentIdentitySection("SENTINEL_AGENT_B", "SENTINEL_ROLE_B")

    expect(first).toContain("SENTINEL_AGENT_A")
    expect(first).toContain("SENTINEL_ROLE_A")
    expect(first).not.toContain("SENTINEL_AGENT_B")
    expect(first).not.toContain("SENTINEL_ROLE_B")
    expect(second).toContain("SENTINEL_AGENT_B")
    expect(second).toContain("SENTINEL_ROLE_B")
    expect(second).not.toContain("SENTINEL_AGENT_A")
    expect(second).not.toContain("SENTINEL_ROLE_A")
  })
})

describe("mergeAgentConfig prompt composition", () => {
  it("preserves the base prompt and appends the override payload", () => {
    const base = { prompt: "SENTINEL_BASE_PROMPT" } as AgentConfig
    const merged = mergeAgentConfig(base, { prompt_append: "SENTINEL_APPEND_CONTENT" })

    expect(merged.prompt).toBe("SENTINEL_BASE_PROMPT\nSENTINEL_APPEND_CONTENT")
  })
})
