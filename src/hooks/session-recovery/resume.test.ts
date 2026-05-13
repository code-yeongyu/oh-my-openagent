declare const require: (name: string) => any
const { describe, expect, test } = require("bun:test")
import { extractResumeConfig, resumeSession } from "./resume"
import { OMO_INTERNAL_INITIATOR_MARKER } from "../../shared/internal-initiator-marker"
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

  test("#given the last user message includes model variant #when extracting resume config #then the variant is preserved", () => {
    // given
    const model = {
      providerID: "openai",
      modelID: "gpt-5.3-codex",
      variant: "max",
    }
    const userMessage: MessageData = {
      info: {
        agent: "Hephaestus",
        model,
      },
    }

    // when
    const config = extractResumeConfig(userMessage, "ses_resume_variant")

    // then
    expect(config.model).toEqual(model)
  })

  test("resumeSession sends inherited tools and variant with continuation prompt", async () => {
    // given
    let promptBody: Record<string, unknown> | undefined
    const model = {
      providerID: "openai",
      modelID: "gpt-5.3-codex",
      variant: "max",
    }
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
      model,
      tools: { question: false, bash: true },
    })

    // then
    expect(ok).toBe(true)
    expect(promptBody?.model).toEqual({ providerID: "openai", modelID: "gpt-5.3-codex" })
    expect(promptBody?.variant).toBe("max")
    expect(promptBody?.tools).toEqual({ question: false, bash: true })
    expect(Array.isArray(promptBody?.parts)).toBe(true)
    const firstPart = (promptBody?.parts as Array<{ text?: string }>)?.[0]
    expect(firstPart?.text).toContain(OMO_INTERNAL_INITIATOR_MARKER)
  })
})
