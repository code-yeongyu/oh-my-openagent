declare const require: (name: string) => any
const { describe, expect, test } = require("bun:test")
import { extractResumeConfig, resumeSession } from "./resume"
import type { MessageData } from "./types"

describe("session-recovery resume", () => {
  test("extractResumeConfig carries tools from last user message", () => {
    // given
    const userMessage: MessageData = {
      info: {
        agent: "Hephaestus",
        model: { providerID: "openai", modelID: "gpt-5.3-codex" },
        tools: { question: false, bash: true },
      },
    }

    // when
    const config = extractResumeConfig(userMessage, "ses_resume_tools")

    // then
    expect(config.tools).toEqual({ question: false, bash: true })
  })

  test("resumeSession sends inherited tools with continuation prompt", async () => {
    // given
    let promptBody: Record<string, unknown> | undefined
    const client = {
      session: {
        promptAsync: async (input: { body: Record<string, unknown> }) => {
          promptBody = input.body
          return {}
        },
      },
    }

    // when
    const ok = await resumeSession(client as never, {
      sessionID: "ses_resume_prompt",
      agent: "Hephaestus",
      model: { providerID: "openai", modelID: "gpt-5.3-codex" },
      tools: { question: false, bash: true },
    })

    // then
    expect(ok).toBe(true)
    expect(promptBody?.tools).toEqual({ question: false, bash: true })
  })
})
