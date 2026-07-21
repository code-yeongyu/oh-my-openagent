/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { getAtlasPrompt } from "./atlas/agent"
import { createSisyphusAgent } from "./sisyphus"
import { buildSisyphusJuniorPrompt } from "./sisyphus-junior"

describe("shared GPT prompt identities", () => {
  for (const [model, identity] of [
    ["openai/gpt-5.5", "GPT-5.5"],
    ["openai/gpt-5.6-sol", "GPT-5.6 Sol"],
  ] as const) {
    test(`uses ${identity} in assembled Sisyphus prompts`, () => {
      // given a supported GPT model shared by both prompt families

      // when the primary and junior prompts are assembled
      const primaryPrompt = createSisyphusAgent(model).prompt
      const juniorPrompt = buildSisyphusJuniorPrompt(model, false)

      // then both prompts identify the actual routed model
      expect(primaryPrompt).toContain(`based on ${identity}`)
      expect(juniorPrompt).toContain(`based on ${identity}`)
    })
  }

  for (const model of ["openai/gpt-5.5", "openai/gpt-5.6-sol"]) {
    test(`keeps the Atlas identity model-neutral for ${model}`, () => {
      // given a GPT model routed through the shared Atlas prompt

      // when the Atlas prompt is loaded
      const prompt = getAtlasPrompt(model)

      // then the prompt does not claim a different GPT version
      expect(prompt).toContain("calibrated for GPT-family models")
      expect(prompt).not.toContain("calibrated for GPT-5.5")
      expect(prompt).not.toContain("calibrated for GPT-5.6 Sol")
    })
  }
})
