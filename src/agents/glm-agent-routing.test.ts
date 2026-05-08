/// <reference types="bun-types" />

import { describe, test, expect } from "bun:test"
import { ATLAS_SYSTEM_PROMPT } from "./atlas/default"
import { getGlmAtlasPrompt } from "./atlas/glm"
import { PROMETHEUS_SYSTEM_PROMPT } from "./prometheus/system-prompt"
import { getGlmPrometheusPrompt } from "./prometheus/glm"

describe("GLM agent routing", () => {
  test("getGlmAtlasPrompt returns a non-empty prompt with vision routing and base content", () => {
    const prompt = getGlmAtlasPrompt()

    expect(prompt.length).toBeGreaterThan(0)
    expect(prompt).toContain("zai-mcp-server")
    expect(prompt).toContain("text-only")
    expect(prompt).toContain(ATLAS_SYSTEM_PROMPT)
  })

  test("getGlmPrometheusPrompt returns a non-empty prompt with vision routing and base content", () => {
    const prompt = getGlmPrometheusPrompt()

    expect(prompt.length).toBeGreaterThan(0)
    expect(prompt).toContain("zai-mcp-server")
    expect(prompt).toContain("text-only")
    expect(prompt).toContain(PROMETHEUS_SYSTEM_PROMPT)
  })
})
