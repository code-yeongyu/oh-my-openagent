/**
 * Tests for reasoning_effort and Gemini 3 thinkingLevel support.
 *
 * Tests the following functions:
 * - getModelThinkingConfig()
 * - extractThinkingConfig() with reasoning_effort
 * - applyThinkingConfigToRequest()
 * - budgetToLevel()
 */

import { describe, it, expect } from "bun:test"
import type { AntigravityModelConfig } from "./constants"
import {
  getModelThinkingConfig,
  extractThinkingConfig,
  applyThinkingConfigToRequest,
  budgetToLevel,
  type ThinkingConfig,
  type DeleteThinkingConfig,
} from "./thinking"

// ============================================================================
// getModelThinkingConfig() tests
// ============================================================================

describe("getModelThinkingConfig", () => {
  // #given: A model ID that maps to a levels-based thinking config (Gemini 3)
  // #when: getModelThinkingConfig is called with google/antigravity-gemini-3-pro-high
  // #then: It should return a config with thinkingType: "levels"
  it("should return levels config for Gemini 3 model", () => {
    const config = getModelThinkingConfig("google/antigravity-gemini-3-pro-high")
    expect(config).toBeDefined()
    expect(config?.thinkingType).toBe("levels")
    expect(config?.levels).toEqual(["low", "high"])
  })

  // #given: A model ID that maps to a numeric-based thinking config (Gemini 2.5)
  // #when: getModelThinkingConfig is called with gemini-2.5-flash
  // #then: It should return a config with thinkingType: "numeric"
  it("should return numeric config for Gemini 2.5 model", () => {
    const config = getModelThinkingConfig("gemini-2.5-flash")
    expect(config).toBeDefined()
    expect(config?.thinkingType).toBe("numeric")
    expect(config?.min).toBe(0)
    expect(config?.max).toBe(24576)
    expect(config?.zeroAllowed).toBe(true)
  })

  // #given: A model that doesn't have an exact match but includes "gemini-3"
  // #when: getModelThinkingConfig is called
  // #then: It should use pattern matching fallback to return levels config
  it("should use pattern matching fallback for gemini-3", () => {
    const config = getModelThinkingConfig("gemini-3-pro")
    expect(config).toBeDefined()
    expect(config?.thinkingType).toBe("levels")
    expect(config?.levels).toEqual(["low", "high"])
  })

  // #given: A model that doesn't have an exact match but includes "claude"
  // #when: getModelThinkingConfig is called
  // #then: It should use pattern matching fallback to return numeric config
  it("should use pattern matching fallback for claude models", () => {
    const config = getModelThinkingConfig("claude-opus-4-5")
    expect(config).toBeDefined()
    expect(config?.thinkingType).toBe("numeric")
    expect(config?.min).toBe(1024)
    expect(config?.max).toBe(200000)
    expect(config?.zeroAllowed).toBe(false)
  })

  // #given: An unknown model
  // #when: getModelThinkingConfig is called
  // #then: It should return undefined
  it("should return undefined for unknown models", () => {
    const config = getModelThinkingConfig("unknown-model")
    expect(config).toBeUndefined()
  })
})

// ============================================================================
// extractThinkingConfig() with reasoning_effort tests
// ============================================================================

