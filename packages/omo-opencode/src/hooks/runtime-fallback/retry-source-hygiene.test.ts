import { describe, expect, test } from "bun:test"
import { resolveOriginalUserRetryMetadata } from "./auto-retry-metadata"
import { getLastUserRetryParts } from "./last-user-retry-parts"
import { resolveFallbackBootstrapModel } from "./fallback-bootstrap-model"
import {
  createRuntimeFallbackRetryTextPart,
  hasSubstantivePromptText,
  OMO_RUNTIME_FALLBACK_RETRY_MARKER,
} from "../../shared/runtime-fallback-retry-marker"

// The row the dispatcher persists when it finds no user parts: the only retry-marked row without a real prompt.
const syntheticContinuation = createRuntimeFallbackRetryTextPart("continue")

const messages = {
  data: [
    { info: { id: "real", role: "user", model: "openai/real" }, parts: [{ type: "text", text: "real prompt" }] },
    { info: { id: "synthetic", role: "user" }, parts: [syntheticContinuation] },
  ],
}

describe("runtime fallback retry source hygiene", () => {
  test("metadata and retry parts skip the synthetic continuation row", () => {
    expect(resolveOriginalUserRetryMetadata(messages)).toEqual({
      messageID: "real",
      parts: [{ type: "text", text: "real prompt" }],
    })
    expect(getLastUserRetryParts(messages)).toEqual([{ type: "text", text: "real prompt" }])
  })

  test("retry parts skip a compaction row", () => {
    expect(getLastUserRetryParts({ data: [
      { info: { role: "user" }, parts: [{ type: "text", text: "real prompt" }] },
      { info: { role: "user" }, parts: [{ type: "compaction" }] },
    ] })).toEqual([{ type: "text", text: "real prompt" }])
  })

  test("bootstrap prefers the last real user model", async () => {
    const model = await resolveFallbackBootstrapModel({
      sessionID: "session",
      source: "test",
      resolvedAgent: "agent",
      pluginConfig: { agents: { agent: { model: "anthropic/config" } } } as never,
      ctx: {
        directory: "/test",
        client: { session: { messages: async () => messages } },
      },
    })
    expect(model).toBe("openai/real")
  })

  test("prefers non-empty info parts when top-level parts are empty", () => {
    const splitStorage = {
      data: [
        {
          info: { id: "real", role: "user", parts: [{ type: "text", text: "real prompt" }] },
          parts: [],
        },
        {
          info: { id: "synthetic", role: "user", parts: [syntheticContinuation] },
          parts: [],
        },
      ],
    }

    expect(resolveOriginalUserRetryMetadata(splitStorage)).toEqual({
      messageID: "real",
      parts: [{ type: "text", text: "real prompt" }],
    })
    expect(getLastUserRetryParts(splitStorage)).toEqual([{ type: "text", text: "real prompt" }])
  })

  test("uses an explicit synthetic continuation when every user row is a synthetic continuation", () => {
    const onlySyntheticContinuations = { data: [
      { info: { id: "synthetic", role: "user" }, parts: [syntheticContinuation] },
    ] }

    expect(resolveOriginalUserRetryMetadata(onlySyntheticContinuations)).toEqual({ parts: [] })
    expect(getLastUserRetryParts(onlySyntheticContinuations)).toEqual([])
  })

  test("keeps a retry-marked row when its text still contains the real prompt", () => {
    const markedPrompt = {
      data: [{
        info: { id: "marked-real", role: "user", model: "openai/real" },
        parts: [{ type: "text", text: `real prompt\n${OMO_RUNTIME_FALLBACK_RETRY_MARKER}` }],
      }],
    }

    expect(resolveOriginalUserRetryMetadata(markedPrompt)).toEqual({
      messageID: "marked-real",
      parts: [{ type: "text", text: `real prompt\n${OMO_RUNTIME_FALLBACK_RETRY_MARKER}` }],
    })
    expect(getLastUserRetryParts(markedPrompt)).toEqual([
      { type: "text", text: `real prompt\n${OMO_RUNTIME_FALLBACK_RETRY_MARKER}` },
    ])
  })

  test("treats only the retry-marked continuation literal as non-substantive", () => {
    expect(hasSubstantivePromptText([syntheticContinuation])).toBe(false)
    expect(hasSubstantivePromptText([{ type: "text", text: OMO_RUNTIME_FALLBACK_RETRY_MARKER }])).toBe(false)
    expect(hasSubstantivePromptText([{ type: "text", text: "continue" }])).toBe(true)
    expect(hasSubstantivePromptText([createRuntimeFallbackRetryTextPart("continue with the refactor")])).toBe(true)
  })
})
