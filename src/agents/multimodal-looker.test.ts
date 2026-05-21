import { describe, test, expect } from "bun:test"
import { createAgentToolAllowlist } from "../shared/permission-compat"
import { READ_ENABLED } from "../tools/look-at/look-at-prompt"
import { createMultimodalLookerAgent } from "./multimodal-looker"

function extractAvailableToolClaims(prompt: string): readonly string[] {
  const availableToolsLine = prompt
    .split("\n")
    .find((line) => line.toLowerCase().includes("available tools"))
  if (availableToolsLine === undefined) {
    return []
  }

  const tools: string[] = []
  for (const match of availableToolsLine.matchAll(/['`]([^'`]+)['`]/g)) {
    const toolName = match[1]
    if (toolName !== undefined) {
      tools.push(toolName)
    }
  }

  return [...new Set(tools)].sort()
}

function allowedToolNames(
  toolAllowlist: ReturnType<typeof createAgentToolAllowlist>
): readonly string[] {
  return Object.entries(toolAllowlist.permission)
    .filter(([toolName, permission]) => toolName !== "*" && permission === "allow")
    .map(([toolName]) => toolName)
    .sort()
}

function createLookAtRuntimeToolAllowlist(): ReturnType<typeof createAgentToolAllowlist> {
  return createAgentToolAllowlist(READ_ENABLED ? ["read"] : [])
}

describe("createMultimodalLookerAgent", () => {
  test("prompt available tool claims match the look_at runtime allowlist", () => {
    // given
    const agent = createMultimodalLookerAgent("openai/gpt-5-nano")
    const runtimeToolAllowlist = createLookAtRuntimeToolAllowlist()

    // when
    const prompt = typeof agent.prompt === "string" ? agent.prompt : ""
    const promptToolClaims = extractAvailableToolClaims(prompt)
    const runtimeToolNames = allowedToolNames(runtimeToolAllowlist)

    // then
    expect(promptToolClaims).toEqual(runtimeToolNames)
  })

  test("prompt denies tool use to prevent death loop on small VL models", () => {
    // given
    const agent = createMultimodalLookerAgent("openai/gpt-5-nano")

    // when
    const prompt = typeof agent.prompt === "string" ? agent.prompt : ""
    const normalizedPrompt = prompt.toLowerCase()

    // then
    expect(normalizedPrompt).toContain("never")
    expect(normalizedPrompt).toContain("tools")
    expect(extractAvailableToolClaims(prompt)).toEqual([])
  })

  test("prompt instructs the agent never to call other tools", () => {
    // given
    const agent = createMultimodalLookerAgent("openai/gpt-5-nano")

    // when
    const prompt = typeof agent.prompt === "string" ? agent.prompt : ""

    // then
    expect(prompt.toLowerCase()).toContain("never")
  })
})