describe("extractThinkingConfig with reasoning_effort", () => {
  // #given: A request payload with reasoning_effort set to "high"
  // #when: extractThinkingConfig is called
  // #then: It should return config with thinkingBudget: 24576 and includeThoughts: true
  it("should extract reasoning_effort high correctly", () => {
    const requestPayload = { reasoning_effort: "high" }
    const result = extractThinkingConfig(requestPayload)
    expect(result).toEqual({ thinkingBudget: 24576, includeThoughts: true })
  })

  // #given: A request payload with reasoning_effort set to "low"
  // #when: extractThinkingConfig is called
  // #then: It should return config with thinkingBudget: 1024 and includeThoughts: true
  it("should extract reasoning_effort low correctly", () => {
    const requestPayload = { reasoning_effort: "low" }
    const result = extractThinkingConfig(requestPayload)
    expect(result).toEqual({ thinkingBudget: 1024, includeThoughts: true })
  })

  // #given: A request payload with reasoning_effort set to "none"
  // #when: extractThinkingConfig is called
  // #then: It should return { deleteThinkingConfig: true } (special marker)
  it("should extract reasoning_effort none as delete marker", () => {
    const requestPayload = { reasoning_effort: "none" }
    const result = extractThinkingConfig(requestPayload)
    expect(result as unknown).toEqual({ deleteThinkingConfig: true })
  })

  // #given: A request payload with reasoning_effort set to "medium"
  // #when: extractThinkingConfig is called
  // #then: It should return config with thinkingBudget: 8192
  it("should extract reasoning_effort medium correctly", () => {
    const requestPayload = { reasoning_effort: "medium" }
    const result = extractThinkingConfig(requestPayload)
    expect(result).toEqual({ thinkingBudget: 8192, includeThoughts: true })
  })

  // #given: A request payload with reasoning_effort in extraBody (not main payload)
  // #when: extractThinkingConfig is called
  // #then: It should still extract and return the correct config
  it("should extract reasoning_effort from extraBody", () => {
    const requestPayload = {}
    const extraBody = { reasoning_effort: "high" }
    const result = extractThinkingConfig(requestPayload, undefined, extraBody)
    expect(result).toEqual({ thinkingBudget: 24576, includeThoughts: true })
  })

  // #given: A request payload without reasoning_effort
  // #when: extractThinkingConfig is called
  // #then: It should return undefined (existing behavior unchanged)
  it("should return undefined when reasoning_effort not present", () => {
    const requestPayload = { model: "gemini-2.5-flash" }
    const result = extractThinkingConfig(requestPayload)
    expect(result).toBeUndefined()
  })
})

// ============================================================================
// budgetToLevel() tests
// ============================================================================

describe("budgetToLevel", () => {
  // #given: A thinking budget of 24576 and a Gemini 3 model
  // #when: budgetToLevel is called
  // #then: It should return "high"
  it("should convert budget 24576 to level high for Gemini 3", () => {
    const level = budgetToLevel(24576, "gemini-3-pro")
    expect(level).toBe("high")
  })

  // #given: A thinking budget of 1024 and a Gemini 3 model
  // #when: budgetToLevel is called
  // #then: It should return "low"
  it("should convert budget 1024 to level low for Gemini 3", () => {
    const level = budgetToLevel(1024, "gemini-3-pro")
    expect(level).toBe("low")
  })

  // #given: A thinking budget that doesn't match any predefined level
  // #when: budgetToLevel is called
  // #then: It should return the highest available level
  it("should return highest level for unknown budget", () => {
    const level = budgetToLevel(99999, "gemini-3-pro")
    expect(level).toBe("high")
  })
})

// ============================================================================
// applyThinkingConfigToRequest() tests
// ============================================================================

