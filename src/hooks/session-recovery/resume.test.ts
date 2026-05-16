declare const require: (name: string) => any
const { describe, expect, test } = require("bun:test")

import { OMO_INTERNAL_INITIATOR_MARKER } from "../../shared/internal-initiator-marker"
import { extractResumeConfig, findLastUserMessage, resumeSession } from "./resume"
import type { MessageData } from "./types"

describe("session-recovery resume", () => {
  test("findLastUserMessage skips synthetic and internally marked user messages", () => {
    // given
    const realUserMessage: MessageData = {
      info: {
        role: "user",
        agent: "Sisyphus",
        model: { providerID: "openai", modelID: "gpt-5.3-codex" },
      },
      parts: [{ type: "text", text: "real user task" }],
    }
    const syntheticUserMessage: MessageData = {
      info: {
        role: "user",
        agent: "Atlas",
        model: { providerID: "anthropic", modelID: "claude-sonnet-4-6" },
      },
      parts: [{ type: "text", text: "synthetic wake", synthetic: true }],
    }
    const internalUserMessage: MessageData = {
      info: {
        role: "user",
        agent: "Hephaestus",
        model: { providerID: "openai", modelID: "gpt-5.4" },
      },
      parts: [{ type: "text", text: `internal wake\n${OMO_INTERNAL_INITIATOR_MARKER}` }],
    }

    // when
    const result = findLastUserMessage([
      realUserMessage,
      syntheticUserMessage,
      internalUserMessage,
    ])

    // then
    expect(result).toBe(realUserMessage)
  })

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
    const firstPart = (promptBody?.parts as Array<{
      text?: string
      synthetic?: boolean
      metadata?: Record<string, unknown>
    }>)?.[0]
    expect(firstPart?.text).toContain(OMO_INTERNAL_INITIATOR_MARKER)
    expect(firstPart?.synthetic).toBe(true)
    expect(firstPart?.metadata?.compaction_continue).toBe(true)
    expect(promptBody?.noReply).toBeUndefined()
  })
})
