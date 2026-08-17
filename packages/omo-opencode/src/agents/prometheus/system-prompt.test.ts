/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"
import { getPrometheusPrompt } from "./system-prompt"

const MODEL_IDS = [
  undefined,
  "anthropic/claude-opus-4-8",
  "anthropic/claude-fable-5",
  "gpt-5.5",
  "gemini-3.1-pro",
  "opencode-go/kimi-k2.7",
] as const

describe("getPrometheusPrompt model-family routing", () => {
  describe("#given any supported model id", () => {
    describe("#when loading the Prometheus prompt", () => {
      it("#then returns the same single prompt for every model family", () => {
        const prompts = MODEL_IDS.map((model) => getPrometheusPrompt(model, []))
        const [firstPrompt, ...remainingPrompts] = prompts

        expect(firstPrompt).toBeDefined()
        for (const prompt of remainingPrompts) {
          expect(prompt).toBe(firstPrompt)
        }
      })
    })
  })
})
