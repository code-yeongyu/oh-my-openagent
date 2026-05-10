/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { buildGlmSisyphusPrompt } from "./sisyphus/glm"
import { createSisyphusAgent } from "./sisyphus"
import { buildGlmSisyphusJuniorPrompt } from "./sisyphus-junior/glm"
import { estimateTokenCount } from "../tools/delegate-task/token-limiter"
import { createBenchmarkResult, runPromptBenchmarks } from "./glm-benchmark-utils"

const GLM_TEXT_MODEL = "zai/glm-5-turbo"
const GLM_VLM_MODEL = "zai/glm-5v-turbo"
const BASELINE_MODEL = "anthropic/claude-sonnet-4-6"

function countXmlSections(prompt: string): number {
  const xmlSections = prompt.match(/^<[^/!][^>]*>/gm)?.length ?? 0
  const markdownSections = prompt.match(/^#{1,4}\s+/gm)?.length ?? 0
  return xmlSections + markdownSections
}

describe("GLM prompt token economy", () => {
  test("#given GLM Sisyphus prompt #then token count stays within non-bloated bounds", () => {
    const glmPrompt = buildGlmSisyphusPrompt(GLM_TEXT_MODEL, [])
    const baselinePrompt = createSisyphusAgent(BASELINE_MODEL).prompt ?? ""
    const glmTokens = estimateTokenCount(glmPrompt)
    const baselineTokens = estimateTokenCount(baselinePrompt)

    runPromptBenchmarks([
      createBenchmarkResult("sisyphus prompt tokens", glmTokens, baselineTokens),
    ])

    expect(glmTokens).toBeGreaterThan(2000)
    expect(glmTokens).toBeLessThan(10000)
    expect(glmTokens).toBeLessThan(baselineTokens)
  })

  test("#given GLM text-only model #then prompt includes vision constraint block", () => {
    const prompt = buildGlmSisyphusPrompt(GLM_TEXT_MODEL, [])

    expect(prompt).toContain("<GLM_VISION_CONSTRAINT>")
    expect(prompt).toContain("GLM text-only models")
    expect(prompt).toContain("zai-mcp-server")
  })

  test("#given GLM VLM model #then prompt excludes text-only vision constraint block", () => {
    const prompt = buildGlmSisyphusPrompt(GLM_VLM_MODEL, [])

    expect(prompt).not.toContain("<GLM_VISION_CONSTRAINT>")
    expect(prompt).not.toContain("You are a text-only model")
  })

  test("#given GLM Sisyphus-Junior prompt #then includes GLM-specific addendum", () => {
    const prompt = buildGlmSisyphusJuniorPrompt(GLM_TEXT_MODEL, false)

    expect(prompt).toContain("## GLM-5.1 Execution Mode")
    expect(prompt).toContain("You are running on GLM-5.1")
    expect(prompt).toContain("## Token Discipline")
  })

  test("#given GLM and baseline Sisyphus prompts #then GLM uses fewer top-level sections", () => {
    const glmPrompt = buildGlmSisyphusPrompt(GLM_TEXT_MODEL, [])
    const baselinePrompt = createSisyphusAgent(BASELINE_MODEL).prompt ?? ""
    const glmSections = countXmlSections(glmPrompt)
    const baselineSections = countXmlSections(baselinePrompt)

    runPromptBenchmarks([
      createBenchmarkResult("top-level section count", glmSections, baselineSections),
    ])

    expect(glmSections).toBeGreaterThan(0)
    expect(glmSections).toBeLessThan(baselineSections)
  })
})
