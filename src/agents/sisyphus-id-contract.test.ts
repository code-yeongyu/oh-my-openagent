/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { buildClaudeOpus47SisyphusPrompt } from "./sisyphus/claude-opus-4-7"
import { buildDefaultSisyphusPrompt } from "./sisyphus/default"
import { buildGpt54SisyphusPrompt } from "./sisyphus/gpt-5-4"
import { buildGpt55SisyphusPrompt } from "./sisyphus/gpt-5-5"
import { buildKimiK26SisyphusPrompt } from "./sisyphus/kimi-k2-6"

describe("Sisyphus background task ID guidance", () => {
  const promptBuilders = [
    ["claude-opus-4-7", buildClaudeOpus47SisyphusPrompt],
    ["default", buildDefaultSisyphusPrompt],
    ["gpt-5.4", buildGpt54SisyphusPrompt],
    ["gpt-5.5", buildGpt55SisyphusPrompt],
    ["kimi-k2.6", buildKimiK26SisyphusPrompt],
  ] as const

  for (const [name, buildPrompt] of promptBuilders) {
    test(`#given ${name} prompt #when describing background tasks #then bg ids and session ids are disambiguated`, () => {
      // given, when
      const prompt = buildPrompt(name, [])

      // then
      expect(prompt).toContain("background task IDs (`bg_...`)")
      expect(prompt).toContain("continuation session IDs (`ses_...`)")
      expect(prompt).toContain("background_output(task_id=\"bg_...\")")
      expect(prompt).toContain("task(task_id=\"ses_...\")")
      expect(prompt).not.toContain("receive task_ids")
    })
  }
})
