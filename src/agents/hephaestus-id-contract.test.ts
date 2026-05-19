/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { buildHephaestusPrompt as buildGptHephaestusPrompt } from "./hephaestus/gpt"
import { buildHephaestusPrompt as buildGpt53CodexHephaestusPrompt } from "./hephaestus/gpt-5-3-codex"
import { buildHephaestusPrompt as buildGpt54HephaestusPrompt } from "./hephaestus/gpt-5-4"
import { buildGpt55HephaestusPrompt } from "./hephaestus/gpt-5-5"

describe("Hephaestus background task ID guidance", () => {
  const promptBuilders = [
    ["gpt", () => buildGptHephaestusPrompt()],
    ["gpt-5.3-codex", () => buildGpt53CodexHephaestusPrompt()],
    ["gpt-5.4", () => buildGpt54HephaestusPrompt()],
    ["gpt-5.5", () => buildGpt55HephaestusPrompt([])],
  ] as const

  for (const [name, buildPrompt] of promptBuilders) {
    test(`#given ${name} prompt #when describing task follow-ups #then bg ids and continuation ids are disambiguated`, () => {
      // given, when
      const prompt = buildPrompt()

      // then
      expect(prompt).toContain("background task IDs (`bg_...`)")
      expect(prompt).toContain("continuation IDs (`ses_...`)")
      expect(prompt).toContain("background_output(task_id=\"bg_...\")")
      expect(prompt).toContain("task(task_id=\"ses_...\")")
      expect(prompt).not.toContain("returns a task_id")
    })
  }
})
