/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { buildGlmSisyphusPrompt } from "./sisyphus/glm"
import { buildGlmSisyphusJuniorPrompt } from "./sisyphus-junior/glm"

describe("GLM Team Mode Prompts", () => {
  test("Sisyphus prompt contains team lead section", () => {
    const prompt = buildGlmSisyphusPrompt("glm-5.1", [], [], [], [])

    expect(prompt).toContain("Team Mode")
    expect(prompt).toContain("team_send_message")
    expect(prompt).toContain("team_task_create")
  })

  test("SJ prompt contains team member section", () => {
    const prompt = buildGlmSisyphusJuniorPrompt("glm-5", false)

    expect(prompt).toContain("Team Mode")
    expect(prompt).toContain("team_send_message")
    expect(prompt).toContain("team_task_update")
  })

  test("SJ team member has claim and complete instructions", () => {
    const prompt = buildGlmSisyphusJuniorPrompt("glm-5", false)

    expect(prompt).toContain("claimed")
    expect(prompt).toContain("completed")
  })
})
