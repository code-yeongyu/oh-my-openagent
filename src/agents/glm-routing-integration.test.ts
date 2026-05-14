/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { getAtlasPrompt, getAtlasPromptSource } from "./atlas/agent"
import { buildGlmSisyphusPrompt } from "./sisyphus/glm"
import { createSisyphusAgent } from "./sisyphus"
import { buildGlmSisyphusJuniorPrompt } from "./sisyphus-junior/glm"
import { createOracleAgent } from "./oracle"
import { createMetisAgent } from "./metis"
import { createMomusAgent } from "./momus"
import {
  isGlmSisyphusHarnessModel,
  isGlmThinkingModel,
  isGlmVisionModel,
} from "./types"

const GLM_TEXT_MODEL = "zai/glm-5-turbo"
const GLM_VLM_MODEL = "zai/glm-5v-turbo"
const GLM_REASONING_MODEL = "zai/glm-5.1:thinking"

describe("GLM routing integration", () => {
  test("#given GLM text model #then routes to text-only prompt restrictions", () => {
    const prompt = buildGlmSisyphusPrompt(GLM_TEXT_MODEL, [])

    expect(isGlmVisionModel(GLM_TEXT_MODEL)).toBe(false)
    expect(prompt).toContain("<GLM_VISION_CONSTRAINT>")
    expect(prompt).toContain("NEVER attempt to use `look_at`, `read`, or screenshot tools")
  })

  test("#given GLM VLM model #then routes to VLM prompt with vision restrictions removed", () => {
    const prompt = buildGlmSisyphusPrompt(GLM_VLM_MODEL, [])

    expect(isGlmVisionModel(GLM_VLM_MODEL)).toBe(true)
    expect(prompt).not.toContain("<GLM_VISION_CONSTRAINT>")
    expect(prompt).not.toContain("NEVER attempt to use `look_at`, `read`, or screenshot tools")
  })

  test("#given GLM reasoning model #then prompt routing skips injected chain-of-thought config", () => {
    const agent = createSisyphusAgent(GLM_REASONING_MODEL)

    expect(isGlmThinkingModel(GLM_REASONING_MODEL)).toBe(true)
    expect(agent.prompt).toContain("<re_entry_rule>")
    expect(agent.prompt).toContain("<verification_loop>")
    expect(agent.thinking).toEqual({ type: "enabled" })
    expect(agent.reasoningEffort).toBeUndefined()
  })

  test("#given GLM model ID #then dynamic Sisyphus route selects GLM prompt variant", () => {
    const routedPrompt = createSisyphusAgent(GLM_TEXT_MODEL).prompt ?? ""
    const directPrompt = buildGlmSisyphusPrompt(GLM_TEXT_MODEL, [])

    expect(isGlmSisyphusHarnessModel(GLM_TEXT_MODEL)).toBe(true)
    expect(routedPrompt).toBe(directPrompt)
    expect(routedPrompt).toContain("reasoning-first senior engineer")
    expect(routedPrompt).toContain("GLM exploration principle")
  })

  test("#given GLM model ID #then Sisyphus-Junior selects GLM prompt variant", () => {
    const prompt = buildGlmSisyphusJuniorPrompt(GLM_TEXT_MODEL, false)

    expect(isGlmSisyphusHarnessModel(GLM_TEXT_MODEL)).toBe(true)
    expect(prompt).toContain("## GLM-5.1 Execution Mode")
    expect(prompt).toContain("Stay an executor")
  })

  test("#given Atlas GLM model #then Atlas routing uses glm.ts variant", () => {
    const prompt = getAtlasPrompt("zai/glm-5")

    expect(getAtlasPromptSource("zai/glm-5")).toBe("glm")
    expect(prompt).toContain("zai-mcp-server")
    expect(prompt).toContain("You are a text-only model")
  })
})

const LANGUAGE_CONSTRAINT_MARKERS = [
  "GLM_LANGUAGE_CONSTRAINT",
  "same language as the user",
  "same language as the user's message",
  "Respond in the same language",
] as const

describe("GLM language constraint absence regression", () => {
  const glmModels = ["zai/glm-5-turbo", "zai/glm-5v-turbo", "zai/glm-5.1"]

  test("#given GLM Sisyphus prompts #then no language constraint markers", () => {
    for (const model of glmModels) {
      const prompt = buildGlmSisyphusPrompt(model, [])
      for (const marker of LANGUAGE_CONSTRAINT_MARKERS) {
        expect(prompt).not.toContain(marker)
      }
    }
  })

  test("#given GLM Sisyphus-Junior prompts #then no language constraint markers", () => {
    for (const model of glmModels) {
      const prompt = buildGlmSisyphusJuniorPrompt(model, false)
      for (const marker of LANGUAGE_CONSTRAINT_MARKERS) {
        expect(prompt).not.toContain(marker)
      }
    }
  })

  test("#given GLM Atlas prompt #then no language constraint markers", () => {
    const prompt = getAtlasPrompt("zai/glm-5")
    for (const marker of LANGUAGE_CONSTRAINT_MARKERS) {
      expect(prompt).not.toContain(marker)
    }
  })

  test("#given GLM Oracle prompt #then no language constraint markers", () => {
    const agent = createOracleAgent("zai/glm-5.1")
    const prompt = agent.prompt ?? ""
    for (const marker of LANGUAGE_CONSTRAINT_MARKERS) {
      expect(prompt).not.toContain(marker)
    }
  })

  test("#given GLM Metis prompt #then no language constraint markers", () => {
    const agent = createMetisAgent("zai/glm-5.1")
    const prompt = agent.prompt ?? ""
    for (const marker of LANGUAGE_CONSTRAINT_MARKERS) {
      expect(prompt).not.toContain(marker)
    }
  })

  test("#given GLM Momus prompt #then no language constraint markers", () => {
    const agent = createMomusAgent("zai/glm-5.1")
    const prompt = agent.prompt ?? ""
    for (const marker of LANGUAGE_CONSTRAINT_MARKERS) {
      expect(prompt).not.toContain(marker)
    }
  })
})
