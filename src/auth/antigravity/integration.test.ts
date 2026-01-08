/**
 * Antigravity Integration Tests - End-to-End
 *
 * Tests the complete request transformation pipeline:
 * - Request parsing and model extraction
 * - System prompt injection (handled by transformRequest)
 * - Thinking config application (handled by applyThinkingConfigToRequest)
 * - Body wrapping for Antigravity API format
 */

import { describe, it, expect } from "bun:test"
import { transformRequest } from "./request"
import { extractThinkingConfig, applyThinkingConfigToRequest } from "./thinking"

describe("Antigravity Integration - End-to-End", () => {
  describe("Thinking Config Integration", () => {
    it("Gemini 3 with reasoning_effort='high' → thinkingLevel='high'", () => {
      // #given
      const inputBody: Record<string, unknown> = {
        model: "gemini-3-pro-preview",
        reasoning_effort: "high",
        messages: [{ role: "user", content: "test" }],
      }

      // #when
      const transformed = transformRequest({
        url: "https://generativelanguage.googleapis.com/v1internal/models/gemini-3-pro-preview:generateContent",
        body: inputBody,
        accessToken: "test-token",
        projectId: "test-project",
        sessionId: "test-session",
        modelName: "gemini-3-pro-preview",
      })

      const thinkingConfig = extractThinkingConfig(
        inputBody,
        inputBody.generationConfig as Record<string, unknown> | undefined,
        inputBody,
      )
      if (thinkingConfig) {
        applyThinkingConfigToRequest(
          transformed.body as unknown as Record<string, unknown>,
          "gemini-3-pro-preview",
          thinkingConfig,
        )
      }

      // #then
      const genConfig = transformed.body.request.generationConfig as Record<string, unknown> | undefined
      const thinkingConfigResult = genConfig?.thinkingConfig as Record<string, unknown> | undefined
      expect(thinkingConfigResult?.thinkingLevel).toBe("high")
      expect(thinkingConfigResult?.thinkingBudget).toBeUndefined()
      const systemInstruction = transformed.body.request.systemInstruction as Record<string, unknown> | undefined
      const parts = systemInstruction?.parts as Array<{ text: string }> | undefined
      expect(parts?.[0]?.text).toContain("<identity>")
    })

    it("Gemini 2.5 with reasoning_effort='high' → thinkingBudget=24576", () => {
      // #given
      const inputBody: Record<string, unknown> = {
        model: "gemini-2.5-flash",
        reasoning_effort: "high",
        messages: [{ role: "user", content: "test" }],
      }

      // #when
      const transformed = transformRequest({
        url: "https://generativelanguage.googleapis.com/v1internal/models/gemini-2.5-flash:generateContent",
        body: inputBody,
        accessToken: "test-token",
        projectId: "test-project",
        sessionId: "test-session",
        modelName: "gemini-2.5-flash",
      })

      const thinkingConfig = extractThinkingConfig(
        inputBody,
        inputBody.generationConfig as Record<string, unknown> | undefined,
        inputBody,
      )
      if (thinkingConfig) {
        applyThinkingConfigToRequest(
          transformed.body as unknown as Record<string, unknown>,
          "gemini-2.5-flash",
          thinkingConfig,
        )
      }

      // #then
      const genConfig = transformed.body.request.generationConfig as Record<string, unknown> | undefined
      const thinkingConfigResult = genConfig?.thinkingConfig as Record<string, unknown> | undefined
      expect(thinkingConfigResult?.thinkingBudget).toBe(24576)
      expect(thinkingConfigResult?.thinkingLevel).toBeUndefined()
    })

    it("reasoning_effort='none' → thinkingConfig deleted", () => {
      // #given
      const inputBody: Record<string, unknown> = {
        model: "gemini-2.5-flash",
        reasoning_effort: "none",
        messages: [{ role: "user", content: "test" }],
      }

      // #when
      const transformed = transformRequest({
        url: "https://generativelanguage.googleapis.com/v1internal/models/gemini-2.5-flash:generateContent",
        body: inputBody,
        accessToken: "test-token",
        projectId: "test-project",
        sessionId: "test-session",
        modelName: "gemini-2.5-flash",
      })

      const thinkingConfig = extractThinkingConfig(
        inputBody,
        inputBody.generationConfig as Record<string, unknown> | undefined,
        inputBody,
      )
      if (thinkingConfig) {
        applyThinkingConfigToRequest(
          transformed.body as unknown as Record<string, unknown>,
          "gemini-2.5-flash",
          thinkingConfig,
        )
      }

      // #then
      const genConfig = transformed.body.request.generationConfig as Record<string, unknown> | undefined
      expect(genConfig?.thinkingConfig).toBeUndefined()
    })

    it("Claude via Antigravity with reasoning_effort='high'", () => {
      // #given
      const inputBody: Record<string, unknown> = {
        model: "gemini-claude-sonnet-4-5",
        reasoning_effort: "high",
        messages: [{ role: "user", content: "test" }],
      }

      // #when
      const transformed = transformRequest({
        url: "https://generativelanguage.googleapis.com/v1internal/models/gemini-claude-sonnet-4-5:generateContent",
        body: inputBody,
        accessToken: "test-token",
        projectId: "test-project",
        sessionId: "test-session",
        modelName: "gemini-claude-sonnet-4-5",
      })

      const thinkingConfig = extractThinkingConfig(
        inputBody,
        inputBody.generationConfig as Record<string, unknown> | undefined,
        inputBody,
      )
      if (thinkingConfig) {
        applyThinkingConfigToRequest(
          transformed.body as unknown as Record<string, unknown>,
          "gemini-claude-sonnet-4-5",
          thinkingConfig,
        )
      }

      // #then
      const genConfig = transformed.body.request.generationConfig as Record<string, unknown> | undefined
      const thinkingConfigResult = genConfig?.thinkingConfig as Record<string, unknown> | undefined
      expect(thinkingConfigResult?.thinkingBudget).toBe(24576)
    })

    it("System prompt not duplicated on retry", () => {
      // #given
      const inputBody: Record<string, unknown> = {
        model: "gemini-3-pro-high",
        reasoning_effort: "high",
        messages: [{ role: "user", content: "test" }],
      }

      // #when - First transformation
      const firstOutput = transformRequest({
        url: "https://generativelanguage.googleapis.com/v1internal/models/gemini-3-pro-high:generateContent",
        body: inputBody,
        accessToken: "test-token",
        projectId: "test-project",
        sessionId: "test-session",
        modelName: "gemini-3-pro-high",
      })

      // Extract thinking config and apply to first output (simulating what fetch.ts does)
      const thinkingConfig = extractThinkingConfig(
        inputBody,
        inputBody.generationConfig as Record<string, unknown> | undefined,
        inputBody,
      )
      if (thinkingConfig) {
        applyThinkingConfigToRequest(
          firstOutput.body as unknown as Record<string, unknown>,
          "gemini-3-pro-high",
          thinkingConfig,
        )
      }

      // #then
      const systemInstruction = firstOutput.body.request.systemInstruction as Record<string, unknown> | undefined
      const parts = systemInstruction?.parts as Array<{ text: string }> | undefined
      const identityCount = parts?.filter((p) => p.text.includes("<identity>")).length ?? 0
      expect(identityCount).toBe(1) // Should have exactly ONE <identity> block
    })

    it("reasoning_effort='low' for Gemini 3 → thinkingLevel='low'", () => {
      // #given
      const inputBody: Record<string, unknown> = {
        model: "gemini-3-flash-preview",
        reasoning_effort: "low",
        messages: [{ role: "user", content: "test" }],
      }

      // #when
      const transformed = transformRequest({
        url: "https://generativelanguage.googleapis.com/v1internal/models/gemini-3-flash-preview:generateContent",
        body: inputBody,
        accessToken: "test-token",
        projectId: "test-project",
        sessionId: "test-session",
        modelName: "gemini-3-flash-preview",
      })

      const thinkingConfig = extractThinkingConfig(
        inputBody,
        inputBody.generationConfig as Record<string, unknown> | undefined,
        inputBody,
      )
      if (thinkingConfig) {
        applyThinkingConfigToRequest(
          transformed.body as unknown as Record<string, unknown>,
          "gemini-3-flash-preview",
          thinkingConfig,
        )
      }

      // #then
      const genConfig = transformed.body.request.generationConfig as Record<string, unknown> | undefined
      const thinkingConfigResult = genConfig?.thinkingConfig as Record<string, unknown> | undefined
      expect(thinkingConfigResult?.thinkingLevel).toBe("low")
    })

    it("Full pipeline: transformRequest + thinking config preserves all fields", () => {
      // #given
      const inputBody: Record<string, unknown> = {
        model: "gemini-2.5-flash",
        reasoning_effort: "medium",
        messages: [
          { role: "system", content: "You are a helpful assistant." },
          { role: "user", content: "Write a function" },
        ],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 1000,
        },
      }

      // #when
      const transformed = transformRequest({
        url: "https://generativelanguage.googleapis.com/v1internal/models/gemini-2.5-flash:generateContent",
        body: inputBody,
        accessToken: "test-token",
        projectId: "test-project",
        sessionId: "test-session",
        modelName: "gemini-2.5-flash",
      })

      const thinkingConfig = extractThinkingConfig(
        inputBody,
        inputBody.generationConfig as Record<string, unknown> | undefined,
        inputBody,
      )
      if (thinkingConfig) {
        applyThinkingConfigToRequest(
          transformed.body as unknown as Record<string, unknown>,
          "gemini-2.5-flash",
          thinkingConfig,
        )
      }

      // #then
      // Verify basic structure is preserved
      expect(transformed.body.project).toBe("test-project")
      expect(transformed.body.model).toBe("gemini-2.5-flash")
      expect(transformed.body.userAgent).toBe("antigravity")
      expect(transformed.body.request.sessionId).toBe("test-session")

      // Verify generation config is preserved
      const genConfig = transformed.body.request.generationConfig as Record<string, unknown> | undefined
      expect(genConfig?.temperature).toBe(0.7)
      expect(genConfig?.maxOutputTokens).toBe(1000)

      // Verify thinking config is applied
      const thinkingConfigResult = genConfig?.thinkingConfig as Record<string, unknown> | undefined
      expect(thinkingConfigResult?.thinkingBudget).toBe(8192)
      expect(thinkingConfigResult?.include_thoughts).toBe(true)

      // Verify system prompt is injected
      const systemInstruction = transformed.body.request.systemInstruction as Record<string, unknown> | undefined
      const parts = systemInstruction?.parts as Array<{ text: string }> | undefined
      expect(parts?.[0]?.text).toContain("<identity>")
    })
  })
})
