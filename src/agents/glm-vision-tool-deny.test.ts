/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"
import type { AgentConfig } from "@opencode-ai/sdk"
import { createAtlasAgent } from "./atlas/agent"
import { getTextOnlyGlmVisionToolDeny } from "./frontier-tool-schema-guard"
import { createMetisAgent } from "./metis"
import { createMomusAgent } from "./momus"
import { createOracleAgent } from "./oracle"
import { createSisyphusAgent } from "./sisyphus"
import { createSisyphusJuniorAgentWithOverrides } from "./sisyphus-junior"
import { isGlmVisionModel } from "./types"

const GLM_TEXT_MODEL = "zai-coding-plan/glm-5-turbo"
const GLM_VISION_MODEL = "zai-coding-plan/glm-5v-turbo"
const NON_GLM_MODEL = "anthropic/claude-opus-4-7"

function permission(agent: AgentConfig): Record<string, unknown> {
  return (agent.permission ?? {}) as Record<string, unknown>
}

const factories = [
  { name: "Atlas", create: (model: string) => createAtlasAgent({ model }) },
  { name: "Metis", create: createMetisAgent },
  { name: "Momus", create: createMomusAgent },
  { name: "Oracle", create: createOracleAgent },
  { name: "Sisyphus", create: createSisyphusAgent },
  {
    name: "Sisyphus-Junior",
    create: (model: string) => createSisyphusJuniorAgentWithOverrides({ model }),
  },
]

describe("GLM vision tool denial", () => {
  describe("#given GLM model names", () => {
    it("#then separates VLM variants from text-only variants", () => {
      expect(isGlmVisionModel("zai/glm-4.6v")).toBe(true)
      expect(isGlmVisionModel("zai/glm-5v-turbo")).toBe(true)
      expect(isGlmVisionModel("zai/glm-5-turbo")).toBe(false)
      expect(isGlmVisionModel("zai/glm-5.1")).toBe(false)
    })
  })

  describe("#given direct look_at guard resolution", () => {
    it("#then denies only text-only GLM models", () => {
      expect(getTextOnlyGlmVisionToolDeny(GLM_TEXT_MODEL)).toEqual({ look_at: "deny" })
      expect(getTextOnlyGlmVisionToolDeny(GLM_VISION_MODEL)).toEqual({})
      expect(getTextOnlyGlmVisionToolDeny(NON_GLM_MODEL)).toEqual({})
    })
  })

  describe("#given agent factories with a text-only GLM model", () => {
    it("#then every returned config denies direct look_at access", () => {
      for (const factory of factories) {
        const agent = factory.create(GLM_TEXT_MODEL)

        expect(permission(agent).look_at, factory.name).toBe("deny")
      }
    })
  })

  describe("#given agent factories with non-text-only GLM models", () => {
    it("#then returned configs do not deny direct look_at access", () => {
      for (const factory of factories) {
        expect(permission(factory.create(GLM_VISION_MODEL)).look_at, factory.name).toBeUndefined()
        expect(permission(factory.create(NON_GLM_MODEL)).look_at, factory.name).toBeUndefined()
      }
    })
  })
})