describe("applyThinkingConfigToRequest", () => {
  // #given: A request body with generationConfig and Gemini 3 model with high budget
  // #when: applyThinkingConfigToRequest is called with ThinkingConfig
  // #then: It should set thinkingLevel to "high" (lowercase) and NOT set thinkingBudget
  it("should set thinkingLevel for Gemini 3 model", () => {
    const requestBody: Record<string, unknown> = {
      request: {
        generationConfig: {},
      },
    }
    const config: ThinkingConfig = { thinkingBudget: 24576, includeThoughts: true }

    applyThinkingConfigToRequest(requestBody, "gemini-3-pro", config)

    const genConfig = (requestBody.request as Record<string, unknown>).generationConfig as Record<string, unknown>
    const thinkingConfig = genConfig.thinkingConfig as Record<string, unknown>
    expect(thinkingConfig.thinkingLevel).toBe("high")
    expect(thinkingConfig.thinkingBudget).toBeUndefined()
    expect(thinkingConfig.include_thoughts).toBe(true)
  })

  // #given: A request body with generationConfig and Gemini 2.5 model with high budget
  // #when: applyThinkingConfigToRequest is called with ThinkingConfig
  // #then: It should set thinkingBudget to 24576 and NOT set thinkingLevel
  it("should set thinkingBudget for Gemini 2.5 model", () => {
    const requestBody: Record<string, unknown> = {
      request: {
        generationConfig: {},
      },
    }
    const config: ThinkingConfig = { thinkingBudget: 24576, includeThoughts: true }

    applyThinkingConfigToRequest(requestBody, "gemini-2.5-flash", config)

    const genConfig = (requestBody.request as Record<string, unknown>).generationConfig as Record<string, unknown>
    const thinkingConfig = genConfig.thinkingConfig as Record<string, unknown>
    expect(thinkingConfig.thinkingBudget).toBe(24576)
    expect(thinkingConfig.thinkingLevel).toBeUndefined()
    expect(thinkingConfig.include_thoughts).toBe(true)
  })

  // #given: A request body with existing thinkingConfig
  // #when: applyThinkingConfigToRequest is called with deleteThinkingConfig: true
  // #then: It should remove the thinkingConfig entirely
  it("should remove thinkingConfig when delete marker is set", () => {
    const requestBody: Record<string, unknown> = {
      request: {
        generationConfig: {
          thinkingConfig: {
            thinkingBudget: 16000,
            include_thoughts: true,
          },
        },
      },
    }

    applyThinkingConfigToRequest(requestBody, "gemini-3-pro", { deleteThinkingConfig: true })

    const genConfig = (requestBody.request as Record<string, unknown>).generationConfig as Record<string, unknown>
    expect(genConfig.thinkingConfig).toBeUndefined()
  })

  // #given: A request body without request.generationConfig
  // #when: applyThinkingConfigToRequest is called
  // #then: It should not modify the body (graceful handling)
  it("should handle missing generationConfig gracefully", () => {
    const requestBody: Record<string, unknown> = {}

    applyThinkingConfigToRequest(requestBody, "gemini-2.5-flash", {
      thinkingBudget: 24576,
      includeThoughts: true,
    })

    expect(requestBody.request).toBeUndefined()
  })

  // #given: A request body and an unknown model
  // #when: applyThinkingConfigToRequest is called
  // #then: It should not set any thinking config (graceful handling)
  it("should handle unknown model gracefully", () => {
    const requestBody: Record<string, unknown> = {
      request: {
        generationConfig: {},
      },
    }

    applyThinkingConfigToRequest(requestBody, "unknown-model", {
      thinkingBudget: 24576,
      includeThoughts: true,
    })

    const genConfig = (requestBody.request as Record<string, unknown>).generationConfig as Record<string, unknown>
    expect(genConfig.thinkingConfig).toBeUndefined()
  })

  // #given: A request body with Gemini 3 and budget that maps to "low" level
  // #when: applyThinkingConfigToRequest is called with uppercase level mapping
  // #then: It should convert to lowercase ("low")
  it("should convert uppercase level to lowercase", () => {
    const requestBody: Record<string, unknown> = {
      request: {
        generationConfig: {},
      },
    }
    const config: ThinkingConfig = { thinkingBudget: 1024, includeThoughts: true }

    applyThinkingConfigToRequest(requestBody, "gemini-3-pro", config)

    const genConfig = (requestBody.request as Record<string, unknown>).generationConfig as Record<string, unknown>
    const thinkingConfig = genConfig.thinkingConfig as Record<string, unknown>
    expect(thinkingConfig.thinkingLevel).toBe("low")
    expect(thinkingConfig.thinkingLevel).not.toBe("LOW")
  })
})
